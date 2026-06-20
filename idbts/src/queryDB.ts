import type { AnyDatabaseSchema, AnyStoreSchema, Database, StoreValue } from "./Database.ts";
import { iterateIndexesConcurrently } from "./iterateIndexesConcurrently.ts";
import { iterateStoreOrIndex, type CursorIterationOptions } from "./iterateStoreOrIndex.ts";
import type { FieldValue } from "./KeyPath.ts";
import { isSingleValueRange, toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";

/**
 * Executes a one-shot async query against a database
 * and returns all matching items as an array.
 *
 * The function automatically selects the most efficient strategy:
 *
 * 1. **Primary key** – if all queried fields are covered by the store's own compound key
 *    and the leading key components match the requested `orderBy` fields,
 *    the store cursor is used directly.
 * 2. **Single index** – if a single named index covers all queried fields with the correct order.
 * 3. **Zig-zag merge join** – when multiple equality filters exist
 *    but no composite index covers all of them,
 *    the algorithm opens one cursor per equality filter (each on its own index)
 *    and advances them in lockstep, yielding only records
 *    whose primary key appears in every cursor position.
 *
 * Example usage:
 *
 * ```ts
 * const results = await queryDB(db, "users", {
 *   where: {
 *     "name.first": "Alice",
 *   },
 *   orderBy: "age",
 *   lower: 18,
 * });
 * ```
 *
 * @throws {MissingIndexError} If no suitable index (or combination of indexes)
 * can be found to satisfy the requested filters and ordering.
 * The error message names the missing index key paths
 * so you know what to add to your schema.
 */
export async function queryDB<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): Promise<StoreValue<Schema[StoreName]>[]> {
  const tx = db.idb.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const primaryKeyPath = store.keyPath as string;
  const { where = {}, orderBy, lower, lowerOpen, upper, upperOpen } = options;

  if (orderBy != null && (lower != null || upper != null)) {
    const orderRange = toKeyRange({ lower, lowerOpen, upper, upperOpen });
    (where as Record<string, IDBKeyRange | undefined>)[orderBy] ??= orderRange;
  }

  /** Map of normalized query filters passed in the where clause. */
  const queryFilterMap = new Map(
    Object.entries<MaybeKeyRange<IDBValidKey> | undefined>(where)
      .filter(([, range]) => range != null)
      .map(([path, range]) => [path, toKeyRange(range)] as const),
  );
  /** Set of field names constrained by an equality filter (single value range). */
  const queryEqFields = new Set(
    Array.from(queryFilterMap)
      .filter(([, range]) => isSingleValueRange(range))
      .map(([path, range]) => [path, range!.lower!] as const)
      .map(([field]) => field),
  );
  /** Set of field names constrained by a range filter (more than one value). */
  const queryRangeFields = new Set(
    Array.from(queryFilterMap)
      .filter(([, range]) => !isSingleValueRange(range))
      .map(([field]) => field),
  );
  /**
   * Array of field names to order by.
   * Fields which are filtered by a single value are removed, as they don't affect order.
   * Ultimately, the chosen index must contain these fields in this order.
   */
  const queryOrderFields = (orderBy != null ? [orderBy] : []).filter(
    (field) => !queryEqFields.has(field),
  );
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);
  const primaryKeyFields = [primaryKeyPath];
  const sortablePrimaryKeyFields = primaryKeyFields.filter((field) => !queryEqFields.has(field));
  const primaryKeyRanges = queryFilterMap.get(primaryKeyPath);

  // Check if all query fields exist in the primary key,
  // and the order of fields is correct for sorting.
  if (
    allQueryFields.values().every((field) => primaryKeyFields.includes(field)) &&
    queryOrderFields.every((field, i) => sortablePrimaryKeyFields[i] === field)
  ) {
    // Use the store itself (ordered by primary key).
    return Array.fromAsync(iterateStoreOrIndex(store, primaryKeyRanges, undefined, options));
  }

  /**
   * Found indexes which can be potentially used with zig zag algorithm.
   * They are grouped by the combination of their postfix fields (outer Map)
   * and keyed by their prefix field (inner Map).
   */
  const zigZagIndexMap = new Map<string, Map<string, IDBIndex>>();

  // Find appropriate indexes to use for the query.
  const allIndexes = Array.from(store.indexNames).map((name) => store.index(name));
  for (const index of allIndexes) {
    const indexKeyFields = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
    const allIndexFields = [...indexKeyFields, ...primaryKeyFields];
    const sortableIndexFields = allIndexFields.filter((field) => !queryEqFields.has(field));

    // Check if all query fields exist in the index or primary key,
    // and if the order of fields matches the requested order.
    // Additionally, index key can't have any unrelated composite fields
    // (not specified in where or orderBy),
    // because for some records they can be undefined
    // and cause these records to not be included in the index.
    if (
      Array.from(allQueryFields).every((field) => allIndexFields.includes(field)) &&
      queryOrderFields.every((field, i) => sortableIndexFields[i] === field) &&
      indexKeyFields.every((field) => allQueryFields.has(field))
    ) {
      // We can use this index alone for the whole query.
      const keyRanges = Array.isArray(index.keyPath)
        ? index.keyPath.map((path) => queryFilterMap.get(path))
        : queryFilterMap.get(index.keyPath);
      return Array.fromAsync(iterateStoreOrIndex(index, keyRanges, primaryKeyRanges, options));
    }

    // Check if first composite field of index (prefix) is one of the equality query fields
    // and the rest (postfix) satisfy the usual index requirements.
    const prefix = allIndexFields[0]!;
    if (
      queryEqFields.has(prefix) &&
      Array.from(sortableQueryFields).every((field) => allIndexFields.includes(field)) &&
      queryOrderFields.every((field, i) => allIndexFields[i + 1] === field) &&
      indexKeyFields.every((field) => allQueryFields.has(field))
    ) {
      // Found a zig zag index candidate.
      // Group found indexes by the postfix fields,
      // as those must match exactly for all used zig zag indexes.
      // (they could be in different order if it wasn't specified)
      const postfix = indexKeyFields.slice(1).join("+");
      const postfixIndexMap = zigZagIndexMap.get(postfix) ?? new Map<string, IDBIndex>();
      // Add the index to the inner map keyed by the prefix (eq) field.
      postfixIndexMap.set(prefix, index);
      // Check if we have found indexes for all eq fields with the same postfix.
      if (postfixIndexMap.size === queryEqFields.size) {
        // We have found all required indexes, so use them for the zig zag query.
        const foundIndexes = Array.from(postfixIndexMap.values());
        const indexValuePairs = foundIndexes.map((index) =>
          Array.isArray(index.keyPath)
            ? ([index, [queryFilterMap.get(index.keyPath[0]!)!.lower!]] as const)
            : ([index, queryFilterMap.get(index.keyPath)!.lower!] as const),
        );
        const indexFields = foundIndexes[0]!.keyPath;
        const postfixRanges = Array.isArray(indexFields)
          ? indexFields.slice(1).map((field) => queryFilterMap.get(field))
          : undefined;
        return Array.fromAsync(
          iterateIndexesConcurrently(indexValuePairs, postfixRanges, primaryKeyRanges, options),
        );
      }
      zigZagIndexMap.set(postfix, postfixIndexMap);
    }
  }

  // Index not found. Prepare error message.

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

  throw new MissingIndexError(missingIndexPaths);
}

