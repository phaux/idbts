import type { DBCursor } from "./DBCursor.ts";
import type { DBIndex, IndexKey } from "./DBIndex.ts";
import type { AnyStoreSchema, ReadonlyDBStore } from "./DBStore.ts";
import { KeyRange, type ValidKey } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";

/**
 * Performs a zig-zag merge join algorithm to query the given database.
 * Returns an iterator over store items filtered by given index-value pairs.
 *
 * Example:
 *
 * ```js
 * const results = await Array.fromAsync(zigZagJoin(db, "posts", [
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
 * const results = await Array.fromAsync(zigZagJoin(db, "posts", [
 *   // only first values of the compound indexes are provided
 *   // (date is omitted and will be only used for sorting)
 *   ["byUserAndDate", ["kazik"]],
 *   ["byTagAndDate", ["photography"]],
 * ]));
 * ```
 *
 * This will turn the filter values into ranges automatically.
 * It's important to make sure that the omitted value is the same field in every filter condition.
 */
export async function* zigZagJoin<Schema extends AnyStoreSchema>(
  store: ReadonlyDBStore<Schema>,
  filters: StoreFilters<Schema>,
): AsyncIterableIterator<SchemaValue<Schema["value"]>, undefined, undefined> {
  if (filters.length === 0) {
    throw new Error("No filters provided");
  }

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    filters.map(([indexName, value]) => PrefixCursor.init(store.index(indexName), value)),
  );

  while (true) {
    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) return;
    // All cursors are pointing to some item.

    // Find out the largest postfix of all current items.
    const largestPostfix = cursors.map((cursor) => cursor.postfix).reduce((a, b) => (indexedDB.cmp(a, b) > 0 ? a : b));

    // Check if all cursors are pointing to the same item.
    if (cursors.every((cursor) => indexedDB.cmp(cursor.postfix, largestPostfix) === 0)) {
      // If so, we found a match.
      yield cursors[0]!.cursor.value;
      // Move all cursors to their next item and repeat.
      cursors = await Promise.all(cursors.map((cursor) => cursor.continue()));
      continue;
    }
    // Cursors are pointing to different items.

    // Try to move the cursors to the current largest postfix.
    cursors = await Promise.all(
      cursors.map((cursor) => {
        // If the cursor is already pointing to the largest postfix, leave it as is.
        if (indexedDB.cmp(cursor.postfix, largestPostfix) === 0) return cursor;
        // Otherwise, move it to at least the largest postfix.
        return cursor.continuePostfix(largestPostfix);
      }),
    );
  }
}

export type StoreFilters<Schema extends AnyStoreSchema> = ReadonlyArray<
  {
    [IndexName in keyof Schema["indexes"] & string]: readonly [IndexName, KeyPrefix<IndexKey<Schema, IndexName>>];
  }[keyof Schema["indexes"] & string]
>;

export type KeyPrefix<T extends ValidKey> = T extends readonly [...infer Prefix extends readonly ValidKey[], unknown]
  ? T | KeyPrefix<readonly [...Prefix]>
  : T;

/**
 * A DBCursor wrapper which iterates over items with a given key prefix.
 */
class PrefixCursor<T> {
  cursor: DBCursor<T, ValidKey>;
  readonly prefix: ValidKey;

  static async init<
    const StoreSchema extends AnyStoreSchema,
    const IndexName extends keyof StoreSchema["indexes"] & string,
  >(index: DBIndex<StoreSchema, IndexName>, value: ValidKey) {
    const cursor = Array.isArray(value)
      ? // Treat the array value as a prefix.
        // This will select all compound values starting with the prefix.
        await index.openCursor(KeyRange.bound(value, [...value, [[]]]) as any, "next")
      : // Open a cursor for the exact value.
        await index.openCursor(KeyRange.only(value) as any);
    if (cursor == null) return null;
    return new PrefixCursor(value, cursor);
  }

  constructor(prefix: ValidKey, cursor: DBCursor<T, ValidKey>) {
    this.prefix = prefix;
    this.cursor = cursor;
  }

  async continue() {
    const cursor = await this.cursor.continue();
    if (cursor == null) return null;
    return this;
  }

  get postfix() {
    // For simple query, the postfix is just the primary key.
    if (!Array.isArray(this.prefix)) return this.cursor.primaryKey;
    // If query value was a prefix, the postfix includes the part of the key after the prefix.
    const keyPostfix = (this.cursor.key as ValidKey[]).slice(this.prefix.length);
    return [...keyPostfix, this.cursor.primaryKey];
  }

  async continuePostfix(postfix: ValidKey) {
    const cursor = Array.isArray(postfix)
      ? // If postfix was an array then it contains index key and primary key.
        await this.cursor.continuePrimaryKey(
          [...(this.prefix as ValidKey[]), ...postfix.slice(0, postfix.length - 1)],
          postfix[postfix.length - 1],
        )
      : // If postfix was a simple value, it's just the primary key.
        await this.cursor.continuePrimaryKey(this.prefix, postfix);
    if (cursor == null) return null;
    return this;
  }
}
