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
 * const results = await Array.fromAsync(zigZagJoin(store, [
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
 * const results = await Array.fromAsync(zigZagJoin(store, [
 *   // only first values of the compound indexes are provided
 *   // (date is omitted and will be only used for sorting)
 *   ["byUserAndDate", ["kazik"]],
 *   ["byTagAndDate", ["photography"]],
 * ]));
 * ```
 *
 * This will turn the filter values into ranges automatically.
 * It's important to make sure that the omitted value is the same field in every filter condition.
 * You can limit the range further by providing the third argument.
 *
 * Example:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   zigZagJoin(
 *     store,
 *     [
 *       ["byUserAndDate", ["kazik"]],
 *       ["byTagAndDate", ["photography"]],
 *     ],
 *     KeyRange.upperBound([Date.now()]),
 *   ),
 * );
 * ```
 */
export async function* zigZagJoin<Schema extends AnyStoreSchema>(
  store: ReadonlyDBStore<Schema>,
  filters: StoreFilters<Schema>,
  range?: KeyRange<readonly ValidKey[]> | null | undefined,
  direction?: "next" | "prev",
): AsyncIterableIterator<SchemaValue<Schema["value"]>, undefined, undefined> {
  if (filters.length === 0) {
    throw new Error("No filters provided");
  }

  // Create a cursor for every filter.
  let cursors = await Promise.all(
    filters.map(([indexName, value]) => PrefixCursor.init(store.index(indexName), value, range, direction)),
  );

  while (true) {
    // If any cursor is null, we've reached the end.
    if (!cursors.every((cursor) => cursor != null)) break;
    // All cursors are pointing to some item.

    // Find out the largest postfix of all current items.
    const furthestPostfix = cursors
      .map((cursor) => cursor.postfix)
      .reduce((a, b) => {
        const order = indexedDB.cmp(a, b);
        if (direction === "prev") return order < 0 ? a : b;
        return order > 0 ? a : b;
      });

    // Check if all cursors are pointing to the same item.
    if (cursors.every((cursor) => indexedDB.cmp(cursor.postfix, furthestPostfix) === 0)) {
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
        if (indexedDB.cmp(cursor.postfix, furthestPostfix) === 0) return cursor;
        // Otherwise, move it to at least the largest postfix.
        return cursor.continuePostfix(furthestPostfix);
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
  >(
    index: DBIndex<StoreSchema, IndexName>,
    value: ValidKey,
    range?: KeyRange<readonly ValidKey[]> | null | undefined,
    direction?: "next" | "prev",
  ) {
    // Treat an array value as a prefix.
    // This will select all compound values starting with the prefix.
    const fullRange = Array.isArray(value) ? concatRange(value, range) : KeyRange.only(value);
    const cursor = await index.openCursor(fullRange as any, direction);
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
    this.cursor = cursor;
    return this;
  }

  get postfix(): ValidKey {
    // For simple query, the postfix is just the primary key.
    if (!Array.isArray(this.prefix)) return this.cursor.primaryKey;
    // If query value was a prefix, the postfix includes the part of the key after the prefix.
    const keyPostfix = (this.cursor.key as ValidKey[]).slice(this.prefix.length);
    const postfix = [...keyPostfix, this.cursor.primaryKey];
    return postfix;
  }

  async continuePostfix(postfix: ValidKey) {
    let cursor = null;
    if (Array.isArray(this.prefix)) {
      if (!Array.isArray(postfix)) throw new Error("Postfix must be an array when prefix is an array");
      // If postfix is an array then it contains index key and primary key.
      const keyPostfix = postfix.slice(0, postfix.length - 1);
      const primaryKey = postfix[postfix.length - 1];
      const key = [...this.prefix, ...keyPostfix];
      cursor = await this.cursor.continuePrimaryKey(key, primaryKey);
    } else {
      cursor = await this.cursor.continuePrimaryKey(this.prefix, postfix);
    }

    if (cursor == null) return null;
    this.cursor = cursor;
    return this;
  }
}

/**
 * Given a prefix and a range, returns a new range that combines them.
 *
 * For example, given prefix `["a"]` and range `[1, 3]`, returns range from `["a", 1]` to `["a", 3]`.
 *
 * If range is null, returns range which includes all keys with the given prefix.
 */
function concatRange(
  prefix: readonly ValidKey[],
  range: KeyRange<readonly ValidKey[]> | null | undefined,
): KeyRange<readonly ValidKey[]> | null {
  return KeyRange.bound(
    range?.lower != null ? [...prefix, ...range.lower] : prefix,
    [...prefix, ...(range?.upper ?? ([[]] as const))],
    range?.lowerOpen,
    range?.upperOpen,
  );
}
