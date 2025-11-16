import type { AnyDatabaseSchema } from "./Database.ts";
import { DBStore, type ReadonlyDBStore } from "./DBStore.ts";
import type { ElementsUnlessSingle, OptionalArg, Or } from "./typeUtils.ts";

/**
 * A wrapper for {@link IDBTransaction} with more strict types.
 */
export class DBTransaction<
  const DBSchema extends AnyDatabaseSchema,
  const StoreNames extends readonly (keyof DBSchema)[],
  const Mode extends DBTransactionMode,
> {
  #tx: IDBTransaction;
  #done: Promise<void>;

  constructor(tx: IDBTransaction) {
    this.#tx = tx;
    this.#done = new Promise((resolve, reject) => {
      this.#tx.addEventListener("complete", () => resolve());
      this.#tx.addEventListener("abort", () => reject(new DOMException("Transaction aborted", "AbortError")));
      this.#tx.addEventListener("error", () => reject(this.#tx.error));
    });
  }

  /**
   * Access an object store.
   *
   * @see {@link IDBTransaction.objectStore}
   */
  store<const StoreName extends ElementsUnlessSingle<StoreNames>>(
    ...[storeName]: OptionalArg<StoreName>
  ): Mode extends "readwrite"
    ? DBStore<DBSchema[Or<StoreName, StoreNames[number]>]>
    : ReadonlyDBStore<DBSchema[Or<StoreName, StoreNames[number]>]> {
    const name = storeName ?? this.#tx.objectStoreNames[0]!;
    return new DBStore(this.#tx.objectStore(name as string));
  }

  /**
   * A promise that fulfills with the transaction result.
   *
   * @see {@link IDBTransaction.oncomplete}
   * @see {@link IDBTransaction.onabort}
   * @see {@link IDBTransaction.onerror}
   */
  get done(): Promise<void> {
    return this.#done;
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
export type DBTransactionMode = "readonly" | "readwrite";
