import type { SchemaValue, Database, DatabaseSchema, IndexKey, KeyRange, StoreOutputKey } from "idbts";
import { useObservable } from "./useObservable.ts";

export function useDBQuery<Schema extends DatabaseSchema, StoreName extends keyof Schema & string>(
  db: Database<Schema>,
  storeName: StoreName,
  key: StoreOutputKey<Schema[StoreName]>,
): SchemaValue<Schema[StoreName]["value"]> | undefined {
  return useObservable(() => db.watch(storeName, key), [db.name, storeName, key]);
}

export function useDBQueryAll<Schema extends DatabaseSchema, StoreName extends keyof Schema & string>(
  db: Database<Schema>,
  storeName: StoreName,
  range?: KeyRange<StoreOutputKey<Schema[StoreName]>>,
): SchemaValue<Schema[StoreName]["value"]>[] {
  return useObservable(() => db.watchAll(storeName, range), [db.name, storeName, range]);
}

export function useDBQueryAllBy<
  Schema extends DatabaseSchema,
  StoreName extends keyof Schema & string,
  IndexName extends keyof Schema[StoreName]["indexes"] & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  indexName: IndexName,
  range?: KeyRange<IndexKey<Schema[StoreName], IndexName>>,
): SchemaValue<Schema[StoreName]["value"]>[] {
  return useObservable(() => db.watchAllBy(storeName, indexName, range), [db.name, storeName, indexName, range]);
}

export * from "idbts";
