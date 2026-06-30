import { type AnyDatabaseSchema, Database } from "./Database.ts";

/**
 * Options for {@link openDB}.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest
 */
export interface OpenDBOptions {
  /**
   * Fired on the request object when database was opened with a higher version number
   * and an exclusive upgrade transaction was successfully created.
   *
   * The store and index creation and deletion operations
   * are performed automatically just before this callback is invoked.
   * You can use this callback to specify additional migration logic.
   *
   * The openDB promise settles after this callback is invoked
   * and all pending transaction operations are finished.
   *
   * @see {@link IDBOpenDBRequest.onupgradeneeded}
   */
  onUpgradeNeeded?: IDBOpenDBRequest["onupgradeneeded"];

  /**
   * Fired on the request when an attempt was made to open this database with a higher version number,
   * but an already open connection to the same database is blocking the upgrade transaction.
   *
   * You can use this callback to ask the user to close other browser tabs of the app.
   *
   * The openDB promise will not resolve as long as the database is blocked.
   *
   * @see {@link IDBOpenDBRequest.onblocked}
   */
  onBlocked?: IDBOpenDBRequest["onblocked"];

  /**
   * Fired on the database when it's already opened and a version upgrade was requested elsewhere.
   * For example, if the database was opened with a higher version in another tab.
   *
   * You can use this callback to inform the user that the current tab needs to be closed
   * or reload it automatically if it won't disrupt the user.
   *
   * If you know you will only ever make backward-compatible changes,
   * you can use this event to close and reopen the database in the background
   * without loading the new app code yet.
   *
   * The openDB promise is already resolved when this event is fired.
   *
   * @see {@link IDBDatabase.onversionchange}
   */
  onVersionChange?: IDBDatabase["onversionchange"];

  /**
   * Fired on the database when it's unexpectedly closed.
   * For example, if the user clears the database in the browser's history preferences.
   *
   * @see {@link IDBDatabase.onclose}
   */
  onClose?: IDBDatabase["onclose"];
}
/**
 * Opens an IndexedDB database.
 *
 * It will automatically create stores and indexes specified in the schema.
 * All you have to do is bump the database version when you add new ones.
 *
 * Example usage:
 *
 * ```ts
 * const db = await openDB("my-db", 1, {
 *   posts: {
 *     itemSchema: schema<PostEntry>(),
 *     primaryKeyPath: "id",
 *     indexedKeyPaths: {
 *       authorId: {},
 *       datePublished: { sortable: true },
 *     },
 *   },
 * });
 * ```
 *
 * @see {@link indexedDB.open}
 */
export async function openDB<const T extends AnyDatabaseSchema>(
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
      resolve(new Database(db, schema));
    };
    request.onerror = () => {
      reject(request.error!);
    };
    request.onupgradeneeded = function (ev) {
      try {
        const db = request.result;
        const tx = request.transaction!;
        const wantedStoreNames = new Set<string>();
        // Create new stores.
        for (const [storeName, storeSchema] of Object.entries(schema)) {
          wantedStoreNames.add(storeName);
          const { primaryKeyPath, indexedKeyPaths = {} } = storeSchema;
          const store = tx.objectStoreNames.contains(storeName)
            ? tx.objectStore(storeName)
            : db.createObjectStore(storeName, { keyPath: primaryKeyPath });
          // Create new indexes.
          const wantedIndexNames = new Set<string>();
          const sortableKeyPaths = Object.entries(indexedKeyPaths)
            .filter(([, keySchema]) => keySchema.sortable ?? false)
            .map(([keyPath]) => keyPath);
          for (const [keyPath, keySchema] of Object.entries(indexedKeyPaths)) {
            const { multiEntry = false, unique = false } = keySchema;
            wantedIndexNames.add(keyPath);
            if (!store.indexNames.contains(keyPath)) {
              store.createIndex(keyPath, keyPath, { multiEntry, unique });
            }
            // Create composite indexes for combinations of this key path with every sortable key path.
            // Multi entry indexes can't be composite (IndexedDB limitation).
            if (!multiEntry) {
              for (const sortedKeyPath of sortableKeyPaths) {
                if (sortedKeyPath === keyPath) continue;
                const indexName = `${keyPath}+${sortedKeyPath}`;
                wantedIndexNames.add(indexName);
                if (!store.indexNames.contains(indexName)) {
                  store.createIndex(indexName, [keyPath, sortedKeyPath]);
                }
              }
            }
          }
          // Delete old indexes.
          for (const indexName of Array.from(store.indexNames)) {
            if (!wantedIndexNames.has(indexName)) {
              store.deleteIndex(indexName);
            }
          }
        }
        // Delete old stores.
        for (const storeName of Array.from(tx.objectStoreNames)) {
          if (!wantedStoreNames.has(storeName)) {
            db.deleteObjectStore(storeName);
          }
        }
        // Call user's callback.
        options?.onUpgradeNeeded?.call(this, ev);
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(error);
      }
    };
    request.onblocked = options?.onBlocked ?? null;
  });
}
