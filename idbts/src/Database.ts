import type { StandardSchemaV1 } from "@standard-schema/spec";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getKeyPathValue, type AnyKeyPath, type KeyPathValue } from "./KeyPath.ts";
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
   * The schema of the store items.
   *
   * This can be any StandardSchema-compatible schema (zod, valibot, etc.).
   * If you don't use one, you can create a no-op schema with `schema<T>()`,
   * which doesn't do any validation but still provides type safety.
   */
  readonly value: StandardSchemaV1<object, object>;

  /**
   * The primary key field of the store.
   * May be a dot-separated path (e.g. `foo.bar`) or an array of such paths.
   *
   * Used to infer the type of the primary key based on the store value.
   */
  readonly keyPath: AnyKeyPath;

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
   * The key field of the index.
   * May be a dot-separated path (e.g. `foo.bar`) or an array of such paths.
   *
   * Used to infer the type of the index key based on the store value.
   *
   * @see {@link KeyPathValue}
   */
  readonly keyPath: AnyKeyPath;

  /**
   * Whether the index is multi-entry.
   *
   * If true and the indexed value is an array,
   * each value in the array is indexed separately.
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

  /**
   * The schema of the database which was used to create it.
   */
  readonly schema: Schema;

  constructor(idb: IDBDatabase, schema: Schema) {
    this.idb = idb;
    this.schema = schema;
  }

  /**
   * The List of the names of the stores in the database.
   *
   * @see {@link IDBDatabase.objectStoreNames}
   */
  get storeNames(): Readonly<ArrayLike<keyof Schema & string>> {
    return this.idb.objectStoreNames;
  }

  /**
   * Retrieves an object from the store by its primary key.
   *
   * @see {@link IDBObjectStore.get}
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
   *
   * @see {@link IDBObjectStore.getAll}
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
   * Uses {@link IDBObjectStore.add} to insert the objects.
   * Rethrows error if an object with the same primary key already exists
   * or if any of the unique constraints are violated.
   */
  async insert<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    values: StoreInputValue<Schema[StoreName]> | ReadonlyArray<StoreInputValue<Schema[StoreName]>>,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const valueArray: readonly StoreInputValue<Schema[StoreName]>[] = Array.isArray(values)
      ? values
      : [values as any];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const value of valueArray) {
        const storedValue = await this.#validateValue(storeName, value);
        await idbReqToPromise(store.add(storedValue));
        changes.push({ newValue: storedValue });
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
   * Uses {@link IDBObjectStore.put} to insert or update the objects.
   * Rethrows error if any of the unique constraints are violated.
   *
   * @throws {DOMException} If the updater tries to change the object's primary key.
   */
  async upsert<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    values: StoreInputValue<Schema[StoreName]> | ReadonlyArray<StoreInputValue<Schema[StoreName]>>,
    updater?: (
      oldValue: StoreValue<Schema[StoreName]>,
      newValue: StoreValue<Schema[StoreName]>,
    ) => StoreInputValue<Schema[StoreName]>,
  ): Promise<void> {
    const tx = this.idb.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const valueArray: readonly StoreInputValue<Schema[StoreName]>[] = Array.isArray(values)
      ? values
      : [values];
    try {
      const changes: StoreChange<Schema[StoreName]>[] = [];
      for (const value of valueArray) {
        const storedValue = await this.#validateValue(storeName, value);
        const key = getKeyPathValue(storedValue, store.keyPath!) as IDBValidKey;
        const oldValue = await idbReqToPromise(
          store.get(key) as IDBRequest<StoreValue<Schema[StoreName]> | undefined>,
        );
        const newValue =
          oldValue != null && updater != null
            ? await this.#validateValue(storeName, updater(oldValue, storedValue))
            : storedValue;
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
   * Uses either {@link IDBObjectStore.put} or {@link IDBObjectStore.delete} internally.
   * Rethrows error if any of the unique constraints are violated.
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
    ) => StoreInputValue<Schema[StoreName]> | undefined,
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
        const storedValue =
          newValue != null ? await this.#validateValue(storeName, newValue) : undefined;
        if (storedValue != null) {
          if (indexedDB.cmp(getKeyPathValue(storedValue, store.keyPath!), key) !== 0)
            throw new DOMException("Updater cannot change the primary key.", "InvalidStateError");
          await idbReqToPromise(store.put(storedValue));
        } else if (oldValue != null) {
          await idbReqToPromise(store.delete(key));
        }
        changes.push({ oldValue, newValue: storedValue });
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

  /**
   * Validates a value against the store's schema and returns the validated output.
   * Throws {@link SchemaValidationError} if validation fails.
   */
  async #validateValue<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    value: unknown,
  ): Promise<StoreValue<Schema[StoreName]>> {
    const validate = this.schema[storeName]!.value["~standard"].validate;
    const result = await validate(value);
    if (result.issues != null) throw new SchemaValidationError(result.issues);
    return result.value as StoreValue<Schema[StoreName]>;
  }
}

/**
 * Error thrown when a value fails schema validation.
 */
export class SchemaValidationError extends Error {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

  constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(
      `Schema validation failed:\n` +
        issues
          .map(
            (i) =>
              i.path?.map((p) => (typeof p == "object" ? p.key : p)).join(".") + ": " + i.message,
          )
          .join("\n"),
    );
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

/**
 * Infer the primary key type of an object store based on its schema.
 */
export type StorePrimaryKey<Schema extends AnyStoreSchema> = KeyPathValue<
  StandardSchemaV1.InferOutput<Schema["value"]>,
  Schema["keyPath"]
>;

/**
 * Infer the input value type of an object store based on its schema.
 * This is the type accepted by write operations such as {@link Database.insert} and {@link Database.upsert}.
 */
export type StoreInputValue<Schema extends AnyStoreSchema> = Readonly<
  StandardSchemaV1.InferInput<Schema["value"]>
>;

/**
 * Infer the output value type of an object store based on its schema.
 * This is the type returned by read operations such as {@link Database.get} and {@link Database.getAll}.
 */
export type StoreValue<Schema extends AnyStoreSchema> = Readonly<
  StandardSchemaV1.InferOutput<Schema["value"]>
>;

/**
 * Infer the database schema from a {@link Database} instance.
 */
export type DBSchemaOf<DB> = DB extends Database<infer Schema> ? Schema : never;
