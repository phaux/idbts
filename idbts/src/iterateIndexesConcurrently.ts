import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { CursorIterationOptions } from "./iterateStoreOrIndex.ts";
import { getMaxKey } from "./KeyRange.ts";
import { skipCursorOverRanges } from "./skipCursorOverRanges.ts";

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
 *     [store.index("byUser"), "kazik"],
 *     [store.index("byTag"), "photography"],
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
 *     [store.index("byUserAndDate"), ["kazik"]],
 *     [store.index("byTagAndDate"), ["photography"]],
 *   ])
 * );
 * ```
 *
 * In above case the date is the postfix component of the composite index.
 *
 * Additionally, the postfix and primary key ranges can be used to further filter the results.
 * Pass an array of ranges to filter per every component of a composite key.
 *
 * Same as above, but filtered by date and primary key ranges:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateIndexesConcurrently(
 *     [
 *       [store.index("byUserAndDate"), ["kazik"]],
 *       [store.index("byTagAndDate"), ["photography"]],
 *     ],
 *     [IDBKeyRange.upperBound(new Date("2025-01-01"))],
 *     IDBKeyRange.lowerBound(123),
 *     { ...options },
 *   )
 * );
 * ```
 */

export async function* iterateIndexesConcurrently<T>(
  indexValues: readonly (readonly [index: IDBObjectStore | IDBIndex, value: IDBValidKey])[],
  postfixKeyRanges: readonly (IDBKeyRange | undefined)[] | undefined,
  primaryKeyRanges: IDBKeyRange | readonly (IDBKeyRange | undefined)[] | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { limit = Infinity, reverse = false } = options;

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    indexValues.map(async ([index, value]) => {
      // For composite indexes, value can be a prefix of the indexed key.
      // In that case we want to query for all keys starting with the prefix.
      const range = Array.isArray(value)
        ? IDBKeyRange.bound(value, [...value, getMaxKey()])
        : IDBKeyRange.only(value);
      return idbReqToPromise(index.openCursor(range, reverse ? "prev" : "next"));
    }),
  );

  let i = 0;
  while (i < limit) {
    // Move all cursors according to postfix and primary key ranges.
    cursors = await Promise.all(
      cursors.map(async (cursor) => {
        // First key part is already constrained by cursor's range
        const ranges = [undefined, ...(postfixKeyRanges ?? [])];
        return skipCursorOverRanges(cursor, ranges, primaryKeyRanges, reverse);
      }),
    );

    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.
    const postfixes = cursors.map((cursor, i) => {
      const prefix = indexValues[i]![1];
      // For primitive index the postfix is just the primary key.
      if (!Array.isArray(prefix) || !Array.isArray(cursor.key)) return [cursor.primaryKey];
      // For composite index, the postfix is the part after the prefix.
      const keyPostfix = cursor.key.slice(prefix.length);
      return [...keyPostfix, cursor.primaryKey];
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
          return idbReqToPromise(cursor.request as IDBRequest<IDBCursorWithValue | null>);
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
        const prefix = indexValues[i]![1];
        if (Array.isArray(prefix)) {
          const keyPostfix = furthestPostfix.slice(0, furthestPostfix.length - 1);
          const primaryKey = furthestPostfix[furthestPostfix.length - 1]!;
          const key = [...prefix, ...keyPostfix];
          cursor.continuePrimaryKey(key, primaryKey);
        } else {
          cursor.continuePrimaryKey(prefix, furthestPostfix[0]!);
        }
        return idbReqToPromise(cursor.request as IDBRequest<IDBCursorWithValue | null>);
      }),
    );
  }
}
