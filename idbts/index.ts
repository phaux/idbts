import { type DatabaseSchema, Database } from "./Database.ts";

/**
 * Options for {@link openDB}.
 */
export interface OpenDBOptions {
  onUpgradeNeeded: IDBOpenDBRequest["onupgradeneeded"];
  onBlocked: IDBOpenDBRequest["onblocked"];
  onVersionChange: IDBDatabase["onversionchange"];
  onClose: IDBDatabase["onclose"];
}

/**
 * Opens a Typed IndexedDB database.
 *
 * It will automatically create stores and indexes specified in the schema.
 * All you have to do is bump the database version when you add new ones.
 *
 * @see {@link indexedDB.open}
 */
export function openDB<const T extends DatabaseSchema>(
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
      reject(request.error ?? new DOMException("Unknown error", "AbortError"));
    };
    request.onupgradeneeded = function (ev) {
      try {
        const db = request.result;
        const tx = request.transaction!;
        for (const [storeName, storeSchema] of Object.entries(schema)) {
          const store = tx.objectStoreNames.contains(storeName)
            ? tx.objectStore(storeName)
            : db.createObjectStore(storeName, storeSchema);
          if (storeSchema.indexes) {
            for (const indexSchema of Object.entries(storeSchema.indexes)) {
              const [name, { keyPath, ...params }] = indexSchema;
              if (!store.indexNames.contains(name)) {
                store.createIndex(name, keyPath, params);
              }
            }
          }
        }
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
export * from "./StandardSchema.ts";
