import type { Observable } from "observable-polyfill/fn";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { IDBValuesAtPaths } from "./IDBValueAtPaths.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import { TIDBCursor } from "./TIDBCursor.ts";
import type { TIDBKeyRange } from "./TIDBKeyRange.ts";
import type { TIDBObjectStoreOutputKey, TIDBObjectStoreSchema } from "./TIDBObjectStore.ts";

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

  /**
   * Watches a range of records in the index.
   */
  watchAll(keys?: TIDBKeyRange<TIDBIndexKey<StoreSchema, IndexName>>): Observable<SchemaValue<StoreSchema["value"]>[]> {
    const O = (globalThis as any).Observable as typeof Observable;
    return new O((subscriber) => {
      const chan = new BroadcastChannel(
        `${this.#index.objectStore.transaction.db.name}-${this.#index.objectStore.name}`,
      );
      const reload = () => {
        this.getAll(keys).then(
          (v) => subscriber.next(v),
          (e) => subscriber.error(e),
        );
      };
      chan.addEventListener("message", reload);
      reload();
      subscriber.addTeardown(() => {
        chan.removeEventListener("message", reload);
        chan.close();
      });
    });
  }

  /**
   * Retrieves a range of keys from the index.
   *
   * @see {@link IDBIndex.getAllKeys}
   */
  getAllKeys(
    keys?: TIDBKeyRange<TIDBIndexKey<StoreSchema, IndexName>>,
  ): Promise<TIDBObjectStoreOutputKey<StoreSchema>[]> {
    return idbReqToPromise(this.#index.getAllKeys(keys)) as Promise<TIDBObjectStoreOutputKey<StoreSchema>[]>;
  }

  /**
   * Opens a cursor on the index.
   *
   * @see {@link IDBIndex.openCursor}
   */
  async openCursor(
    range?: TIDBKeyRange<TIDBIndexKey<StoreSchema, IndexName>>,
    direction?: IDBCursorDirection,
  ): Promise<TIDBCursor<
    SchemaValue<StoreSchema["value"]>,
    TIDBIndexKey<StoreSchema, IndexName>,
    TIDBObjectStoreOutputKey<StoreSchema>
  > | null> {
    const cursor = await idbReqToPromise(this.#index.openCursor(range, direction));
    if (cursor) return new TIDBCursor(cursor);
    return null;
  }

  /**
   * Returns an iterator over the index.
   */
  async *iterate(
    range?: TIDBKeyRange<TIDBIndexKey<StoreSchema, IndexName>>,
    direction?: IDBCursorDirection,
  ): AsyncIterable<
    TIDBCursor<
      SchemaValue<StoreSchema["value"]>,
      TIDBIndexKey<StoreSchema, IndexName>,
      TIDBObjectStoreOutputKey<StoreSchema>
    >,
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
