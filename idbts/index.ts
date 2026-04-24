import { type AnyDatabaseSchema, Database } from "./Database.ts";

/**
 * Options for {@link openDB}.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/open}
 */
export interface OpenDBOptions {
  /**
   * Fired when database was opened with a version number higher than its current version
   * and an exclusive upgrade transaction was successfully created.
   *
   * @see {@link IDBOpenDBRequest.onupgradeneeded}
   */
  onUpgradeNeeded?: IDBOpenDBRequest["onupgradeneeded"];

  /**
   * Fired when an attempt was made to open a database with a version number higher than its current version,
   * but an already open connection to the same database is blocking the upgrade transaction.
   *
   * @see {@link IDBOpenDBRequest.onblocked}
   */
  onBlocked?: IDBOpenDBRequest["onblocked"];

  /**
   * Fired when this database is already opened and a structure change was requested elsewhere.
   * For example, if the database was opened with a higher version in another tab.
   *
   * You can use this callback to inform the user that the app needs to be reloaded.
   *
   * @see {@link IDBDatabase.onversionchange}
   */
  onVersionChange?: IDBDatabase["onversionchange"];

  /**
   * Fired when the database is unexpectedly closed.
   * For example, if the user clears the database in the browser's history preferences.
   *
   * @see {@link IDBDatabase.onclose}
   */
  onClose?: IDBDatabase["onclose"];
}

/**
 * Opens a Typed IndexedDB database.
 *
 * It will automatically create stores and indexes specified in the schema.
 * All you have to do is bump the database version when you add new ones.
 *
 * @see {@link indexedDB.open}
 */
export function openDB<const T extends AnyDatabaseSchema>(
  name: string,
  version: number,
  schema: T,
  options?: OpenDBOptions,
): Promise<Database<T>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = options?.onVersionChange ?? null;
      db.onclose = options?.onClose ?? null;
      resolve(new Database(db));
    };
    request.onerror = () => {
      reject(request.error!);
    };
    request.onupgradeneeded = function (ev) {
      try {
        const db = request.result;
        const tx = request.transaction!;
        // Create new stores.
        for (const [storeName, storeSchema] of Object.entries(schema)) {
          const store = tx.objectStoreNames.contains(storeName)
            ? tx.objectStore(storeName)
            : db.createObjectStore(storeName, storeSchema);
          // Create new indexes.
          const indexSchemas = storeSchema.indexes ?? {};
          for (const [name, indexSchema] of Object.entries(indexSchemas)) {
            const { keyPath, ...params } = indexSchema;
            if (!store.indexNames.contains(name)) {
              store.createIndex(name, keyPath as string | string[], params);
            }
          }
          // Delete old indexes.
          for (const indexName of Array.from(store.indexNames)) {
            if (!Object.hasOwn(indexSchemas, indexName)) {
              store.deleteIndex(indexName);
            }
          }
        }
        // Delete old stores.
        for (const storeName of Array.from(tx.objectStoreNames)) {
          if (!Object.hasOwn(schema, storeName)) {
            db.deleteObjectStore(storeName);
          }
        }
        // Call user's callback.
        options?.onUpgradeNeeded?.call(this, ev);
      } catch (error) {
        reject(error);
      }
    };
    request.onblocked = options?.onBlocked ?? null;
  });
}

export * from "./Database.ts";
export * from "./DBCursor.ts";
export * from "./DBIndex.ts";
export * from "./DBStore.ts";
export * from "./DBTransaction.ts";
export * from "./KeyRange.ts";
export * from "./query.ts";
export * from "./StandardSchema.ts";