export class MissingIndexError extends Error {
  constructor(missingIndexPaths: string[]) {
    super(`Missing index on ${missingIndexPaths.join(", ")}.`);
    this.name = "MissingIndexError";
  }
}

/**
 * Options accepted by {@link queryDB}.
 */
export type QueryOptions<StoreSchema extends AnyStoreSchema> = {
  /**
   * Field equality filter predicates.
   * Store item must satisfy all of them to be included in the results (AND semantics).
   * Omit entirely to return all records.
   */
  readonly where?: QueryFilters<StoreSchema> | undefined;
} & QueryOrderAndRange<StoreSchema> &
  CursorIterationOptions;

/**
 * A partial map of primary/indexed field path → key value at that path.
 * Used to filter query results.
 */
export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in StoreSchema["primaryKeyPath"]]?: Extract<
    FieldValue<StoreValue<StoreSchema>, K>,
    IDBValidKey
  >;
} & {
  readonly [K in StoreIndexedKeyPaths<StoreSchema> & string]?: Extract<
    FieldValue<StoreValue<StoreSchema>, K>,
    IDBValidKey
  >;
};

/**
 * Infers possible order and range type combinations for the given store schema.
 */
export type QueryOrderAndRange<StoreSchema extends AnyStoreSchema> =
  | {
      [K in StoreOrderKeyPath<StoreSchema>]: OrderAndRange<
        K,
        Extract<FieldValue<StoreValue<StoreSchema>, K>, IDBValidKey>
      >;
    }[StoreOrderKeyPath<StoreSchema>]
  | Partial<OrderAndRange<undefined, undefined>>;

/**
 * Object containing order and range bounds with the given types.
 */
export interface OrderAndRange<
  KeyPath extends string | undefined,
  Value extends IDBValidKey | undefined,
> {
  /**
   * Key path used to sort the query results.
   *
   * When omitted, the default order based on the primary key is used.
   */
  readonly orderBy: KeyPath;
  /**
   * The lower bound of the range. Omit for an unbounded lower end.
   */
  readonly lower?: Value | undefined;
  /**
   * The upper bound of the range. Omit for an unbounded upper end.
   */
  readonly upper?: Value | undefined;
  /**
   * When `true`, the lower bound is excluded from the range (open/exclusive).
   * Defaults to `false` (inclusive).
   */
  readonly lowerOpen?: boolean | undefined;
  /**
   * When `true`, the upper bound is excluded from the range (open/exclusive).
   * Defaults to `false` (inclusive).
   */
  readonly upperOpen?: boolean | undefined;
}

/**
 * Valid order keys for a given store, either the primary key or a sortable indexed key.
 */
export type StoreOrderKeyPath<StoreSchema extends AnyStoreSchema> =
  | StoreSchema["primaryKeyPath"]
  | StoreSortableKeyPaths<StoreSchema>;

/**
 * Infers the indexed key paths from a store schema.
 */
export type StoreIndexedKeyPaths<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexedKeyPaths"] extends object ? keyof StoreSchema["indexedKeyPaths"] : never;

/**
 * Infers the sortable indexed key paths from a store schema.
 */
export type StoreSortableKeyPaths<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexedKeyPaths"] extends object
    ? {
        [K in keyof StoreSchema["indexedKeyPaths"]]: StoreSchema["indexedKeyPaths"][K]["sortable"] extends true
          ? K
          : never;
      }[keyof StoreSchema["indexedKeyPaths"] & string]
    : never;
