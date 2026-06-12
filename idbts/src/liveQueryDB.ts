import type { AnyDatabaseSchema, Database, StoreValue } from "./Database.ts";
import { getFieldValue, getKeyPathValue } from "./KeyPath.ts";
import { toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";
import { MiniObservable } from "./MiniObservable.ts";
import { queryDB, type QueryOptions } from "./queryDB.ts";
import { getStoreChangesChannel, type StoreChange } from "./storeChangesChannel.ts";

/**
 * Returns an observable that emits the full, up-to-date result array
 * for the given query and re-emits whenever matching records change.
 *
 * First, it retrieves initial results using {@link queryDB},
 * then subscribes to the channel from {@link getStoreChangesChannel}
 * and applies incoming changes to the live results array.
 *
 * The items which didn't change from one emit to the next
 * are guaranteed to be the same objects as before,
 * so subscribers can memoize based on object reference equality.
 *
 * Example usage:
 *
 * ```ts
 * const ac = new AbortController();
 * const liveUsers = liveQueryDB(db, "users", { orderBy: "name" });
 * liveUsers.subscribe({
 *   next: (users) => console.log("Current users:", users),
 *   error: (err) => console.error("Query error:", err),
 * }, { signal: ac.signal });
 * // Later, to clean up:
 * ac.abort();
 * ```
 */
export function liveQueryDB<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): MiniObservable<StoreValue<Schema[StoreName]>[]> {
  return new MiniObservable((subscriber) => {
    const { where = {}, orderBy = [], direction, limit = Infinity } = options;

    // Bail out immediately if the subscriber was already cancelled.
    if (subscriber.signal?.aborted ?? false) return;

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

    /**
     * Promise chain used to serialise all async `applyChanges` calls.
     * Each new task is appended with `.then()` so that a re-query triggered
     * by a deletion always completes before the next batch of changes is
     * processed, preventing torn intermediate state.
     */
    let queue: Promise<void> = Promise.resolve();

    // Open the BroadcastChannel before issuing the query
    // so we cannot miss any mutations that happen before
    // or just after the query resolves.
    const changesChannel = getStoreChangesChannel(db, storeName);
    changesChannel.addEventListener("message", (event) => {
      const changes = event.data;
      if (!currentResults) {
        // Initial query still pending — buffer the changes for later replay.
        bufferedChanges.push(...changes);
        return;
      }
      queue = queue
        .then(async () => {
          if (controller.signal.aborted) return;
          const lastResults = currentResults;
          await applyChanges(changes);
          if (currentResults !== lastResults) {
            subscriber.next?.(currentResults!);
          }
        })
        .catch((err: unknown) => {
          controller.abort();
          subscriber.error?.(err as Error);
        });
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
    queryDB(db, storeName, options).then(
      (results) => {
        currentResults = results;
        // Queue the replay so it runs before any live changes that arrived
        // between currentResults being set and this task running.
        queue = queue
          .then(async () => {
            await applyChanges(bufferedChanges);
            bufferedChanges.length = 0;
            subscriber.next?.(currentResults!);
          })
          .catch((err: unknown) => {
            controller.abort();
            subscriber.error?.(err as Error);
          });
      },
      (err: unknown) => {
        // Clean up and propagate query errors.
        controller.abort();
        subscriber.error?.(err as Error);
      },
    );

    /**
     * Integrates a batch of store changes into `currentResults`.
     *
     * For each change:
     * - If the change has an `oldValue`, the corresponding record is removed.
     *   When `limit` is set and the removal brings `currentResults` below the
     *   limit, a fresh re-query is `await`ed to refill the window.
     * - If the change has a `newValue` that satisfies the active `where` filters,
     *   the old entry with the same primary key is evicted (to handle updates)
     *   and the new value is inserted at an appropriate position.
     *   The result is then truncated to `limit` when set.
     *
     * The array reference is replaced (not mutated in-place)
     * only when the visible content actually changes,
     * making reference-equality change detection reliable for callers.
     */
    async function applyChanges(changes: readonly StoreChange<Schema[StoreName]>[]) {
      for (const change of changes) {
        if (change.oldValue) {
          // Remove the stale record from the result set by its primary key.
          const key = getKeyPathValue(change.oldValue, primaryKeyPath);
          const index = currentResults!.findIndex(
            (item) => indexedDB.cmp(getKeyPathValue(item, primaryKeyPath), key) === 0,
          );
          if (index >= 0) {
            const oldLength = currentResults!.length;

            // Clone array because splice mutates.
            currentResults = Array.from(currentResults!);
            currentResults.splice(index, 1);

            // When we were at the limit and we've fallen below it,
            // refill by re-running the full query.
            if (oldLength === limit && currentResults.length < limit) {
              const prevResults = currentResults;
              const freshResults = await queryDB(db, storeName, options);
              if (controller.signal.aborted) return;
              // Merge: reuse existing object references for items that are still present
              // so that reference-equality checks remain valid.
              currentResults = freshResults.map((freshItem) => {
                const k = getKeyPathValue(freshItem, primaryKeyPath);
                return (
                  prevResults.find(
                    (item) => indexedDB.cmp(getKeyPathValue(item, primaryKeyPath), k) === 0,
                  ) ?? freshItem
                );
              });
            }
          }
        }
        if (change.newValue) {
          const key = getKeyPathValue(change.newValue, primaryKeyPath);
          if (queryMatches(change.newValue, where)) {
            // Evict any existing entry with the same primary key (upsert semantics),
            // append the new value, and re-sort.
            const newResults = currentResults!
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
              })
              .slice(0, limit);

            // Only replace the array reference when the visible content actually changed,
            // so that callers relying on reference equality are not misled
            // by no-op inserts that land beyond the limit window.
            if (
              newResults.length !== currentResults!.length ||
              newResults.some((item, i) => item !== currentResults![i])
            ) {
              currentResults = newResults;
            }
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
