import {
  liveQueryDB,
  type AnyDatabaseSchema,
  type Database,
  type QueryOptions,
  type StoreValue,
} from "idbts";
import { useSubscribable } from "./useSubscribable.ts";

/**
 * React hook that runs a live query against an IndexedDB store
 * and returns the current result array.
 *
 * The hook integrates with React Suspense:
 * the component **suspends** until the first query result is available,
 * then re-renders automatically whenever the underlying data changes.
 *
 * Queries with the same `db`, `storeName`, and `options` are **deduplicated**:
 * multiple components using identical arguments share one live subscription
 * rather than opening redundant cursors.
 *
 * @example
 * ```jsx
 * function UserList() {
 *   const users = useDBQuery(db, "users", { orderBy: "name" });
 *   return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
 * }
 * ```
 */
export function useDBQuery<
  Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): StoreValue<Schema[StoreName]>[] {
  return useSubscribable(
    () => liveQueryDB(db, storeName, options),
    // TODO: don't use JSON.stringify
    ["idbts", db.idb.name, storeName, JSON.stringify(options)],
  );
}
