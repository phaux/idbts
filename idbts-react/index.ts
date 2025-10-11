import type {
  SchemaValue,
  TIDBDatabase,
  TIDBDatabaseSchema,
  TIDBIndexKey,
  TIDBKeyRange,
  TIDBObjectStoreOutputKey,
} from "idbts";
import { useObservable } from "./useObservable.ts";

export function useTIDBQuery<Schema extends TIDBDatabaseSchema, StoreName extends keyof Schema & string>(
  db: TIDBDatabase<Schema>,
  storeName: StoreName,
  key: TIDBObjectStoreOutputKey<Schema[StoreName]>,
): SchemaValue<Schema[StoreName]["value"]> | undefined {
  return useObservable(() => db.watch(storeName, key), [db.name, storeName, key]);
}

export function useTIDBQueryAll<Schema extends TIDBDatabaseSchema, StoreName extends keyof Schema & string>(
  db: TIDBDatabase<Schema>,
  storeName: StoreName,
  range?: TIDBKeyRange<TIDBObjectStoreOutputKey<Schema[StoreName]>>,
): SchemaValue<Schema[StoreName]["value"]>[] {
  return useObservable(() => db.watchAll(storeName, range), [db.name, storeName, range]);
}

export function useTIDBQueryAllBy<
  Schema extends TIDBDatabaseSchema,
  StoreName extends keyof Schema & string,
  IndexName extends keyof Schema[StoreName]["indexes"] & string,
>(
  db: TIDBDatabase<Schema>,
  storeName: StoreName,
  indexName: IndexName,
  range?: TIDBKeyRange<TIDBIndexKey<Schema[StoreName], IndexName>>,
): SchemaValue<Schema[StoreName]["value"]>[] {
  return useObservable(() => db.watchAllBy(storeName, indexName, range), [db.name, storeName, indexName, range]);
}

export * from "idbts";
