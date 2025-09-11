import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { IDBValuesAtPaths } from "./IDBValueAtPaths.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { TIDBKeyRange } from "./TIDBKeyRange.ts";
import type { TIDBObjectStoreSchema } from "./TIDBObjectStore.ts";

/**
 * A schema for a {@link TIDBIndex}.
 */
export interface TIDBIndexSchema extends IDBIndexParameters {
  /**
   * The key path of the index.
   *
   * Used to infer the type of the index key based on the store value.
   *
   * @see {@link IDBValuesAtPaths}
   */
  keyPath: string | string[];
}

/**
 * A wrapper for {@link IDBIndex} with more strict types.
 */
export class TIDBIndex<
  const StoreSchema extends TIDBObjectStoreSchema,
  const IndexName extends keyof StoreSchema["indexes"] & string,
> {
  #index: IDBIndex;

  constructor(index: IDBIndex) {
    this.#index = index;
  }

  /**
   * Retrieves a record from the index.
   *
   * @see {@link IDBIndex.get}
   */
  get(key: TIDBIndexKey<StoreSchema, IndexName>): Promise<SchemaValue<StoreSchema["value"]>> {
    return idbReqToPromise(this.#index.get(key));
  }

  /**
   * Retrieves a range of records from the index.
   *
   * @see {@link IDBIndex.getAll}
   */
  getAll(keys?: TIDBKeyRange<TIDBIndexKey<StoreSchema, IndexName>>): Promise<SchemaValue<StoreSchema["value"]>[]> {
    return idbReqToPromise(this.#index.getAll(keys));
  }
}

/**
 * Infer a key type for retrieving from the index based on the store schema.
 *
 * It is the type of the value at the specified key path.
 * Additionally, if the index is multi-entry, the key type is flattened if it is an array.
 */
export type TIDBIndexKey<
  StoreSchema extends TIDBObjectStoreSchema,
  IndexName extends keyof StoreSchema["indexes"] & string,
> = StoreSchema["indexes"] extends {}
  ? IDBValuesAtPaths<
      SchemaValue<StoreSchema["value"]>,
      StoreSchema["indexes"][IndexName]["keyPath"]
    > extends infer Key extends IDBValidKey
    ? StoreSchema["indexes"][IndexName]["multiEntry"] extends true
      ? FlatArray<Key, 1>
      : Key
    : never
  : never;
