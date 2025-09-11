import { type TIDBDatabaseSchema, TIDBDatabase } from "./TIDBDatabase.ts";

/**
 * Options for {@link openTIDB}.
 */
export interface OpenTIDBOptions {
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
export function openTIDB<const T extends TIDBDatabaseSchema>(
  name: string,
  version: number,
  schema: T,
  options?: OpenTIDBOptions,
): Promise<TIDBDatabase<T>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = options?.onVersionChange ?? null;
      db.onclose = options?.onClose ?? null;
      resolve(new TIDBDatabase(db));
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

export * from "./TIDBDatabase.ts";
export * from "./TIDBTransaction.ts";
export * from "./TIDBObjectStore.ts";
export * from "./TIDBIndex.ts";
export * from "./TIDBKeyRange.ts";
export * from "./StandardSchema.ts";
