import { DBCursor } from "./DBCursor.ts";
import type { DBStoreSchema, StoreOutputKey } from "./DBStore.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { KeyRange, ValidKey } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { ValuesAtPaths } from "./ValuesAtPaths.ts";

/**
 * A schema for a {@link DBIndex}.
 */
export interface DBIndexSchema extends IDBIndexParameters {
  /**
   * The key path of the index.
   *
   * Used to infer the type of the index key based on the store value.
   *
   * @see {@link ValuesAtPaths}
   */
  keyPath: string | readonly string[];
}

/**
 * A wrapper for {@link IDBIndex} with more strict types.
 */
export class DBIndex<
  const StoreSchema extends DBStoreSchema,
  const Name extends keyof StoreSchema["indexes"] & string,
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
  get(key: IndexKey<StoreSchema, Name>): Promise<SchemaValue<StoreSchema["value"]>> {
    return idbReqToPromise(this.#index.get(key as IDBValidKey));
  }

  /**
   * Retrieves a range of records from the index.
   *
   * @see {@link IDBIndex.getAll}
   */
  getAll(keys?: KeyRange<IndexKey<StoreSchema, Name>>): Promise<SchemaValue<StoreSchema["value"]>[]> {
    return idbReqToPromise(this.#index.getAll(keys));
  }

  /**
   * Retrieves a range of keys from the index.
   *
   * @see {@link IDBIndex.getAllKeys}
   */
  getAllKeys(keys?: KeyRange<IndexKey<StoreSchema, Name>>): Promise<StoreOutputKey<StoreSchema>[]> {
    return idbReqToPromise(this.#index.getAllKeys(keys)) as Promise<StoreOutputKey<StoreSchema>[]>;
  }

  /**
   * Opens a cursor on the index.
   *
   * @see {@link IDBIndex.openCursor}
   */
  async openCursor(
    range?: KeyRange<IndexKey<StoreSchema, Name>>,
    direction?: IDBCursorDirection,
  ): Promise<DBCursor<
    SchemaValue<StoreSchema["value"]>,
    IndexKey<StoreSchema, Name>,
    StoreOutputKey<StoreSchema>
  > | null> {
    const cursor = await idbReqToPromise(this.#index.openCursor(range, direction));
    if (cursor) return new DBCursor(cursor);
    return null;
  }

  /**
   * Returns an iterator over the index.
   */
  async *iterate(
    range?: KeyRange<IndexKey<StoreSchema, Name>>,
    direction?: IDBCursorDirection,
  ): AsyncIterable<
    DBCursor<SchemaValue<StoreSchema["value"]>, IndexKey<StoreSchema, Name>, StoreOutputKey<StoreSchema>>,
    undefined,
    undefined
  > {
    let cursor = await this.openCursor(range, direction);
    while (cursor) {
      yield cursor;
      cursor = await cursor.continue();
    }
  }
}

/**
 * Infer a key type for retrieving from the index based on the store schema.
 *
 * It is the type of the value at the specified key path.
 * Additionally, if the index is multi-entry, the key type is flattened if it is an array.
 */
export type IndexKey<
  StoreSchema extends DBStoreSchema,
  IndexName extends keyof StoreSchema["indexes"] & string,
> = StoreSchema["indexes"] extends {}
  ? ValuesAtPaths<
      SchemaValue<StoreSchema["value"]>,
      StoreSchema["indexes"][IndexName]["keyPath"]
    > extends infer Key extends ValidKey
    ? StoreSchema["indexes"][IndexName]["multiEntry"] extends true
      ? FlatArray<Key, 1>
      : Key
    : never
  : never;
