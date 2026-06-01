import type { AnyDatabaseSchema, AnyIndexSchema, AnyStoreSchema, Database } from "./Database.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import {
  getMaxKey,
  isSingleValueRange,
  type MaybeKeyRange,
  minKey,
  toKeyRange,
} from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { ValueAtPath } from "./ValuesAtPaths.ts";

export async function query<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): Promise<SchemaValue<Schema[StoreName]["value"]>[]> {
  const tx = db.idb.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const { where = {}, orderBy = [] } = options;

  const queryFilters = Object.entries<MaybeKeyRange<IDBValidKey>>(where).map(
    ([path, range]) => [path, toKeyRange(range)] as const,
  );
  const queryFilterMap = new Map(queryFilters);
  const queryRangeFilters = queryFilters.filter(([_path, range]) => !isSingleValueRange(range));
  const queryEqFilters = queryFilters
    .filter(([_path, range]) => isSingleValueRange(range))
    .map(([path, range]) => [path, range!.lower!] as const);

  const queryEqFields = new Set(queryEqFilters.map(([field]) => field));
  const queryOrderFields = (
    (Array.isArray as (v: unknown) => v is readonly unknown[])(orderBy) ? orderBy : [orderBy]
  )
    // Remove fields which are filtered by single value from ordering, as they don't affect order.
    .filter((field) => !queryEqFields.has(field));
  const queryRangeFields = new Set(queryRangeFilters.map(([field]) => field));
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);

  const allIndexes = Array.from(store.indexNames).map((name) => store.index(name));

  const primaryKeyFields = Array.isArray(store.keyPath) ? store.keyPath : [store.keyPath!];
  const sortablePrimaryKeyFields = primaryKeyFields.filter((field) => !queryEqFields.has(field));
  const primaryKeyRanges = Array.isArray(store.keyPath)
    ? store.keyPath.map((field) => queryFilterMap.get(field))
    : queryFilterMap.get(store.keyPath!);

  // If primary key consists of all the fields we need and begins with order fields,
  // use the store itself.
  if (
    allQueryFields.values().every((field) => primaryKeyFields.includes(field)) &&
    queryOrderFields.every((field, i) => sortablePrimaryKeyFields[i] === field)
  ) {
    return Array.fromAsync(iterateStoreOrIndex(store, primaryKeyRanges, undefined, options));
  }

  const zigZagIndexes = new Map<string, Map<string, IDBIndex>>();

  for (const index of allIndexes) {
    const indexKeyFields = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
    const allIndexFields = [...indexKeyFields, ...primaryKeyFields];
    const sortableIndexFields = allIndexFields.filter((field) => !queryEqFields.has(field));

    // If index consists of all the fields we need and begins with order fields,
    // use it as the full index.
    if (
      Array.from(allQueryFields).every((field) => allIndexFields.includes(field)) &&
      indexKeyFields.every((field) => allQueryFields.has(field)) &&
      queryOrderFields.every((field, i) => sortableIndexFields[i] === field)
    ) {
      const keyRanges = Array.isArray(index.keyPath)
        ? index.keyPath.map((path) => queryFilterMap.get(path))
        : queryFilterMap.get(index.keyPath);
      return Array.fromAsync(iterateStoreOrIndex(index, keyRanges, primaryKeyRanges, options));
    }

    // If index begins with one of eq fields followed by sortable fields,
    // add it to potential zig zag indexes.
    if (
      queryEqFields.has(allIndexFields[0]!) &&
      Array.from(sortableQueryFields).every((field) => allIndexFields.includes(field)) &&
      indexKeyFields.every((field) => allQueryFields.has(field)) &&
      queryOrderFields.every((field, i) => allIndexFields[i + 1] === field)
    ) {
      // Group indexes by the fields they have after eq fields, as those are the ones used for zig zag query.
      const postfix = indexKeyFields.slice(1).join("+");
      const foundIndexes = zigZagIndexes.get(postfix) ?? new Map<string, IDBIndex>();
      foundIndexes.set(indexKeyFields[0]!, index);
      if (foundIndexes.size === queryEqFields.size) {
        // If we have found indexes for all eq fields with the same postfix, we can use them for zig zag query.
        const queryIndexes = Array.from(foundIndexes.values());
        const indexValues = queryIndexes.map((index) =>
          Array.isArray(index.keyPath)
            ? ([index, [queryFilterMap.get(index.keyPath[0]!)!.lower!]] as const)
            : ([index, queryFilterMap.get(index.keyPath!)!.lower!] as const),
        );
        const indexFields = queryIndexes[0]!.keyPath;
        const postfixRanges = Array.isArray(indexFields)
          ? indexFields.slice(1).map((field) => queryFilterMap.get(field))
          : undefined;
        return Array.fromAsync(
          iterateIndexesConcurrently(indexValues, postfixRanges, primaryKeyRanges, options),
        );
      }
      zigZagIndexes.set(postfix, foundIndexes);
    }
  }

  const missingIndexPaths: string[] = [];
  const allIndexPaths = new Set(
    allIndexes.map((index) =>
      Array.isArray(index.keyPath) ? index.keyPath.join("+") : index.keyPath,
    ),
  );

  if (queryEqFields.size <= 1) {
    missingIndexPaths.push([...queryEqFields, ...sortableQueryFields].join("+"));
  } else {
    for (const eqField of queryEqFields) {
      const keyPath = [eqField, ...sortableQueryFields].join("+");
      if (!allIndexPaths.has(keyPath)) {
        missingIndexPaths.push(keyPath);
      }
    }
  }

  throw new Error(`Missing index on ${missingIndexPaths.join(", ")}.`);
}

