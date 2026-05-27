import { advanceCursorByRanges } from "./advanceCursorByRanges.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, KeyRange, type ValidKey } from "./KeyRange.ts";

export interface ZigZagQueryOptions {
  limit?: number | undefined;
  direction?: "next" | "prev" | undefined;
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
 *   // only first values of the compound indexes are provided
 *   // (date is omitted and will be only used for sorting)
 *   [store.index("byUserAndDate"), ["kazik"]],
 *   [store.index("byTagAndDate"), ["photography"]],
 * ]));
 * ```
 */
export async function* zigZagQuery<T>(
  indexValues: ReadonlyArray<readonly [index: IDBIndex, value: ValidKey]>,
  postfixRanges: ReadonlyArray<KeyRange | undefined> = [],
  primaryKeyRange?: KeyRange,
  options: ZigZagQueryOptions = {},
): AsyncIterableIterator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    indexValues.map(([index, value]) => {
      // For compound indexes, value can be a prefix of the indexed key.
      // In that case we want to query for all keys starting with the prefix.
      const range = Array.isArray(value)
        ? KeyRange.bound(value, [...value, getMaxKey()])
        : KeyRange.only(value);
      return idbReqToPromise(index.openCursor(range, direction));
    }),
  );

  let i = 0;
  while (i < limit) {
    // Move all cursors according to postfix and primary key ranges.
    cursors = await Promise.all(
      cursors.map((cursor) => {
        // First key part is already constrained by cursor's range
        const ranges = [undefined, ...postfixRanges];
        return advanceCursorByRanges(cursor, ranges, primaryKeyRange, direction === "prev");
      }),
    );

    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.

    const postfixes = cursors.map((cursor, i) => getPostfix(indexValues[i]![1], cursor!));

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
        return continuePostfix(indexValues[i]![1], cursor, furthestPostfix);
      }),
    );
  }
}

function getPostfix(
  prefix: ValidKey,
  cursor: IDBCursor,
): readonly [...(readonly IDBValidKey[]), IDBValidKey] {
  // For primitive index the postfix is just the primary key.
  if (!Array.isArray(prefix) || !Array.isArray(cursor.key)) return [cursor.primaryKey];
  // For compound index, the postfix is the part after the prefix.
  const keyPostfix = cursor.key.slice(prefix.length);
  return [...keyPostfix, cursor.primaryKey];
}

function continuePostfix(
  prefix: ValidKey,
  cursor: IDBCursorWithValue,
  postfix: readonly [...(readonly IDBValidKey[]), IDBValidKey],
): Promise<IDBCursorWithValue | null> {
  if (Array.isArray(prefix)) {
    const keyPostfix = postfix.slice(0, postfix.length - 1);
    const primaryKey = postfix[postfix.length - 1]!;
    const key = [...prefix, ...keyPostfix];
    cursor.continuePrimaryKey(key, primaryKey);
  } else {
    cursor.continuePrimaryKey(prefix as IDBValidKey, postfix[0]);
  }
  return idbReqToPromise(cursor.request);
}
