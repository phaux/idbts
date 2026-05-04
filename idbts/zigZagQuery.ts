import { advanceCursorByRanges } from "./advanceCursorByRanges.ts";
import type { DBCursor } from "./DBCursor.ts";
import type { AnyStoreSchema, ReadonlyDBStore } from "./DBStore.ts";
import { getMaxKey, KeyRange, type ValidKey } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";

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
 * const results = await Array.fromAsync(zigZagQuery(store, [
 *   ["byUser", "kazik"],
 *   ["byTag", "photography"],
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
 * const results = await Array.fromAsync(zigZagQuery(store, [
 *   // only first values of the compound indexes are provided
 *   // (date is omitted and will be only used for sorting)
 *   ["byUserAndDate", ["kazik"]],
 *   ["byTagAndDate", ["photography"]],
 * ]));
 * ```
 */
export async function* zigZagQuery<Schema extends AnyStoreSchema>(
  store: ReadonlyDBStore<any>,
  filters: ReadonlyArray<readonly [idxName: string, value: ValidKey]>,
  postfixRanges: ReadonlyArray<KeyRange<ValidKey> | undefined> = [],
  primaryKeyRange?: KeyRange<ValidKey>,
  options: ZigZagQueryOptions = {},
): AsyncIterableIterator<SchemaValue<Schema["value"]>, undefined, undefined> {
  const { direction, limit = Infinity } = options;

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    filters.map(([idxName, value]) => {
      // For compound indexes, value can be a prefix of the indexed key.
      // In that case we want to query for all keys starting with the prefix.
      const range = Array.isArray(value) ? KeyRange.bound(value, [...value, getMaxKey()]) : KeyRange.only(value);
      return store.index(idxName).openCursor(range, direction);
    }),
  );

  let i = 0;
  while (i < limit) {
    // Move all cursors according to postfix and primary key ranges.
    cursors = await Promise.all(
      cursors.map((cursor, i) => {
        // First key part is already constrained by cursor's range
        const ranges = [undefined, ...postfixRanges];
        return advanceCursorByRanges(cursor, ranges, primaryKeyRange, direction === "prev");
      }),
    );

    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.

    const postfixes = cursors.map((cursor, i) => getPostfix(filters[i]![1], cursor!));

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
      cursors = await Promise.all(cursors.map((cursor) => cursor.continue()));
      continue;
    }
    // Cursors are pointing to different items.

    // Try to move the cursors to the current largest postfix.
    cursors = await Promise.all(
      cursors.map((cursor, i) => {
        // If the cursor is already pointing to the largest postfix, leave it as is.
        if (indexedDB.cmp(postfixes[i]!, furthestPostfix) === 0) return cursor;
        // Otherwise, move it to at least the largest postfix.
        return continuePostfix(filters[i]![1], cursor, furthestPostfix);
      }),
    );
  }
}

function getPostfix(prefix: ValidKey, cursor: DBCursor<any, ValidKey>): readonly [...(readonly ValidKey[]), ValidKey] {
  // For primitive index the postfix is just the primary key.
  if (!Array.isArray(prefix) || !Array.isArray(cursor.key)) return [cursor.primaryKey];
  // For compound index, the postfix is the part after the prefix.
  const keyPostfix = cursor.key.slice(prefix.length);
  return [...keyPostfix, cursor.primaryKey];
}

function continuePostfix(
  prefix: ValidKey,
  cursor: DBCursor<any, ValidKey>,
  postfix: readonly [...(readonly ValidKey[]), ValidKey],
): Promise<DBCursor<any, ValidKey> | null> {
  if (!Array.isArray(prefix)) return cursor.continuePrimaryKey(prefix, postfix[0]);
  const keyPostfix = postfix.slice(0, postfix.length - 1);
  const primaryKey = postfix[postfix.length - 1]!;
  const key = [...prefix, ...keyPostfix];
  return cursor.continuePrimaryKey(key, primaryKey);
}