export interface QueryOptions<StoreSchema extends AnyStoreSchema> extends QueryIterOptions {
  readonly where?: QueryFilters<StoreSchema> | undefined;
  readonly orderBy?: QueryOrder<StoreSchema> | undefined;
}

export interface QueryIterOptions {
  readonly direction?: "next" | "prev" | undefined;
  readonly limit?: number | undefined;
}

export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in QueryFieldsFromStore<StoreSchema>]?:
    | MaybeKeyRange<Extract<ValueAtPath<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>>
    | undefined;
} & {
  readonly [K in QueryFieldsFromIndexes<StoreSchema> & string]?:
    | MaybeKeyRange<Extract<ValueAtPath<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>>
    | undefined;
};

export type QueryFieldsFromStore<StoreSchema extends AnyStoreSchema> =
  StoreSchema["keyPath"] extends readonly string[]
    ? StoreSchema["keyPath"][number] & string
    : StoreSchema["keyPath"] extends string
      ? StoreSchema["keyPath"] & string
      : never;

export type QueryFieldsFromIndexes<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexes"] extends {}
    ? {
        [I in keyof StoreSchema["indexes"]]: QueryFieldsFromIndex<StoreSchema["indexes"][I]>;
      }[keyof StoreSchema["indexes"]]
    : never;

export type QueryFieldsFromIndex<IndexSchema extends AnyIndexSchema> =
  IndexSchema["keyPath"] extends readonly string[]
    ? IndexSchema["keyPath"][number] & string
    : IndexSchema["keyPath"] extends string
      ? IndexSchema["keyPath"] & string
      : never;

export type QueryOrder<StoreSchema extends AnyStoreSchema> =
  | QueryOrderField<StoreSchema>
  | readonly QueryOrderField<StoreSchema>[];

export type QueryOrderField<StoreSchema extends AnyStoreSchema> =
  | QueryFieldsFromStore<StoreSchema>
  | QueryFieldsFromIndexes<StoreSchema>;

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
  options: QueryIterOptions,
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

async function* iterateStoreOrIndex<T>(
  iteratable: IDBObjectStore | IDBIndex,
  keyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  options: QueryIterOptions,
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

async function skipCursorOverRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    if (keyRanges) {
      const keyMatch = matchKeyToRanges(cursor.key, keyRanges, reverse);
      if (!keyMatch.matches) {
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continue(keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }
    if (primaryKeyRanges) {
      const keyMatch = matchKeyToRanges(cursor.primaryKey, primaryKeyRanges, reverse);
      if (!keyMatch.matches) {
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continuePrimaryKey(cursor.key, keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }
    break;
  }
  return cursor;
}

function matchKeyToRanges(
  key: IDBValidKey,
  ranges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): KeyMatchResult {
  if ((Array.isArray as (v: unknown) => v is readonly unknown[])(ranges)) {
    const compoundKey = Array.isArray(key) ? key : [key];
    for (let keyIdx = 0; keyIdx < compoundKey.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (!range) continue;
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, compoundKey[keyIdx]!, reverse);
      if (order == -2) {
        const nextKey = compoundKey.slice(0, keyIdx);
        nextKey.push(logicalRange.start!);
        if (keyIdx < compoundKey.length - 1) nextKey.push(reverse ? getMaxKey() : minKey);
        return { matches: false, nextKey };
      }
      if (order == -1) {
        return { matches: false, nextKey: undefined };
      }
      if (order > 0) {
        const nextKey = compoundKey.slice(0, keyIdx);
        nextKey.push(reverse ? minKey : getMaxKey());
        return { matches: false, nextKey };
      }
    }
  } else {
    const logicalRange = toLogicalRange(ranges, reverse);
    const order = logicalRangeCmp(logicalRange, key, reverse);
    if (order == -2) {
      return { matches: false, nextKey: logicalRange.start };
    }
    if (order == -1) {
      return { matches: false, nextKey: undefined };
    }
    if (order > 0) {
      return { matches: false, nextKey: reverse ? minKey : getMaxKey() };
    }
  }
  return { matches: true };
}

interface KeyMatchResult {
  matches: boolean;
  nextKey?: IDBValidKey | undefined;
}

const toLogicalRange = (range: IDBKeyRange, reverse: boolean): LogicalKeyRange => ({
  start: reverse ? range.upper : range.lower,
  startOpen: reverse ? range.upperOpen : range.lowerOpen,
  end: reverse ? range.lower : range.upper,
  endOpen: reverse ? range.lowerOpen : range.upperOpen,
});

interface LogicalKeyRange {
  start: IDBValidKey | undefined;
  startOpen: boolean;
  end: IDBValidKey | undefined;
  endOpen: boolean;
}

/**
 * Checks the position of the key in relation to the given range:
 * - -2: key is before the range
 * - -1: key is at the start of the range (if excluded)
 * -  0: key is within the range (including boundary if inclusive)
 * -  1: key is at the end of the range (if excluded)
 * -  2: key is after the range
 */
function logicalRangeCmp(range: LogicalKeyRange, key: IDBValidKey, reverse: boolean) {
  const { start, startOpen, end, endOpen } = range;
  if (start != null) {
    let order = indexedDB.cmp(key, start);
    if (reverse) order = -order;
    if (order < 0) return -2;
    if (startOpen && order == 0) return -1;
  }
  if (end != null) {
    let order = indexedDB.cmp(key, end);
    if (reverse) order = -order;
    if (order > 0) return 2;
    if (endOpen && order == 0) return 1;
  }
  return 0;
}
