import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { IDBValuesAtPaths } from "./IDBValueAtPaths.ts";
import type { SchemaValue, StandardSchema, schema } from "./StandardSchema.ts";
import { TIDBIndex, type TIDBIndexSchema } from "./TIDBIndex.ts";
import type { MaybeTIDBKeyRange, TIDBKeyRange } from "./TIDBKeyRange.ts";
import type { OptionalArg } from "./typeUtils.ts";

/**
 * A schema for a {@link TIDBObjectStore}.
 */
export interface TIDBObjectStoreSchema extends IDBObjectStoreParameters {
  /**
   * The schema of the external key.
   *
   * External keys are passed to {@link TIDBObjectStore.add} and {@link TIDBObjectStore.put} as a separate argument.
   *
   * Alternatively, an inline key can be defined by specifying the {@link keyPath} property.
   */
  key?: StandardSchema<IDBValidKey>;
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
  indexes?: Record<string, TIDBIndexSchema>;
}

/**
 * A wrapper for {@link IDBObjectStore} with more strict types.
 */
export class TIDBObjectStore<const StoreSchema extends TIDBObjectStoreSchema> {
  #store: IDBObjectStore;

  constructor(store: IDBObjectStore) {
    this.#store = store;
  }

  /**
   * Adds a new record to the object store.
   *
   * @see {@link IDBObjectStore.add}
   */
  add(
    value: SchemaValue<StoreSchema["value"]>,
    ...[key]: OptionalArg<TIDBObjectStoreInputKey<StoreSchema>>
  ): Promise<TIDBObjectStoreOutputKey<StoreSchema>> {
    return idbReqToPromise(this.#store.add(value, key)) as Promise<TIDBObjectStoreOutputKey<StoreSchema>>;
  }

  /**
   * Adds or replaces a record in the object store.
   *
   * @see {@link IDBObjectStore.put}
   */
  put(
    value: SchemaValue<StoreSchema["value"]>,
    ...[key]: OptionalArg<TIDBObjectStoreInputKey<StoreSchema>>
  ): Promise<TIDBObjectStoreOutputKey<StoreSchema>> {
    return idbReqToPromise(this.#store.put(value, key)) as Promise<TIDBObjectStoreOutputKey<StoreSchema>>;
  }

  /**
   * Updates a record in the object store using the provided updater function.
   *
   * Updater is called with the current value of the record or undefined if the record doesn't exist.
   * If the updater returns undefined, the record will be deleted.
   */
  async update(
    key: TIDBObjectStoreOutputKey<StoreSchema>,
    updater: (value: SchemaValue<StoreSchema["value"]> | undefined) => SchemaValue<StoreSchema["value"]> | undefined,
  ): Promise<TIDBObjectStoreOutputKey<StoreSchema> | undefined> {
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
  get(key: TIDBObjectStoreOutputKey<StoreSchema>): Promise<SchemaValue<StoreSchema["value"]>> {
    return idbReqToPromise(this.#store.get(key));
  }

  /**
   * Retrieves a range of records from the object store by their keys.
   *
   * @see {@link IDBObjectStore.getAll}
   */
  getAll(range?: TIDBKeyRange<TIDBObjectStoreOutputKey<StoreSchema>>): Promise<SchemaValue<StoreSchema["value"]>[]> {
    return idbReqToPromise(this.#store.getAll(range));
  }

  /**
   * Deletes a record or range of records from the object store by their keys.
   *
   * @see {@link IDBObjectStore.delete}
   */
  delete(key: MaybeTIDBKeyRange<TIDBObjectStoreOutputKey<StoreSchema>>): Promise<void> {
    return idbReqToPromise(this.#store.delete(key));
  }

  /**
   * Access an index of the object store.
   *
   * @see {@link IDBObjectStore.index}
   */
  index<const IndexName extends keyof StoreSchema["indexes"] & string>(
    indexName: IndexName,
  ): TIDBIndex<StoreSchema, IndexName> {
    return new TIDBIndex(this.#store.index(indexName));
  }

  /**
   * Deletes all records from the object store.
   *
   * @see {@link IDBObjectStore.clear}
   */
  clear(): Promise<void> {
    return idbReqToPromise(this.#store.clear());
  }
}

/**
 * A readonly version of {@link TIDBObjectStore}.
 *
 * It omits the methods that modify the object store.
 */
export type TIDBReadOnlyObjectStore<StoreSchema extends TIDBObjectStoreSchema> = Omit<
  TIDBObjectStore<StoreSchema>,
  "add" | "put" | "delete" | "clear"
>;

/**
 * Infer a key type for inserting into the object store based on the store schema.
 *
 * It can be either the defined key type or undefined if the store has an auto-incrementing key.
 */
export type TIDBObjectStoreInputKey<StoreSchema extends TIDBObjectStoreSchema> =
  | SchemaValue<StoreSchema["key"]>
  | (StoreSchema["autoIncrement"] extends true ? undefined : never);

/**
 * Infer a key type retrieved from the object store based on the store schema.
 *
 * It can be either the defined key type, auto-incrementing number, or a type at the specified key path.
 */
export type TIDBObjectStoreOutputKey<StoreSchema extends TIDBObjectStoreSchema> =
  | SchemaValue<StoreSchema["key"]>
  | (StoreSchema["autoIncrement"] extends true ? number : never)
  | IDBValuesAtPaths<SchemaValue<StoreSchema["value"]>, StoreSchema["keyPath"]>;
