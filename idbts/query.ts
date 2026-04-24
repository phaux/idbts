import type { DBIndex } from "./DBIndex.ts";
import type { AnyStoreSchema, ReadonlyDBStore } from "./DBStore.ts";
import { arrayifyRange, isSingleValueRange, KeyRange, type ValidKey } from "./KeyRange.ts";
import { multiDimensionalQuery } from "./multiDimensionalQuery.ts";
import { simpleQuery } from "./simpleQuery.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import type { AnyPath } from "./ValuesAtPaths.ts";
import { zigZagQuery } from "./zigZagQuery.ts";

export const primaryKey = Symbol("primaryKey");

export async function query<const Schema extends AnyStoreSchema>(
  store: ReadonlyDBStore<Schema>,
  options: QueryOptions<Schema>,
): Promise<SchemaValue<Schema["value"]>[]> {
  const queryFn = planQuery(store, options);
  return queryFn();
}

function planQuery(store: ReadonlyDBStore<any>, options: QueryOptions<any>): () => Promise<any[]> {
  const { where = {}, orderBy, direction, limit = Infinity, offset = 0 } = options;

  const keyRange = where[primaryKey];
  const filters = Object.entries(where);
  const rangeFilters = objectEntries(where).filter(([_path, range]) => !isSingleValueRange(range));

  if (keyRange) {
    if (orderBy != null) {
      throw new Error("Primary key filter cannot use sorting.");
    }

    if (isSingleValueRange(keyRange)) {
      // Get by single primary key
      if (filters.length > 0) {
        throw new Error("Primary key equality filter cannot be combined with other filters.");
      }
      return async () => {
        const result = await store.get(keyRange.lower);
        return (result != null ? [result] : []).slice(offset, offset + limit);
      };
    }

    if (rangeFilters.length > 0) {
      throw new Error("Primary key range filter cannot be combined with other range filters.");
    }

    return () => Array.fromAsync(simpleQuery(store, keyRange, { direction, limit, offset }));
  }

  if (filters.length === 1 || (filters.length === 0 && orderBy != null && !isArray(orderBy))) {
    // Single range/order field can use simple query
    const filter = filters[0];
    if (filter && orderBy != null && filter[0] !== orderBy) {
      throw new Error("Sorting field must match filter field.");
    }
    const field = filter?.[0] ?? orderBy!;
    const range = filter?.[1];
    // Find index for sorting
    const index = findIndexExact(store, field);
    return () => Array.fromAsync(simpleQuery(index, range, { direction, limit, offset }));
  }

  const eqFilters = filters
    .filter(([_path, range]) => isSingleValueRange(range))
    .map(([path, range]) => [path, range.lower!] as const);
  if (eqFilters.length > 0) {
    // Equality filters require zig zag query

    if (rangeFilters.length > 1) {
      throw new Error("Equality filters cannot be combined with multiple range filters.");
    }
    const rangeFilter = rangeFilters[0];

    if (offset > 0) {
      throw new Error("Equality filters cannot use offset.");
    }

    const sortField = rangeFilter?.[0] ?? orderBy;
    if (sortField != null && !eqFilters.some(([path]) => path === sortField)) {
      // Zig zag query with custom sort
      if (orderBy != null && orderBy !== sortField) {
        throw new Error("Sorting field must match filter field.");
      }
      const range = rangeFilter?.[1];
      // Every filter index must also end with the field for ordering.
      const zigZagFilters = eqFilters.map(
        ([path, key]) => [findIndexExact(store, [path, sortField].flat(1)).raw.name, [key]] as const,
      );
      return () =>
        Array.fromAsync(
          zigZagQuery(store, zigZagFilters, { suffixRange: range && arrayifyRange(range), direction, limit }),
        );
    }

    // Zig zag query with default sort by primary key
    const zigZagFilters = eqFilters.map(([path, key]) => [findIndexExact(store, path).raw.name, key] as const);
    return () =>
      Array.fromAsync(
        zigZagQuery(store, zigZagFilters, { keyRange: keyRange && arrayifyRange(keyRange), direction, limit }),
      );
  }

  if (orderBy != null && isArray(orderBy)) {
    // Order by multiple fields requires multi-dimensional query
    for (const [path] of filters) {
      if (!orderBy.includes(path)) {
        throw new Error("Compound field sorting can only filter by the sorted fields.");
      }
    }
    const index = findIndexExact(store, orderBy);
    const ranges = (index.raw.keyPath as string[]).map((path) => rangeFilters.find(([p]) => p === path)?.[1]);
    return () => Array.fromAsync(multiDimensionalQuery(index, ranges, { keyRange, direction, limit }));
  }

  if (rangeFilters.length > 1) {
    // Multiple range filters require multi-dimensional query
    const index = findIndex(
      store,
      rangeFilters.map(([path]) => path),
    );
    const ranges = (index.raw.keyPath as string[]).map((path) => rangeFilters.find(([p]) => p === path)![1]);
    return () => Array.fromAsync(multiDimensionalQuery(index, ranges, { direction, limit }));
  }

  if (offset > 0 || Number.isFinite(limit) || direction != null) {
    return () => Array.fromAsync(simpleQuery(store, null, { direction, limit, offset }));
  }

  return () => store.getAll();
}

const listFmt = new Intl.ListFormat("en");

function findIndexExact(store: ReadonlyDBStore<any>, path: AnyPath): DBIndex<any, any> {
  const indexNames = Array.from(store.raw.indexNames);
  const indexName = indexNames.find((name) => indexedDB.cmp(store.raw.index(name).keyPath, path) === 0);
  if (indexName == null) throw new Error(`Index for ${listFmt.format(toArray(path))} not found.`);
  return store.index(indexName);
}

function findIndex(store: ReadonlyDBStore<any>, paths: readonly string[]): DBIndex<any, any> {
  const indexNames = Array.from(store.raw.indexNames);
  const indexName = indexNames.find((name) => {
    const idx = store.raw.index(name);
    if (!Array.isArray(idx.keyPath)) return false;
    return paths.every((path) => idx.keyPath.includes(path));
  });
  if (indexName == null) throw new Error(`Index with ${listFmt.format(paths)} not found.`);
  return store.index(indexName);
}

export type QueryOptions<Schema extends AnyStoreSchema> = {
  readonly where?: Readonly<Record<string | symbol, KeyRange<ValidKey>>> | undefined;
  readonly orderBy?: string | readonly string[] | undefined;
  readonly direction?: "next" | "prev" | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
};

const objectEntries = Object.entries as <T extends object>(obj: T) => [keyof T & string, T[keyof T]][];

const isArray = Array.isArray as <T>(value: any) => value is readonly T[];

const toArray = <T>(value: T | readonly T[]): readonly T[] => (isArray(value) ? value : [value]);
