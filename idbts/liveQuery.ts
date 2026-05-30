import { getDBChangesChannel, type DBChange } from "./changesChannel.ts";
import type { AnyDatabaseSchema, Database } from "./Database.ts";
import { getValueByKeyPath, getValueBySingleKeyPath } from "./getValueByKeyPath.ts";
import { MiniObservable } from "./MiniObservable.ts";
import { query, type QueryOptions } from "./query.ts";
import type { SchemaValue } from "./StandardSchema.ts";

export function liveQuery<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): MiniObservable<SchemaValue<Schema[StoreName]["value"]>[]> {
  return new MiniObservable((subscriber) => {
    const { orderBy, direction } = options;
    let currentResults: any[] | undefined;
    const bufferedChanges: DBChange<any>[] = [];

    const changesChannel = getDBChangesChannel(db.idb.name, storeName);
    changesChannel.addEventListener("message", (event) => {
      const changes = event.data;
      if (!currentResults) {
        bufferedChanges.push(...changes);
      } else {
        const lastResults = currentResults;
        applyChanges(changes);
        if (currentResults !== lastResults) {
          subscriber.next?.(currentResults);
        }
      }
    });
    if (subscriber.signal?.aborted) changesChannel.close();
    else subscriber.signal?.addEventListener("abort", () => changesChannel.close());

    const keyPath = db.idb.transaction(storeName, "readonly").objectStore(storeName).keyPath!;
    const orderFields = Array.isArray(orderBy) ? orderBy : orderBy != null ? [orderBy] : [];

    query(db, storeName, options).then((results) => {
      currentResults = results;
      applyChanges(bufferedChanges);
      bufferedChanges.length = 0;
      subscriber.next?.(currentResults);
    });

    function applyChanges(changes: readonly DBChange<any>[]) {
      for (const change of changes) {
        if (change.oldValue) {
          const key = getValueByKeyPath(change.oldValue, keyPath);
          const index = currentResults!.findIndex(
            (item) => indexedDB.cmp(getValueByKeyPath(item, keyPath), key) === 0,
          );
          if (index >= 0) {
            currentResults = Array.from(currentResults!);
            currentResults.splice(index, 1);
          }
        }
        if (change.newValue) {
          const key = getValueByKeyPath(change.newValue, keyPath);
          if (queryMatches(options, change.newValue)) {
            currentResults = currentResults!
              .filter((item) => indexedDB.cmp(getValueByKeyPath(item, keyPath), key) !== 0)
              .concat([change.newValue])
              .sort((a, b) => {
                for (const field of orderFields) {
                  const aValue = getValueBySingleKeyPath(a, field);
                  const bValue = getValueBySingleKeyPath(b, field);
                  let order = indexedDB.cmp(aValue, bValue);
                  if (order !== 0) {
                    if (direction === "prev") order = -order;
                    return order;
                  }
                }
                const aKey = getValueByKeyPath(a, keyPath);
                const bKey = getValueByKeyPath(b, keyPath);
                let order = indexedDB.cmp(aKey, bKey);
                if (direction === "prev") order = -order;
                return order;
              });
          }
        }
      }
    }
  });
}

function queryMatches(options: QueryOptions<any>, item: any): boolean {
  const { where = {} } = options;
  for (const [key, range] of Object.entries(where)) {
    if (!range.includes(getValueBySingleKeyPath(item, key))) {
      return false;
    }
  }
  return true;
}
