import type { TIDBObjectStoreSchema } from "./TIDBObjectStore.ts";
import { TIDBTransaction, type TIDBTransactionMode } from "./TIDBTransaction.ts";
import type { MaybeArray, ToArray } from "./typeUtils.ts";

/**
 * A schema for a {@link TIDBDatabase}.
 *
 * It's a map of store names to their schemas.
 */
export type TIDBDatabaseSchema = Record<string, TIDBObjectStoreSchema>;

/**
 * A wrapper for {@link IDBDatabase} with more strict types.
 */
export class TIDBDatabase<const DatabaseSchema extends TIDBDatabaseSchema> {
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
   * Closes the database connection.
   *
   * @see {@link IDBDatabase.close}
   */
  close() {
    this.#db.close();
  }
}
