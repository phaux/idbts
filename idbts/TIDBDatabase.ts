import type { Observable } from "observable-polyfill/fn";
import { satisfiesKeyRange } from "./satisfiesKeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { TIDBIndexKey } from "./TIDBIndex.ts";
import type { TIDBKeyRange } from "./TIDBKeyRange.ts";
import type {
  TIDBObjectStore,
  TIDBObjectStoreInputKey,
  TIDBObjectStoreOutputKey,
  TIDBObjectStoreSchema,
} from "./TIDBObjectStore.ts";
import { TIDBTransaction, type TIDBTransactionMode } from "./TIDBTransaction.ts";
import type { MaybeArray, OptionalArg, ToArray } from "./typeUtils.ts";

/**
 * A schema for a {@link TIDBDatabase}.
 *
 * It's a map of store names to their schemas.
 */
export type TIDBDatabaseSchema = Record<string, TIDBObjectStoreSchema>;

/**
 * A wrapper for {@link IDBDatabase} with more strict types.
 */
export class TIDBDatabase<const DatabaseSchema extends TIDBDatabaseSchema> implements Disposable {
  #db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.#db = db;
  }

  /**
   * The name of the database.
   *
   * @see {@link IDBDatabase.name}
   */
  get name() {
    return this.#db.name;
  }

  /**
   * Opens a transaction on the specified object stores.
   *
   * @see {@link IDBDatabase.transaction}
   */
  transaction<
    const StoreNames extends MaybeArray<keyof DatabaseSchema & string>,
    const Mode extends TIDBTransactionMode = "readonly",
  >(
    storeNames: StoreNames,
    mode?: Mode,
    options?: IDBTransactionOptions,
  ): TIDBTransaction<DatabaseSchema, ToArray<StoreNames>, Mode> {
    return new TIDBTransaction(this.#db.transaction(storeNames as string | string[], mode, options));
  }

  /**
   * Adds a new record to the object store.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBObjectStore.add}.
   */
  async add<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    value: SchemaValue<DatabaseSchema[StoreName]["value"]>,
    ...[key]: OptionalArg<TIDBObjectStoreInputKey<DatabaseSchema[StoreName]>>
  ): Promise<TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>> {
    const tx = this.transaction([storeName], "readwrite");
    const store = tx.objectStore();
    const newKey = await store.add(value, key as any);
    await tx.done;
    return newKey;
  }

  /**
   * Adds or replaces a record in the object store.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBObjectStore.put}.
   */
  async put<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    value: SchemaValue<DatabaseSchema[StoreName]["value"]>,
    ...[key]: OptionalArg<TIDBObjectStoreInputKey<DatabaseSchema[StoreName]>>
  ): Promise<TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>> {
    const tx = this.transaction([storeName], "readwrite");
    const store = tx.objectStore();
    const newKey = await store.put(value, key as any);
    await tx.done;
    return newKey;
  }

  /**
   * Retrieves a record from the object store by its key.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBObjectStore.get}.
   */
  get<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    key: TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>,
  ): Promise<SchemaValue<DatabaseSchema[StoreName]["value"]>> {
    return this.transaction([storeName])
      .objectStore()
      .get(key as any);
  }

  /**
   * Retrieves a range of records from the object store by their keys.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBObjectStore.getAll}.
   */
  getAll<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    range?: TIDBKeyRange<TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>>,
  ): Promise<SchemaValue<DatabaseSchema[StoreName]["value"]>[]> {
    return this.transaction([storeName])
      .objectStore()
      .getAll(range as any);
  }

  /**
   * Retrieves a range of records from the object store by index.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBIndex.getAll}.
   */
  getAllBy<
    const StoreName extends keyof DatabaseSchema & string,
    const IndexName extends keyof DatabaseSchema[StoreName]["indexes"] & string,
  >(
    storeName: StoreName,
    indexName: IndexName,
    range?: TIDBKeyRange<TIDBIndexKey<DatabaseSchema[StoreName], IndexName>>,
  ): Promise<SchemaValue<DatabaseSchema[StoreName]["value"]>[]> {
    return this.transaction([storeName])
      .objectStore()
      .index(indexName)
      .getAll(range as any);
  }

  /**
   * Watches a single record in the object store.
   */
  watch<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    key: TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>,
  ): Observable<SchemaValue<DatabaseSchema[StoreName]["value"]> | undefined> {
    const O = (globalThis as any).Observable as typeof Observable;
    return new O((subscriber) => {
      const chan = this.#getChannel(storeName);
      const reload = (e?: MessageEvent<IDBValidKey>) => {
        if (e?.data == null || indexedDB.cmp(e.data, key) === 0) {
          this.get(storeName, key).then(
            (v) => subscriber.next(v),
            (e) => subscriber.error(e),
          );
        }
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
   * Watches a range of records in the object store.
   */
  watchAll<const StoreName extends keyof DatabaseSchema & string>(
    storeName: StoreName,
    range?: TIDBKeyRange<TIDBObjectStoreOutputKey<DatabaseSchema[StoreName]>>,
  ): Observable<SchemaValue<DatabaseSchema[StoreName]["value"]>[]> {
    const O = (globalThis as any).Observable as typeof Observable;
    return new O((subscriber) => {
      const chan = this.#getChannel(storeName);
      const reload = (e?: MessageEvent<IDBValidKey>) => {
        if (e?.data == null || satisfiesKeyRange(e.data, range)) {
          this.getAll(storeName, range).then(
            (v) => subscriber.next(v),
            (e) => subscriber.error(e),
          );
        }
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
   * Watches a range of records in the object store by index.
   */
  watchAllBy<
    const StoreName extends keyof DatabaseSchema & string,
    const IndexName extends keyof DatabaseSchema[StoreName]["indexes"] & string,
  >(
    storeName: StoreName,
    indexName: IndexName,
    range?: TIDBKeyRange<TIDBIndexKey<DatabaseSchema[StoreName], IndexName>>,
  ): Observable<SchemaValue<DatabaseSchema[StoreName]["value"]>[]> {
    const O = (globalThis as any).Observable as typeof Observable;
    return new O((subscriber) => {
      const chan = this.#getChannel(storeName);
      const reload = () => {
        this.getAllBy(storeName, indexName, range).then(
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
   * Closes the database connection.
   *
   * @see {@link IDBDatabase.close}
   */
  close() {
    this.#db.close();
  }

  [Symbol.dispose](): void {
    this.#db.close();
  }

  #getChannel(storeName: string) {
    return new BroadcastChannel(`${this.name}-${storeName}`);
  }
}
