import type { AnyDatabaseSchema, Database, StoreValue } from "./Database.ts";
import { getFieldValue, getKeyPathValue } from "./KeyPath.ts";
import { toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";
import { MiniObservable } from "./MiniObservable.ts";
import { query, type QueryOptions } from "./query.ts";
import { getStoreChangesChannel, type StoreChange } from "./storeChangesChannel.ts";

export function liveQuery<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): MiniObservable<StoreValue<Schema[StoreName]>[]> {
  return new MiniObservable((subscriber) => {
    if (subscriber.signal?.aborted) return;
    const { where = {}, orderBy = [], direction } = options;
    let currentResults: StoreValue<Schema[StoreName]>[] | undefined;
    const bufferedChanges: StoreChange<Schema[StoreName]>[] = [];

    const changesChannel = getStoreChangesChannel(db, storeName);
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

    const controller = new AbortController();
    subscriber.signal?.addEventListener("abort", () => controller.abort());
    controller.signal.addEventListener("abort", () => changesChannel.close());

    const keyPath = db.idb.transaction(storeName, "readonly").objectStore(storeName).keyPath!;
    const orderFields = (Array.isArray as (v: unknown) => v is readonly unknown[])(orderBy)
      ? orderBy
      : [orderBy];

    query(db, storeName, options).then(
      (results) => {
        currentResults = results;
        applyChanges(bufferedChanges);
        bufferedChanges.length = 0;
        subscriber.next?.(currentResults);
      },
      (err: Error) => {
        subscriber.error?.(err);
        controller.abort();
      },
    );

    function applyChanges(changes: readonly StoreChange<Schema[StoreName]>[]) {
      for (const change of changes) {
        if (change.oldValue) {
          const key = getKeyPathValue(change.oldValue, keyPath);
          const index = currentResults!.findIndex(
            (item) => indexedDB.cmp(getKeyPathValue(item, keyPath), key) === 0,
          );
          if (index >= 0) {
            currentResults = Array.from(currentResults!);
            currentResults.splice(index, 1);
          }
        }
        if (change.newValue) {
          const key = getKeyPathValue(change.newValue, keyPath);
          if (!where || queryMatches(change.newValue, where)) {
            currentResults = currentResults!
              .filter((item) => indexedDB.cmp(getKeyPathValue(item, keyPath), key) !== 0)
              .concat([change.newValue])
              .sort((a, b) => {
                for (const field of orderFields) {
                  const aValue = getFieldValue(a, field);
                  const bValue = getFieldValue(b, field);
                  let order = indexedDB.cmp(aValue, bValue);
                  if (order !== 0) {
                    if (direction === "prev") order = -order;
                    return order;
                  }
                }
                const aKey = getKeyPathValue(a, keyPath);
                const bKey = getKeyPathValue(b, keyPath);
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

function queryMatches(item: object, filters: Record<string, MaybeKeyRange<IDBValidKey>>): boolean {
  for (const [key, maybeRange] of Object.entries(filters)) {
    const range = toKeyRange(maybeRange);
    if (!range || !range.includes(getFieldValue(item, key))) {
      return false;
    }
  }
  return true;
}
