import type { IndexKey } from "./DBIndex.ts";
import type { DBStoreSchema, ReadonlyDBStore } from "./DBStore.ts";
import { KeyRange } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";

/**
 * Performs a zig-zag merge join algorithm to query the given database.
 * Returns an iterator over store items filtered by given index-value pairs.
 *
 * This is equivalent to a SQL query like:
 *
 * ```sql
 * SELECT * FROM storeName
 * WHERE index1 = value1
 * AND index2 = value2
 * AND ...
 * ```
 *
 * This only requires an index for each filtered property and doesn't require any compound indexes.
 *
 * @example
 *
 * ```js
 * const results = await Array.fromAsync(zigZagJoin(db, "posts", [
 *   ["byUserId", "kazik"],
 *   ["byTag", "photography"],
 *   ["byTag", "animals"],
 * ]));
 * ```
 */
export async function* zigZagJoin<Schema extends DBStoreSchema>(
  store: ReadonlyDBStore<Schema>,
  filters: StoreFilters<Schema>,
): AsyncIterableIterator<SchemaValue<Schema["value"]>, undefined, undefined> {
  // If no filters are provided, return all items from the store.
  if (filters.length === 0) {
    for await (const cursor of store.iterate()) {
      yield cursor.value;
    }
    return;
  }

  // Create a cursor for every filter.
  // Every cursor will visit only items with the given filter value.
  // If there are multiple items with that value, they will be sorted by primary key.
  let cursors = await Promise.all(
    filters.map(([indexName, value]) => store.index(indexName).openCursor(KeyRange.only<any>(value))),
  );

  while (true) {
    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) return;
    // All cursors are pointing to some item.

    // Find out the largest primary key of all current items.
    const largestKey = cursors.reduce((a, b) => (indexedDB.cmp(a.primaryKey, b.primaryKey) > 0 ? a : b)).primaryKey;

    // Check if all cursors are pointing to the same item.
    if (cursors.every((cursor) => indexedDB.cmp(cursor.primaryKey, largestKey) === 0)) {
      // If so, we found a match.
      yield cursors[0]!.value;
      // Move all cursors to their next item and repeat.
      cursors = await Promise.all(cursors.map((cursor) => cursor.continue()));
      continue;
    }
    // Cursors are pointing to different items.

    // Try to move the cursors to the current largest primary key.
    cursors = await Promise.all(
      cursors.map((cursor) => {
        // If the cursor is already pointing to the largest primary key, leave it as is.
        if (indexedDB.cmp(cursor.primaryKey, largestKey) === 0) return cursor;
        // Otherwise, move it to at least the largest primary key.
        return cursor.continuePrimaryKey(cursor.key, largestKey);
      }),
    );
  }
}

export type StoreFilters<Schema extends DBStoreSchema> = readonly {
  [IndexName in keyof Schema["indexes"] & string]: readonly [IndexName, IndexKey<Schema, IndexName>];
}[keyof Schema["indexes"] & string][];
