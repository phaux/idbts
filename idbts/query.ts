import type { AnyDatabaseSchema, AnyStoreSchema, Database } from "./Database.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, isSingleValueRange, KeyRange, minKey, type ValidKey } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";

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
  const { where = {}, orderBy, direction, limit } = options;

  const queryFilters = Object.entries(where);
  const queryRangeFilters = Object.entries(where).filter(
    ([_path, range]) => !isSingleValueRange(range),
  );
  const queryEqFilters = queryFilters
    .filter(([_path, range]) => isSingleValueRange(range))
    .map(([path, range]) => [path, range.lower!] as const);

  const queryEqFields = new Set(queryEqFilters.map(([field]) => field));
  const queryOrderFields: string[] = (
    Array.isArray(orderBy) ? orderBy : orderBy != null ? [orderBy] : []
  ) // Remove fields which are filtered by single value from ordering, as they don't affect order.
    .filter((field) => !queryEqFields.has(field));

  const queryRangeFields = new Set(queryRangeFilters.map(([field]) => field));
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);
  const allIndexes = Array.from(store.indexNames).map((name) => store.index(name));

  const primaryKeyFields = Array.isArray(store.keyPath) ? store.keyPath : [store.keyPath!];
  const primaryKeyRanges = primaryKeyFields.map((field) => where[field]);
  const sortablePrimaryKeyFields = primaryKeyFields.filter((field) => !queryEqFields.has(field));

  // If primary key consists of all the fields we need and begins with order fields,
  // use the store itself.
  if (
    allQueryFields.values().every((field) => primaryKeyFields.includes(field)) &&
    queryOrderFields.every((field, i) => sortablePrimaryKeyFields[i] === field)
  ) {
    return Array.fromAsync(
      iterateStoreOrIndex(store, primaryKeyRanges, undefined, { direction, limit }),
    );
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
      const keyRanges = indexKeyFields.map((path) => where[path]);
      return Array.fromAsync(
        iterateStoreOrIndex(index, keyRanges, primaryKeyRanges, { direction, limit }),
      );
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
            ? ([index, [where[index.keyPath[0]!]!.lower!]] as const)
            : ([index, where[index.keyPath!]!.lower!] as const),
        );
        const indexFields = queryIndexes[0]!.keyPath;
        const postfixRanges = Array.isArray(indexFields)
          ? indexFields.slice(1).map((field) => where[field])
          : undefined;
        return Array.fromAsync(
          zigZagQuery(indexValues, postfixRanges, primaryKeyRanges, { direction, limit }),
        );
      }
      zigZagIndexes.set(postfix, foundIndexes);
    }
  }

  const missingIndexStrings: string[] = [];
  const allIndexStrings = new Set(
    allIndexes.map((index) =>
      Array.isArray(index.keyPath) ? index.keyPath.join("+") : index.keyPath,
    ),
  );

  if (queryEqFields.size <= 1) {
    missingIndexStrings.push([...queryEqFields, ...sortableQueryFields].join("+"));
  } else {
    for (const eqField of queryEqFields) {
      const prefix = [eqField, ...sortableQueryFields];
      if (!allIndexStrings.has(prefix.join("+"))) {
        missingIndexStrings.push(prefix.join("+"));
      }
    }
  }

  throw new Error(`Missing index on ${missingIndexStrings.join(", ")}.`);
}

export interface QueryOptions<Schema extends AnyStoreSchema> extends QueryIterOptions {
  readonly where?: QueryFilters<Schema> | undefined;
  readonly orderBy?: string | readonly string[] | undefined;
}

export interface QueryIterOptions {
  readonly direction?: "next" | "prev" | undefined;
  readonly limit?: number | undefined;
}

export type QueryFilters<Schema extends AnyStoreSchema> = Readonly<
  Record<string | symbol, KeyRange<ValidKey>>
>;

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
  indexValues: ReadonlyArray<readonly [index: IDBObjectStore | IDBIndex, value: ValidKey]>,
  postfixRanges: ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  options: QueryIterOptions,
): AsyncGenerator<T, undefined, undefined> {
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
  keyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  primaryKeyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined> | undefined,
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
  keyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  primaryKeyRanges: ReadonlyArray<IDBKeyRange | undefined> | undefined,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    const keyMatch = matchKeyToRanges(cursor.key, keyRanges, reverse);
    if (!keyMatch.matches) {
      if (keyMatch.nextKey == null) cursor.continue();
      else cursor.continue(keyMatch.nextKey);
      cursor = await idbReqToPromise(cursor.request);
      continue;
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
  ranges: ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): KeyMatchResult {
  if (Array.isArray(key)) {
    for (let keyIdx = 0; keyIdx < key.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (!range) continue;
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, key[keyIdx]!, reverse);
      if (order == -2) {
        const nextKey = key.slice(0, keyIdx);
        nextKey.push(logicalRange.start!);
        if (keyIdx < key.length - 1) nextKey.push(reverse ? getMaxKey() : minKey);
        return { matches: false, nextKey };
      }
      if (order == -1) {
        return { matches: false, nextKey: undefined };
      }
      if (order > 0) {
        const nextKey = key.slice(0, keyIdx);
        nextKey.push(reverse ? minKey : getMaxKey());
        return { matches: false, nextKey };
      }
    }
  } else {
    const range = ranges[0];
    if (range) {
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, key, reverse);
      if (order == -2) return { matches: false, nextKey: logicalRange.start };
      if (order == -1) return { matches: false, nextKey: undefined };
      else if (order > 0) return { matches: false, nextKey: reverse ? minKey : getMaxKey() };
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
 * - -1: key is at the start of the range (if open)
 * -  0: key is within the range
 * -  1: key is at the end of the range (if open)
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
