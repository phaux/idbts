import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getKeyPathValue, type KeyPathValue } from "./KeyPath.ts";
import type { SchemaValue, StandardSchema } from "./StandardSchema.ts";
import { sendStoreChanges, type StoreChange } from "./storeChangesChannel.ts";

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
   * @see {@link KeyPathValue}
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
   * @see {@link KeyPathValue}
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
  ): Promise<StoreValue<Schema[StoreName]> | undefined> {
    const tx = this.idb.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return await idbReqToPromise(
      store.get(key as IDBValidKey) as IDBRequest<StoreValue<Schema[StoreName]> | undefined>,
    );
  }

  /**
   * Retrieves all objects from the store.
   */
  async getAll<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
  ): Promise<StoreValue<Schema[StoreName]>[]> {
    const tx = this.idb.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return await idbReqToPromise(store.getAll() as IDBRequest<StoreValue<Schema[StoreName]>[]>);
  }

  /**
   * Inserts a new object or objects into the store.
   *
   * Throws an error if an object with the same primary key already exists.
   */
  async insert<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    values: StoreValue<Schema[StoreName]> | ReadonlyArray<StoreValue<Schema[StoreName]>>,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const valueArray: readonly StoreValue<Schema[StoreName]>[] = Array.isArray(values)
      ? values
      : [values as any];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const value of valueArray) {
        await idbReqToPromise(store.add(value));
        changes.push({ newValue: value });
      }
      sendStoreChanges(this, storeName, changes);
    } catch (err) {
      tx.abort();
      throw err;
    }
  }

  /**
   * Inserts new object(s) into the store, or updates existing ones.
   *
   * If an object with the same primary key already exists and an updater is provided,
   * the updater is called with the existing and incoming values to produce the stored value.
   * Otherwise, the incoming value is stored as-is.
   *
   * @throws {DOMException} If the updater tries to change the object's primary key.
   */
  async upsert<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    values: StoreValue<Schema[StoreName]> | ReadonlyArray<StoreValue<Schema[StoreName]>>,
    updater?: (
      oldValue: StoreValue<Schema[StoreName]>,
      newValue: StoreValue<Schema[StoreName]>,
    ) => StoreValue<Schema[StoreName]>,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const valueArray: readonly StoreValue<Schema[StoreName]>[] = Array.isArray(values)
      ? values
      : [values];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const value of valueArray) {
        const key = getKeyPathValue(value, store.keyPath!) as IDBValidKey;
        const oldValue = await idbReqToPromise(
          store.get(key) as IDBRequest<StoreValue<Schema[StoreName]> | undefined>,
        );
        const newValue = oldValue != null && updater != null ? updater(oldValue, value) : value;
        if (indexedDB.cmp(getKeyPathValue(newValue, store.keyPath!), key) !== 0)
          throw new DOMException("Updater cannot change the primary key.", "InvalidStateError");
        await idbReqToPromise(store.put(newValue));
        changes.push({ oldValue, newValue });
      }
      sendStoreChanges(this, storeName, changes);
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
      | ReadonlyArray<StorePrimaryKey<Schema[StoreName]>>,
    updater: (
      value: StoreValue<Schema[StoreName]> | undefined,
    ) => StoreValue<Schema[StoreName]> | undefined,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const keyArray: readonly IDBValidKey[] = Array.isArray(keys) ? keys : [keys];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const key of keyArray) {
        const oldValue = await idbReqToPromise(
          store.get(key) as IDBRequest<StoreValue<Schema[StoreName]> | undefined>,
        );
        const newValue = updater(oldValue);
        if (newValue != null) {
          if (indexedDB.cmp(getKeyPathValue(newValue, store.keyPath!), key) !== 0)
            throw new DOMException("Updater cannot change the primary key.", "InvalidStateError");
          await idbReqToPromise(store.put(newValue));
        } else if (oldValue != null) {
          await idbReqToPromise(store.delete(key));
        }
        changes.push({ oldValue, newValue });
      }
      sendStoreChanges(this, storeName, changes);
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
    const keyArray: readonly IDBValidKey[] = Array.isArray(keys) ? keys : [keys];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const key of keyArray) {
        const oldValue = await idbReqToPromise(
          store.get(key) as IDBRequest<StoreValue<Schema[StoreName]> | undefined>,
        );
        if (oldValue != null) {
          await idbReqToPromise(store.delete(key));
          changes.push({ oldValue });
        }
      }
      sendStoreChanges(this, storeName, changes);
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
    const oldValues = await idbReqToPromise(
      store.getAll() as IDBRequest<StoreValue<Schema[StoreName]>[]>,
    );
    await idbReqToPromise(store.clear());
    const changes: StoreChange<Schema[StoreName]>[] = oldValues.map((oldValue) => ({ oldValue }));
    sendStoreChanges(this, storeName, changes);
  }
}

/**
 * Infer the primary key type of an object store based on its schema.
 */
export type StorePrimaryKey<Schema extends AnyStoreSchema> = KeyPathValue<
  SchemaValue<Schema["value"]>,
  Schema["keyPath"]
>;

/**
 * Infer the value type of an object store based on its schema.
 */
export type StoreValue<Schema extends AnyStoreSchema> = Readonly<SchemaValue<Schema["value"]>>;
