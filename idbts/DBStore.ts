import { DBCursor } from "./DBCursor.ts";
import { DBIndex, type DBIndexSchema } from "./DBIndex.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { KeyRange, MaybeKeyRange, ValidKey } from "./KeyRange.ts";
import type { SchemaValue, StandardSchema, schema } from "./StandardSchema.ts";
import type { OptionalArg } from "./typeUtils.ts";
import type { ValuesAtPaths } from "./ValuesAtPaths.ts";

/**
 * A schema for a {@link DBStore}.
 */
export interface DBStoreSchema extends IDBObjectStoreParameters {
  /**
   * The schema of the external key.
   *
   * External keys are passed to {@link DBStore.add} and {@link DBStore.put} as a separate argument.
   *
   * Alternatively, an inline key can be defined by specifying the {@link keyPath} property.
   */
  key?: StandardSchema<ValidKey>;
  /**
   * The schema of the value.
   *
   * This can be any StandardSchema-compatible schema.
   * Use {@link schema} to create a noop schema.
   */
  value: StandardSchema<unknown>;
  /**
   * The schemas of the indexes.
   *
   * This is a map of index names to their schemas.
   */
  indexes?: Record<string, DBIndexSchema>;
}

/**
 * A wrapper for {@link IDBObjectStore} with more strict types.
 */
export class DBStore<const Schema extends DBStoreSchema> {
  #store: IDBObjectStore;

  constructor(store: IDBObjectStore) {
    this.#store = store;
  }

  /**
   * Adds a new record to the object store.
   *
   * @see {@link IDBObjectStore.add}
   */
  async add(
    value: SchemaValue<Schema["value"]>,
    ...[key]: OptionalArg<StoreInputKey<Schema>>
  ): Promise<StoreOutputKey<Schema>> {
    const newKey = (await idbReqToPromise(this.#store.add(value, key as IDBValidKey))) as StoreOutputKey<Schema>;
    const chan = this.#getChannel();
    chan.postMessage(newKey);
    chan.close();
    return newKey;
  }

  /**
   * Adds or replaces a record in the object store.
   *
   * @see {@link IDBObjectStore.put}
   */
  async put(
    value: SchemaValue<Schema["value"]>,
    ...[key]: OptionalArg<StoreInputKey<Schema>>
  ): Promise<StoreOutputKey<Schema>> {
    const newKey = (await idbReqToPromise(this.#store.put(value, key as IDBValidKey))) as StoreOutputKey<Schema>;
    const chan = this.#getChannel();
    chan.postMessage(newKey);
    chan.close();
    return newKey;
  }

  /**
   * Updates a record in the object store using the provided updater function.
   *
   * Updater is called with the current value of the record or undefined if the record doesn't exist.
   * If the updater returns undefined, the record will be deleted.
   */
  async update(
    key: StoreOutputKey<Schema>,
    updater: (value: SchemaValue<Schema["value"]> | undefined) => SchemaValue<Schema["value"]> | undefined,
  ): Promise<StoreOutputKey<Schema> | undefined> {
    const oldValue = await this.get(key);
    const newValue = updater(oldValue);
    if (newValue != null) {
      const newKey = await this.put(newValue, this.#store.keyPath ? undefined : (key as any));
      // Delete old entry if key changed.
      if (indexedDB.cmp(key, newKey) !== 0) await this.delete(key);
      return newKey;
    }
    if (oldValue != null) await this.delete(key);
  }

  /**
   * Retrieves a record from the object store by its key.
   *
   * @see {@link IDBObjectStore.get}
   */
  get(key: StoreOutputKey<Schema>): Promise<SchemaValue<Schema["value"]>> {
    return idbReqToPromise(this.#store.get(key as IDBValidKey));
  }

  /**
   * Retrieves a range of records from the object store by their keys.
   *
   * @see {@link IDBObjectStore.getAll}
   */
  getAll(range?: KeyRange<StoreOutputKey<Schema>>): Promise<SchemaValue<Schema["value"]>[]> {
    return idbReqToPromise(this.#store.getAll(range));
  }

  /**
   * Retrieves a range of keys from the object store.
   *
   * @see {@link IDBObjectStore.getAllKeys}
   */
  getAllKeys(range?: KeyRange<StoreOutputKey<Schema>>): Promise<StoreOutputKey<Schema>[]> {
    return idbReqToPromise(this.#store.getAllKeys(range)) as Promise<StoreOutputKey<Schema>[]>;
  }

  /**
   * Opens a cursor on the object store.
   *
   * @see {@link IDBObjectStore.openCursor}
   */
  async openCursor(
    range?: KeyRange<StoreOutputKey<Schema>>,
    direction?: IDBCursorDirection,
  ): Promise<DBCursor<SchemaValue<Schema["value"]>, StoreOutputKey<Schema>> | null> {
    const cursor = await idbReqToPromise(this.#store.openCursor(range, direction));
    if (cursor) return new DBCursor(cursor);
    return null;
  }

  /**
   * Returns an iterator over the object store.
   */
  async *iterate(
    range?: KeyRange<StoreOutputKey<Schema>>,
    direction?: IDBCursorDirection,
  ): AsyncIterableIterator<DBCursor<SchemaValue<Schema["value"]>, StoreOutputKey<Schema>>, undefined, undefined> {
    let cursor = await this.openCursor(range, direction);
    while (cursor) {
      yield cursor;
      cursor = await cursor.continue();
    }
  }

  /**
   * Deletes a record or range of records from the object store by their keys.
   *
   * @see {@link IDBObjectStore.delete}
   */
  async delete(key: MaybeKeyRange<StoreOutputKey<Schema>>): Promise<void> {
    await idbReqToPromise(this.#store.delete(key as IDBValidKey));
    const chan = this.#getChannel();
    chan.postMessage(null);
    chan.close();
  }

  /**
   * Access an index of the object store.
   *
   * @see {@link IDBObjectStore.index}
   */
  index<const IndexName extends keyof Schema["indexes"] & string>(indexName: IndexName): DBIndex<Schema, IndexName> {
    return new DBIndex(this.#store.index(indexName));
  }

  /**
   * Deletes all records from the object store.
   *
   * @see {@link IDBObjectStore.clear}
   */
  async clear(): Promise<void> {
    await idbReqToPromise(this.#store.clear());
    const chan = this.#getChannel();
    chan.postMessage(null);
    chan.close();
  }

  #getChannel(): BroadcastChannel {
    return new BroadcastChannel(`${this.#store.transaction.db.name}-${this.#store.name}`);
  }
}

/**
 * A readonly version of {@link DBStore}.
 *
 * It omits the methods that modify the object store.
 */
export type ReadonlyDBStore<Schema extends DBStoreSchema> = Omit<
  DBStore<Schema>,
  "add" | "put" | "update" | "delete" | "clear"
>;

/**
 * Infer a key type for inserting into the object store based on the store schema.
 *
 * It can be either the defined key type or undefined if the store has an auto-incrementing key.
 */
export type StoreInputKey<Schema extends DBStoreSchema> =
  | SchemaValue<Schema["key"]>
  | (Schema["autoIncrement"] extends true ? undefined : never);

/**
 * Infer a key type retrieved from the object store based on the store schema.
 *
 * It can be either the defined key type, auto-incrementing number, or a type at the specified key path.
 */
export type StoreOutputKey<Schema extends DBStoreSchema> =
  | SchemaValue<Schema["key"]>
  | (Schema["autoIncrement"] extends true ? number : never)
  | ValuesAtPaths<SchemaValue<Schema["value"]>, Schema["keyPath"]>;
