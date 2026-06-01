import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey } from "./KeyRange.ts";
import { skipCursorOverRanges } from "./skipCursorOverRanges.ts";

export interface CursorIterationOptions {
  readonly direction?: "next" | "prev" | undefined;
  readonly limit?: number | undefined;
}

export async function* iterateStoreOrIndex<T>(
  iteratable: IDBObjectStore | IDBIndex,
  keyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(iteratable.openCursor(null, direction));
  let i = 0;
  while (i < limit) {
    cursor = await skipCursorOverRanges(cursor, keyRanges, primaryKeyRanges, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}

/**
 * Performs a zig-zag merge join algorithm to query the given database.
 * Returns an iterator over store items filtered by given index-value pairs.
 *
 * Example:
 *
 * ```js
 * const results = await Array.fromAsync(zigZagQuery([
 *   [store.index("byUser"), "kazik"],
 *   [store.index("byTag"), "photography"],
 * ]));
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
 * Filtered values can be prefixes of a compound index, not just an exact match.
 * This allows to filter by one field and sort by another.
 *
 * Example:
 *
 * ```js
 * const results = await Array.fromAsync(zigZagQuery([
 *   [store.index("byUserAndDate"), ["kazik"]],
 *   [store.index("byTagAndDate"), ["photography"]],
 * ]));
 * ```
 */
export async function* iterateIndexesConcurrently<T>(
  indexValues: ReadonlyArray<readonly [index: IDBObjectStore | IDBIndex, value: IDBValidKey]>,
  postfixRanges: ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    indexValues.map(([index, value]) => {
      // For compound indexes, value can be a prefix of the indexed key.
      // In that case we want to query for all keys starting with the prefix.
      const range = Array.isArray(value)
        ? IDBKeyRange.bound(value, [...value, getMaxKey()])
        : IDBKeyRange.only(value);
      return idbReqToPromise(index.openCursor(range, direction));
    }),
  );

  let i = 0;
  while (i < limit) {
    // Move all cursors according to postfix and primary key ranges.
    cursors = await Promise.all(
      cursors.map((cursor) => {
        // First key part is already constrained by cursor's range
        const ranges = [undefined, ...(postfixRanges ?? [])];
        return skipCursorOverRanges(cursor, ranges, primaryKeyRanges, direction === "prev");
      }),
    );

    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.
    const postfixes = cursors.map((cursor, i) => {
      const prefix = indexValues[i]![1];
      // For primitive index the postfix is just the primary key.
      if (!Array.isArray(prefix) || !Array.isArray(cursor.key)) return [cursor.primaryKey];
      // For compound index, the postfix is the part after the prefix.
      const keyPostfix = cursor.key.slice(prefix.length);
      return [...keyPostfix, cursor.primaryKey];
    });

    // Find out the largest postfix of all current items.
    const furthestPostfix = postfixes.reduce((a, b) => {
      let order = indexedDB.cmp(a, b);
      if (direction === "prev") order = -order;
      return order > 0 ? a : b;
    });

    // Check if all cursors are pointing to the same item.
    if (postfixes.every((postfix) => indexedDB.cmp(postfix, furthestPostfix) === 0)) {
      // If so, we found a match.
      yield cursors[0]!.value;
      i++;
      // Move all cursors to their next item and repeat.
      cursors = await Promise.all(
        cursors.map((cursor) => {
          cursor.continue();
          return idbReqToPromise(cursor.request);
        }),
      );
      continue;
    }
    // Cursors are pointing to different items.
    // Try to move the cursors to the current largest postfix.
    cursors = await Promise.all(
      cursors.map((cursor, i) => {
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
          cursor.continuePrimaryKey(prefix as IDBValidKey, furthestPostfix[0]!);
        }
        return idbReqToPromise(cursor.request);
      }),
    );
  }
}
