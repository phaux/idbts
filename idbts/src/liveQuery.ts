import type { AnyDatabaseSchema, Database, StoreValue } from "./Database.ts";
import { getFieldValue, getKeyPathValue } from "./KeyPath.ts";
import { toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";
import { MiniObservable } from "./MiniObservable.ts";
import { query, type QueryOptions } from "./query.ts";
import { getStoreChangesChannel, type StoreChange } from "./storeChangesChannel.ts";

/**
 * Returns an observable that emits the full, up-to-date result array
 * for the given query and re-emits whenever matching records change.
 *
 * First, it retrieves initial results using {@link query},
 * then subscribes to the channel from {@link getStoreChangesChannel}
 * and applies incoming changes to the live results array.
 *
 * The items which didn't change from one emit to the next
 * are guaranteed to be the same objects as before,
 * so subscribers can memoize based on object reference equality.
 */
export function liveQuery<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): MiniObservable<StoreValue<Schema[StoreName]>[]> {
  return new MiniObservable((subscriber) => {
    const { where = {}, orderBy = [], direction } = options;

    // Bail out immediately if the subscriber was already cancelled.
    if (subscriber.signal?.aborted) return;

    /**
     * `currentResults` is undefined until the initial query resolves.
     * This flag is used by the message handler to decide whether to buffer or apply.
     */
    let currentResults: StoreValue<Schema[StoreName]>[] | undefined;

    /**
     * Changes that arrive while the initial query is in flight are stored here
     * and replayed once `currentResults` is populated.
     */
    const bufferedChanges: StoreChange<Schema[StoreName]>[] = [];

    // Open the BroadcastChannel before issuing the query
    // so we cannot miss any mutations that happen before
    // or just afterthe query resolves.
    const changesChannel = getStoreChangesChannel(db, storeName);
    changesChannel.addEventListener("message", (event) => {
      const changes = event.data;
      if (!currentResults) {
        // Initial query still pending — buffer the changes for later replay.
        bufferedChanges.push(...changes);
      } else {
        // Initial query already resolved — apply changes to the live array
        // and emit a new value if anything changed.
        const lastResults = currentResults;
        applyChanges(changes);
        if (currentResults !== lastResults) {
          subscriber.next?.(currentResults);
        }
      }
    });

    // Wire up cancellation: aborting the subscriber signal closes the channel.
    const controller = new AbortController();
    subscriber.signal?.addEventListener("abort", () => controller.abort());
    controller.signal.addEventListener("abort", () => changesChannel.close());

    // Open a no-op transaction to obtain the primary key path.
    const primaryKeyPath = db.idb
      .transaction(storeName, "readonly")
      .objectStore(storeName).keyPath!;

    const orderFields = (Array.isArray as (v: unknown) => v is readonly unknown[])(orderBy)
      ? orderBy
      : [orderBy];

    // Initial query.
    query(db, storeName, options).then(
      (results) => {
        currentResults = results;
        // Replay any changes that arrived while the query was in flight.
        applyChanges(bufferedChanges);
        bufferedChanges.length = 0;
        // Initial emit.
        subscriber.next?.(currentResults);
      },
      (err: Error) => {
        // Clean up and propagate query errors.
        controller.abort();
        subscriber.error?.(err);
      },
    );

    /**
     * Integrates a batch of store changes into `currentResults`.
     *
     * For each change:
     * - If the change has an `oldValue`, the corresponding record is removed.
     * - If the change has a `newValue` that satisfies the active `where` filters,
     *   the old entry with the same primary key is evicted (to handle updates)
     *   and the new value is inserted at an appropriate position.
     *
     * The array reference is replaced (not mutated in-place) whenever any modification is made,
     * making change detection via reference equality straightforward for callers.
     */
    function applyChanges(changes: readonly StoreChange<Schema[StoreName]>[]) {
      for (const change of changes) {
        if (change.oldValue) {
          // Remove the stale record from the result set by its primary key.
          const key = getKeyPathValue(change.oldValue, primaryKeyPath);
          const index = currentResults!.findIndex(
            (item) => indexedDB.cmp(getKeyPathValue(item, primaryKeyPath), key) === 0,
          );
          if (index >= 0) {
            currentResults = Array.from(currentResults!);
            currentResults.splice(index, 1);
          }
        }
        if (change.newValue) {
          const key = getKeyPathValue(change.newValue, primaryKeyPath);
          if (!where || queryMatches(change.newValue, where)) {
            // Evict any existing entry with the same primary key (upsert semantics),
            // append the new value, and re-sort.
            currentResults = currentResults!
              .filter((item) => indexedDB.cmp(getKeyPathValue(item, primaryKeyPath), key) !== 0)
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
                // Fall back to primary-key order as a stable tie-breaker.
                const aKey = getKeyPathValue(a, primaryKeyPath);
                const bKey = getKeyPathValue(b, primaryKeyPath);
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

/**
 * Checks whether a store record satisfies all `filters`.
 *
 * Each entry in `filters` is converted to an `IDBKeyRange` via {@link toKeyRange}.
 * Entries that produce a `null` range are skipped — they impose no constraint.
 */
function queryMatches(
  item: object,
  filters: Record<string, MaybeKeyRange<IDBValidKey> | undefined>,
): boolean {
  for (const [key, maybeRange] of Object.entries(filters)) {
    const range = toKeyRange(maybeRange);
    if (!range) continue;
    if (!range.includes(getFieldValue(item, key))) {
      return false;
    }
  }
  return true;
}
