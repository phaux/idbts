import type { AnyDatabaseSchema, AnyStoreSchema, Database } from "./Database.ts";
import { isSingleValueRange, KeyRange, type ValidKey } from "./KeyRange.ts";
import { multiDimensionalQuery } from "./multiDimensionalQuery.ts";
import { simpleQuery, simpleQuery2 } from "./simpleQuery.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import { zigZagQuery } from "./zigZagQuery.ts";

export const primaryKey: unique symbol = Symbol("primaryKey");

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

  const keyRange = where[primaryKey];
  const filters = Object.entries(where);
  const rangeFilters = Object.entries(where).filter(([_path, range]) => !isSingleValueRange(range));
  const eqFilters = filters
    .filter(([_path, range]) => isSingleValueRange(range))
    .map(([path, range]) => [path, range.lower!] as const);
  const orderFields: string[] = (
    Array.isArray(orderBy) ? orderBy : orderBy != null ? [orderBy] : []
  )
    // Remove fields which are filtered by single value from ordering, as they don't affect order.
    .filter((field) => !eqFilters.some(([path]) => path === field));

  if (filters.length + orderFields.length === 0) {
    return () => Array.fromAsync(simpleQuery(store, keyRange, { direction, limit }));
  }

  const eqFields = new Set(eqFilters.map(([path]) => path));
  const rangeFields = new Set(rangeFilters.map(([path]) => path));
  const indexes = findIndexes(store, orderFields, eqFields, rangeFields);
  const allIndexes = Array.from(store.indexNames).map((name) => store.index(name));
  if (indexes.length === 0)
    throw new MissingIndexError(orderFields, eqFields, rangeFields, allIndexes);

  if (indexes.length === 1) {
    const index = indexes[0]!;
    if (!Array.isArray(index.keyPath)) {
      const range = where[index.keyPath];
      return () => Array.fromAsync(simpleQuery2(index, range, keyRange, { direction, limit }));
    }
    // For compound index we need to create ranges for all fields in the index based on provided filters.
    const ranges = index.keyPath.map((field) => where[field]);
    return () =>
      Array.fromAsync(multiDimensionalQuery(index, ranges, keyRange, { direction, limit }));
  }

  // If we have multiple indexes, use zig zag query.
  const indexValues = indexes.map((index) => {
    if (Array.isArray(index.keyPath)) {
      return [index, [where[index.keyPath[0]!]!.lower!]] as const;
    } else {
      return [index, where[index.keyPath]!.lower!] as const;
    }
  });
  const indexFields = indexes[0]!.keyPath;
  const postfixRanges = Array.isArray(indexFields)
    ? indexFields.slice(1).map((field) => where[field])
    : undefined;
  return () =>
    Array.fromAsync(zigZagQuery(indexValues, postfixRanges, keyRange, { direction, limit }));
}

function findIndexes(
  store: IDBObjectStore,
  orderFields: readonly string[],
  eqFields: ReadonlySet<string>,
  rangeFields: ReadonlySet<string>,
): readonly IDBIndex[] {
  const indexes = Array.from(store.indexNames).map((name) => store.index(name));
  const sortableFields = new Set([...orderFields, ...rangeFields]);
  const allFields = new Set([...eqFields, ...sortableFields]);
  const zigZagIndexes = new Map<string, Map<string, IDBIndex>>();
  let fullIndex: IDBIndex | undefined;

  for (const index of indexes) {
    const indexFields = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
    const sortableIndexFields = indexFields.filter((field) => !eqFields.has(field));

    // If index consists of all the fields we need and begins with order fields, use it.
    if (
      allFields.values().every((field) => indexFields.includes(field)) &&
      orderFields.every((field, i) => sortableIndexFields[i] === field)
    ) {
      if (
        !fullIndex ||
        (Array.isArray(index.keyPath) ? index.keyPath.length : 1) <
          (Array.isArray(fullIndex.keyPath) ? fullIndex.keyPath.length : 1)
      ) {
        fullIndex = index;
      }
    }

    // If index begins with one of eq fields followed by sortable fields, add it to potential zig zag indexes.
    if (
      eqFields.has(indexFields[0]!) &&
      sortableFields.values().every((field) => indexFields.includes(field)) &&
      orderFields.every((field, i) => indexFields[i + 1] === field)
    ) {
      // Group indexes by the fields they have after eq fields, as those are the ones used for zig zag merge.
      const postfix = indexFields.slice(1).join("+");
      const foundIndexes = zigZagIndexes.get(postfix) ?? new Map<string, IDBIndex>();
      foundIndexes.set(indexFields[0]!, index);
      if (foundIndexes.size === eqFields.size) {
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
