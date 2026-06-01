import { sendDBChanges, type DBChange } from "./changesChannel.ts";
import { getValueByKeyPath } from "./getValueByKeyPath.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { SchemaValue, StandardSchema } from "./StandardSchema.ts";
import type { ValuesAtPaths } from "./ValuesAtPaths.ts";

/**
 * A schema for a {@link Database}.
 *
 * It's a map of store names to their schemas.
 */
export type AnyDatabaseSchema = Readonly<Record<string, AnyStoreSchema>>;

/**
 * A schema for a {@link Database} store.
 */
export interface AnyStoreSchema {
  /**
   * The schema of the value.
   *
   * This can be any StandardSchema-compatible schema.
   * Use {@link schema} to create a noop schema.
   */
  readonly value: StandardSchema<object>;

  /**
   * The primary key path of the store.
   *
   * Used to infer the type of the primary key based on the store value.
   *
   * @see {@link ValuesAtPaths}
   */
  readonly keyPath: string | readonly string[];

  /**
   * The schemas of the indexes.
   *
   * This is a map of index names to their schemas.
   */
  readonly indexes?: Record<string, AnyIndexSchema> | undefined;
}

/**
 * A schema for an index of a store.
 */
export interface AnyIndexSchema {
  /**
   * The key path of the index.
   *
   * Used to infer the type of the index key based on the store value.
   *
   * @see {@link ValuesAtPaths}
   */
  readonly keyPath: string | readonly string[];

  /**
   * Whether the index is multi-entry.
   *
   * If true and the indexed value is an array, each value in the array is indexed separately.
   * In this case, the inferred index key type is flattened if it is an array.
   */
  readonly multiEntry?: boolean | undefined;

  /**
   * Whether the index is unique.
   *
   * If true, the index will only allow unique values.
   */
  readonly unique?: boolean | undefined;
}

/**
 * A wrapper for {@link IDBDatabase}.
 */
export class Database<const Schema extends AnyDatabaseSchema> {
  /**
   * The wrapped {@link IDBDatabase}.
   */
  readonly idb: IDBDatabase;

  constructor(idb: IDBDatabase) {
    this.idb = idb;
  }

  /**
   * The List of the names of the object stores in the database.
   *
   * @see {@link IDBDatabase.objectStoreNames}
   */
  get storeNames(): Readonly<ArrayLike<keyof Schema & string>> {
    return this.idb.objectStoreNames;
  }

  /**
   * Retrieves an object from the store.
   */
  async get<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    key: StorePrimaryKey<Schema[StoreName]>,
  ): Promise<SchemaValue<Schema[StoreName]["value"]> | undefined> {
    const tx = this.idb.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return await idbReqToPromise(store.get(key as IDBValidKey));
  }

  /**
   * Retrieves all objects from the store.
   */
  async getAll<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
  ): Promise<SchemaValue<Schema[StoreName]["value"]>[]> {
    const tx = this.idb.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return await idbReqToPromise(store.getAll());
  }

  /**
   * Inserts a new object or objects into the store.
   */
  async insert<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    values:
      | SchemaValue<Schema[StoreName]["value"]>
      | readonly SchemaValue<Schema[StoreName]["value"]>[],
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const valueArray = Array.isArray(values) ? values : [values];
    try {
      const changes: DBChange<any>[] = [];
      for (const value of valueArray) {
        await idbReqToPromise(store.add(value));
        changes.push({ newValue: value });
      }
      sendDBChanges(this.idb.name, storeName, changes);
    } catch (err) {
      tx.abort();
      throw err;
    }
  }

  /**
   * Updates an object or objects in the store using the provided updater function.
   *
   * Updater receives undefined if the object doesn't exist.
   * If the updater returns undefined, the object will be deleted.
   *
   * @throws {DOMException} If the updater tries to change the object's primary key.
   */
  async update<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    keys:
      | Extract<StorePrimaryKey<Schema[StoreName]>, number | string>
      | readonly StorePrimaryKey<Schema[StoreName]>[],
    updater: (
      value: Readonly<SchemaValue<Schema[StoreName]["value"]>> | undefined,
    ) => Readonly<SchemaValue<Schema[StoreName]["value"]>> | undefined,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const keyArray = Array.isArray(keys) ? keys : [keys];
    try {
      const changes: DBChange<any>[] = [];
      for (const key of keyArray) {
        const oldValue = await idbReqToPromise(store.get(key as any));
        const newValue = updater(oldValue);
        if (newValue != null) {
          if (indexedDB.cmp(getValueByKeyPath(newValue, store.keyPath!), key) !== 0)
            throw new DOMException("Updater cannot change the primary key.", "InvalidStateError");
          await idbReqToPromise(store.put(newValue));
        } else if (oldValue != null) {
          await idbReqToPromise(store.delete(key as any));
        }
        changes.push({ oldValue, newValue });
      }
      sendDBChanges(this.idb.name, storeName, changes);
    } catch (err) {
      tx.abort();
      throw err;
    }
  }

  /**
   * Deletes an object or objects from the store.
   *
   * Does nothing if there is no object matching the primary key.
   */
  async delete<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    keys:
      | Extract<StorePrimaryKey<Schema[StoreName]>, number | string>
      | readonly StorePrimaryKey<Schema[StoreName]>[],
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const keyArray = Array.isArray(keys) ? keys : [keys];
    try {
      const changes: DBChange<any>[] = [];
      for (const key of keyArray) {
        const oldValue = await idbReqToPromise(store.get(key as any));
        if (oldValue != null) {
          await idbReqToPromise(store.delete(key as any));
          changes.push({ oldValue });
        }
      }
      sendDBChanges(this.idb.name, storeName, changes);
    } catch (err) {
      tx.abort();
      throw err;
    }
  }

  /**
   * Deletes all objects from the store.
   */
  async clear<const StoreName extends keyof Schema & string>(storeName: StoreName): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const oldValues = await idbReqToPromise(store.getAll());
    await idbReqToPromise(store.clear());
    const changes: DBChange<any>[] = oldValues.map((oldValue) => ({ oldValue }));
    sendDBChanges(this.idb.name, storeName, changes);
  }
}

/**
 * Extracts the schema of a {@link Database}.
 */
export type DatabaseSchemaOf<T> = T extends Database<infer Schema> ? Schema : never;

/**
 * Infer the primary key type of an object store based on its schema.
 */
export type StorePrimaryKey<Schema extends AnyStoreSchema> = ValuesAtPaths<
  SchemaValue<Schema["value"]>,
  Schema["keyPath"]
>;
