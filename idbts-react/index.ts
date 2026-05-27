import {
  liveQuery,
  type AnyDatabaseSchema,
  type Database,
  type QueryOptions,
  type SchemaValue,
} from "idbts";
import { useSubscribable } from "./useSubscribable.ts";

export function useDBQuery<
  Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): SchemaValue<Schema[StoreName]["value"]>[] {
  return useSubscribable(
    () => liveQuery(db, storeName, options),
    ["idbts", db.idb.name, storeName, JSON.stringify(options)],
  );
}
