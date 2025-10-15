import type { Observable } from "observable-polyfill/fn";
import type { IndexKey } from "./DBIndex.ts";
import type { DBStore, DBStoreSchema, StoreInputKey, StoreOutputKey } from "./DBStore.ts";
import { DBTransaction, type DBTransactionMode } from "./DBTransaction.ts";
import type { KeyRange, MaybeKeyRange } from "./KeyRange.ts";
import { satisfiesKeyRange } from "./satisfiesKeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { MaybeArray, OptionalArg, ToArray } from "./typeUtils.ts";

/**
 * A schema for a {@link Database}.
 *
 * It's a map of store names to their schemas.
 */
export type DatabaseSchema = Record<string, DBStoreSchema>;

/**
 * A wrapper for {@link IDBDatabase} with more strict types.
 */
export class Database<const Schema extends DatabaseSchema> {
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
  tx<const StoreNames extends MaybeArray<keyof Schema & string>, const Mode extends DBTransactionMode = "readonly">(
    storeNames: StoreNames,
    mode?: Mode,
    options?: IDBTransactionOptions,
  ): DBTransaction<Schema, ToArray<StoreNames>, Mode> {
    return new DBTransaction(this.#db.transaction(storeNames as string | string[], mode, options));
  }

  /**
   * Adds a new record to the object store.
   *
   * It's a shortcut for creating a transaction and calling {@link DBStore.add}.
   */
  async add<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    value: SchemaValue<Schema[StoreName]["value"]>,
    ...[key]: OptionalArg<StoreInputKey<Schema[StoreName]>>
  ): Promise<StoreOutputKey<Schema[StoreName]>> {
    const tx = this.tx([storeName], "readwrite");
    const store = tx.store();
    const newKey = await store.add(value, key as any);
    await tx.done;
    return newKey;
  }

  /**
   * Adds or replaces a record in the object store.
   *
   * It's a shortcut for creating a transaction and calling {@link DBStore.put}.
   */
  async put<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    value: SchemaValue<Schema[StoreName]["value"]>,
    ...[key]: OptionalArg<StoreInputKey<Schema[StoreName]>>
  ): Promise<StoreOutputKey<Schema[StoreName]>> {
    const tx = this.tx([storeName], "readwrite");
    const store = tx.store();
    const newKey = await store.put(value, key as any);
    await tx.done;
    return newKey;
  }

  /**
   * Retrieves a record from the object store by its key.
   *
   * It's a shortcut for creating a transaction and calling {@link DBStore.get}.
   */
  get<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    key: StoreOutputKey<Schema[StoreName]>,
  ): Promise<SchemaValue<Schema[StoreName]["value"]>> {
    return this.tx([storeName])
      .store()
      .get(key as any);
  }

  /**
   * Retrieves a range of records from the object store by their keys.
   *
   * It's a shortcut for creating a transaction and calling {@link DBStore.getAll}.
   */
  getAll<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    range?: KeyRange<StoreOutputKey<Schema[StoreName]>>,
  ): Promise<SchemaValue<Schema[StoreName]["value"]>[]> {
    return this.tx([storeName])
      .store()
      .getAll(range as any);
  }

  /**
   * Retrieves a range of records from the object store by index.
   *
   * It's a shortcut for creating a transaction and calling {@link TIDBIndex.getAll}.
   */
  getAllBy<
    const StoreName extends keyof Schema & string,
    const IndexName extends keyof Schema[StoreName]["indexes"] & string,
  >(
    storeName: StoreName,
    indexName: IndexName,
    range?: KeyRange<IndexKey<Schema[StoreName], IndexName>>,
  ): Promise<SchemaValue<Schema[StoreName]["value"]>[]> {
    return this.tx([storeName])
      .store()
      .index(indexName)
      .getAll(range as any);
  }

  /**
   * Watches a single record in the object store.
   */
  watch<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    key: StoreOutputKey<Schema[StoreName]>,
  ): Observable<SchemaValue<Schema[StoreName]["value"]> | undefined> {
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
  watchAll<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    range?: KeyRange<StoreOutputKey<Schema[StoreName]>>,
  ): Observable<SchemaValue<Schema[StoreName]["value"]>[]> {
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
    const StoreName extends keyof Schema & string,
    const IndexName extends keyof Schema[StoreName]["indexes"] & string,
  >(
    storeName: StoreName,
    indexName: IndexName,
    range?: KeyRange<IndexKey<Schema[StoreName], IndexName>>,
  ): Observable<SchemaValue<Schema[StoreName]["value"]>[]> {
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
   * Deletes a record or a range of records from the object store.
   */
  async delete<const StoreName extends keyof Schema & string>(
    storeName: StoreName,
    key: MaybeKeyRange<StoreOutputKey<Schema[StoreName]>>,
  ) {
    const tx = this.tx([storeName], "readwrite");
    const store = tx.store();
    await store.delete(key as any);
    await tx.done;
  }

  /**
   * Deletes all records from the object store.
   */
  async clear<const StoreName extends keyof Schema & string>(storeName: StoreName) {
    const tx = this.tx([storeName], "readwrite");
    const store = tx.store();
    await store.clear();
    await tx.done;
  }

  /**
   * Closes the database connection.
   *
   * @see {@link IDBDatabase.close}
   */
  close() {
    this.#db.close();
  }

  #getChannel(storeName: string) {
    return new BroadcastChannel(`${this.name}-${storeName}`);
  }
}
