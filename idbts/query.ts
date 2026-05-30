import type { AnyDatabaseSchema, AnyStoreSchema, Database } from "./Database.ts";
import { isSingleValueRange, KeyRange, type ValidKey } from "./KeyRange.ts";
import { multiDimensionalQuery } from "./multiDimensionalQuery.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import { zigZagQuery } from "./zigZagQuery.ts";

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
  const queryFn = planQuery(store, options);
  return queryFn();
}

function planQuery(store: IDBObjectStore, options: QueryOptions<any>): () => Promise<any[]> {
  const { where = {}, orderBy, direction, limit = Infinity } = options;

  const queryFilters = Object.entries(where);
  const queryRangeFilters = Object.entries(where).filter(
    ([_path, range]) => !isSingleValueRange(range),
  );
  const queryEqFilters = queryFilters
    .filter(([_path, range]) => isSingleValueRange(range))
    .map(([path, range]) => [path, range.lower!] as const);

  const queryOrderFields: string[] = (
    Array.isArray(orderBy) ? orderBy : orderBy != null ? [orderBy] : []
  ) // Remove fields which are filtered by single value from ordering, as they don't affect order.
    .filter((field) => !queryEqFilters.some(([path]) => path === field));

  const queryEqFields = new Set(queryEqFilters.map(([path]) => path));
  const queryRangeFields = new Set(queryRangeFilters.map(([path]) => path));
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);
  const queryIndexes = findIndexes(store, queryOrderFields, queryEqFields, queryRangeFields);
  const allIndexes = Array.from(store.indexNames).map((name) => store.index(name));
  if (queryIndexes.length === 0)
    throw new MissingIndexError(queryOrderFields, queryEqFields, queryRangeFields, allIndexes);
  const primaryKeyPaths = Array.isArray(store.keyPath!) ? store.keyPath : [store.keyPath!];
  const primaryRanges = primaryKeyPaths.map((field) => where[field]);

  if (queryIndexes.length === 1) {
    const index = queryIndexes[0]!;
    const keyPaths = Array.isArray(index.keyPath!) ? index.keyPath : [index.keyPath!];
    const ranges = keyPaths.map((field) => where[field]);
    return () =>
      Array.fromAsync(multiDimensionalQuery(index, ranges, primaryRanges, { direction, limit }));
  }

  // If we have multiple indexes, use zig zag query.
  const indexValues = queryIndexes.map((index) => {
    if (Array.isArray(index.keyPath)) {
      return [index, [where[index.keyPath[0]!]!.lower!]] as const;
    } else {
      return [index, where[index.keyPath!]!.lower!] as const;
    }
  });
  const indexFields = queryIndexes[0]!.keyPath;
  const postfixRanges = Array.isArray(indexFields)
    ? indexFields.slice(1).map((field) => where[field])
    : undefined;
  return () =>
    Array.fromAsync(zigZagQuery(indexValues, postfixRanges, primaryRanges, { direction, limit }));
}

function findIndexes(
  store: IDBObjectStore,
  queryOrderFields: readonly string[],
  queryEqFields: ReadonlySet<string>,
  queryRangeFields: ReadonlySet<string>,
): readonly (IDBObjectStore | IDBIndex)[] {
  const indexes = Array.from(store.indexNames).map((name) => store.index(name));
  const primaryKeyPaths = Array.isArray(store.keyPath) ? store.keyPath : [store.keyPath!];
  const sortablePrimaryFields = primaryKeyPaths.filter((field) => !queryEqFields.has(field));
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);
  const zigZagIndexes = new Map<string, Map<string, IDBIndex>>();
  let fullIndex: IDBIndex | undefined;

  // If primary key consists of all the fields we need and begins with order fields,
  // use the store itself.
  if (
    allQueryFields.values().every((field) => primaryKeyPaths.includes(field)) &&
    queryOrderFields.every((field, i) => sortablePrimaryFields[i] === field)
  ) {
    return [store];
  }

  for (const index of indexes) {
    const indexFields = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
    const allIndexFields = [...indexFields, ...primaryKeyPaths];
    const sortableIndexFields = allIndexFields.filter((field) => !queryEqFields.has(field));

    // If index consists of all the fields we need and begins with order fields,
    // use it as the full index.
    if (
      allQueryFields.values().every((field) => allIndexFields.includes(field)) &&
      indexFields.every((field) => allQueryFields.has(field)) &&
      queryOrderFields.every((field, i) => sortableIndexFields[i] === field)
    ) {
      if (
        !fullIndex ||
        (Array.isArray(index.keyPath) ? index.keyPath.length : 1) <
          (Array.isArray(fullIndex.keyPath) ? fullIndex.keyPath.length : 1)
      ) {
        fullIndex = index;
      }
    }

    // If index begins with one of eq fields followed by sortable fields,
    // add it to potential zig zag indexes.
    if (
      queryEqFields.has(allIndexFields[0]!) &&
      sortableQueryFields.values().every((field) => allIndexFields.includes(field)) &&
      indexFields.every((field) => allQueryFields.has(field)) &&
      queryOrderFields.every((field, i) => allIndexFields[i + 1] === field)
    ) {
      // Group indexes by the fields they have after eq fields, as those are the ones used for zig zag merge.
      const postfix = indexFields.slice(1).join("+");
      const foundIndexes = zigZagIndexes.get(postfix) ?? new Map<string, IDBIndex>();
      foundIndexes.set(indexFields[0]!, index);
      if (foundIndexes.size === queryEqFields.size) {
        // If we have found indexes for all eq fields with the same postfix, we can use them for zig zag merge.
        return Array.from(foundIndexes.values());
      }
      zigZagIndexes.set(postfix, foundIndexes);
    }
  }

  return fullIndex != null ? [fullIndex] : [];
}

export class MissingIndexError extends Error {
  constructor(
    orderFields: readonly string[],
    eqFields: ReadonlySet<string>,
    rangeFields: ReadonlySet<string>,
    allIndexes: readonly IDBIndex[],
  ) {
    const sortableFields = new Set([...orderFields, ...rangeFields]);
    const missingIndexKeyPaths: string[] = [];
    const allIndexKeyPaths = allIndexes.map((index) =>
      Array.isArray(index.keyPath) ? index.keyPath.join("+") : index.keyPath,
    );
    if (eqFields.size <= 1) {
      missingIndexKeyPaths.push([...eqFields, ...sortableFields].join("+"));
    } else {
      for (const eqField of eqFields) {
        const prefix = [eqField, ...sortableFields];
        if (!allIndexKeyPaths.includes(prefix.join("+"))) {
          missingIndexKeyPaths.push(prefix.join("+"));
        }
      }
    }
    if (missingIndexKeyPaths.length === 1) {
      super(`Missing index on ${missingIndexKeyPaths[0]}.`);
    } else {
      super(`Missing indices on ${missingIndexKeyPaths.join(", ")}.`);
    }
  }
}

export type QueryOptions<Schema extends AnyStoreSchema> = {
  readonly where?: QueryFilters<Schema> | undefined;
  readonly orderBy?: string | readonly string[] | undefined;
  readonly direction?: "next" | "prev" | undefined;
  readonly limit?: number | undefined;
};

export type QueryFilters<Schema extends AnyStoreSchema> = Readonly<
  Record<string | symbol, KeyRange<ValidKey>>
>;
