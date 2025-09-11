import { TIDBObjectStore } from "./TIDBObjectStore.ts";
import type { TIDBDatabaseSchema } from "./TIDBDatabase.ts";

/**
 * A wrapper for {@link IDBTransaction} with more strict types.
 */
export class TIDBTransaction<
  const DatabaseSchema extends TIDBDatabaseSchema,
  const StoreNames extends keyof DatabaseSchema & string,
  const Mode extends TIDBTransactionMode,
> {
  #tx: IDBTransaction;

  constructor(tx: IDBTransaction) {
    this.#tx = tx;
  }

  /**
   * Access an object store.
   *
   * @see {@link IDBTransaction.objectStore}
   */
  objectStore<const StoreName extends StoreNames>(
    storeName: StoreName,
  ): TIDBObjectStore<DatabaseSchema[StoreName], Mode> {
    return new TIDBObjectStore(this.#tx.objectStore(storeName));
  }

  /**
   * A promise that fulfills with the transaction result.
   *
   * @see {@link IDBTransaction.oncomplete}
   * @see {@link IDBTransaction.onabort}
   * @see {@link IDBTransaction.onerror}
   */
  get done(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#tx.addEventListener("complete", () => resolve());
      this.#tx.addEventListener("abort", () => reject(new DOMException("Transaction aborted", "AbortError")));
      this.#tx.addEventListener("error", () => reject(this.#tx.error));
    });
  }

  /**
   * Commits the transaction.
   *
   * @see {@link IDBTransaction.commit}
   */
  commit() {
    this.#tx.commit();
  }

  /**
   * Aborts the transaction.
   *
   * @see {@link IDBTransaction.abort}
   */
  abort() {
    this.#tx.abort();
  }
}

/**
 * The mode of the transaction which can be either "readonly" or "readwrite".
 *
 * @see {@link IDBTransactionMode}
 */
export type TIDBTransactionMode = "readonly" | "readwrite";
