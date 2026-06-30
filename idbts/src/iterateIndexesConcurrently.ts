import { continuePrimaryKeyRange } from "./continuePrimaryKeyRange.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { CursorIterationOptions } from "./iterateStoreOrIndex.ts";

/**
 * Performs a zig-zag merge join algorithm to iterate the given indexes concurrently.
 * Yields store items filtered by given index-value pairs and optional postfix key ranges.
 *
 * It can be used to efficiently find entries satisfying multiple key-value equality conditions.
 *
 * Example:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateIndexesConcurrently([
 *     [store.index("byUser"), IDBKeyRange.only("kazik")],
 *     [store.index("byTag"), IDBKeyRange.only("photography")],
 *   ])
 * );
 * ```
 *
 * This is equivalent to a SQL query like:
 *
 * ```sql
 * SELECT * FROM `storeName`
 * WHERE `user` = "kazik"
 * AND `tag` = "photography"
 * ```
 *
 * Filtered values can be prefixes of a composite index, not just an exact match.
 * This allows to filter by one field and sort by another:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateIndexesConcurrently([
 *     [
 *       store.index("byUserAndDate"),
 *       IDBKeyRange.bound(["kazik", minDate], ["kazik", maxDate]),
 *     ],
 *     [
 *       store.index("byTagAndDate"),
 *       IDBKeyRange.bound(["photography", minDate], ["photography", maxDate]),
 *     ],
 *   ])
 * );
 * ```
 *
 * In above case the date is the postfix component of the composite index.
 *
 * Additionally, a primary key range can be used to further filter the results.
 */
export async function* iterateIndexesConcurrently<T>(
  indexRanges: readonly (readonly [index: IDBObjectStore | IDBIndex, range: IDBKeyRange])[],
  primaryKeyRange: IDBKeyRange | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { limit = Infinity, reverse = false } = options;

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    indexRanges.map(async ([index, range]) =>
      idbReqToPromise(index.openCursor(range, reverse ? "prev" : "next")),
    ),
  );

  let i = 0;
  while (i < limit) {
    // Move all cursors according to postfix and primary key ranges.
    if (primaryKeyRange) {
      cursors = await Promise.all(
        cursors.map(async (cursor) => {
          return continuePrimaryKeyRange(cursor, primaryKeyRange, reverse);
        }),
      );
    }

    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.

    const postfixes = cursors.map((cursor) => {
      const composite = Array.isArray(cursor.source.keyPath);
      if (composite) {
        // For composite index, the postfix is the second component of the key + primary key.
        const keyPostfix = (cursor.key as IDBValidKey[])[1]!;
        return [keyPostfix, cursor.primaryKey];
      }
      // For primitive index the postfix is just the primary key.
      return [cursor.primaryKey];
    });

    // Find out the largest postfix of all current items.
    const furthestPostfix = postfixes.reduce((a, b) => {
      let order = indexedDB.cmp(a, b);
      if (reverse) order = -order;
      return order > 0 ? a : b;
    });

    // Check if all cursors are pointing to the same item.
    if (postfixes.every((postfix) => indexedDB.cmp(postfix, furthestPostfix) === 0)) {
      // If so, we found a match.
      yield cursors[0]!.value;
      i++;
      // Move all cursors to their next item and repeat.
      cursors = await Promise.all(
        cursors.map(async (cursor) => {
          cursor.continue();
          return idbReqToPromise(cursor.request);
        }),
      );
      continue;
    }
    // Cursors are pointing to different items.
    // Try to move the cursors to the current largest postfix.
    cursors = await Promise.all(
      cursors.map(async (cursor, i) => {
        // If the cursor is already pointing to the largest postfix, leave it as is.
        if (indexedDB.cmp(postfixes[i]!, furthestPostfix) === 0) return cursor;
        // Otherwise, move it to at least the largest postfix.
        const composite = Array.isArray(cursor.source.keyPath);
        if (composite) {
          // For composite index, the first component is the prefix,
          // and the second component + primary key is the postfix.
          const prefix = (cursor.key as IDBValidKey[])[0]!;
          const keyPostfix = furthestPostfix[0]!;
          const primaryKey = furthestPostfix[1]!;
          const key = [prefix, keyPostfix];
          cursor.continuePrimaryKey(key, primaryKey);
        } else {
          // For primitive index, the whole key is the prefix
          // and the primary key is the postfix.
          const prefix = cursor.key;
          cursor.continuePrimaryKey(prefix, furthestPostfix[0]!);
        }
        return idbReqToPromise(cursor.request);
      }),
    );
  }
}
