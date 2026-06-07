import type { AnyDatabaseSchema, AnyIndexSchema, AnyStoreSchema, Database } from "./Database.ts";
import { iterateIndexesConcurrently } from "./iterateIndexesConcurrently.ts";
import { iterateStoreOrIndex, type CursorIterationOptions } from "./iterateStoreOrIndex.ts";
import type { FieldValue } from "./KeyPath.ts";
import { isSingleValueRange, toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";

/**
 * Executes a one-shot async query against an IndexedDB object store
 * and returns all matching records as an array.
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
 * @throws {MissingIndexError} If no suitable index (or combination of indexes)
 * can be found to satisfy the requested filters and ordering.
 * The error message names the missing index key paths
 * so you know what to add to your schema.
 */
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

  /** Map of normalized query filters passed in the where clause. */
  const queryFilterMap = new Map(
    Object.entries<MaybeKeyRange<IDBValidKey> | undefined>(where)
      .filter(([, range]) => range != undefined)
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
  const queryOrderFields = (
    (Array.isArray as (v: unknown) => v is readonly unknown[])(orderBy) ? orderBy : [orderBy]
  ).filter((field) => !queryEqFields.has(field));
  const sortableQueryFields = new Set([...queryOrderFields, ...queryRangeFields]);
  const allQueryFields = new Set([...queryEqFields, ...sortableQueryFields]);
  const primaryKeyFields = Array.isArray(store.keyPath) ? store.keyPath : [store.keyPath!];
  const sortablePrimaryKeyFields = primaryKeyFields.filter((field) => !queryEqFields.has(field));
  const primaryKeyRanges = Array.isArray(store.keyPath)
    ? store.keyPath.map((field) => queryFilterMap.get(field))
    : queryFilterMap.get(store.keyPath!);

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
      indexKeyFields.every((field) => allQueryFields.has(field)) &&
      queryOrderFields.every((field, i) => allIndexFields[i + 1] === field)
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
 * Options accepted by {@link query}.
 */
export interface QueryOptions<StoreSchema extends AnyStoreSchema> extends CursorIterationOptions {
  /**
   * Field-level filter predicates.
   * Store item must satisfy all of them to be included in the results (AND semantics).
   * Omit entirely to return all records.
   *
   * Each key is a field path present on the store's primary key or one of its indexes;
   * the value is either an exact value (equality filter)
   * or an {@link IDBKeyRange}-shaped object (range filter).
   *
   * Examples:
   *
   * ```js
   * where = { "name.first": "Alice" }; // single value
   * where = { age: IDBKeyRange.bound(18, 65) }; // 18 <= age <= 65
   * where = { age: { lower: 18, upper: 65 } }; // same as above
   * where = { age: { lower: 18, lowerOpen: true } }; // age > 18
   * where = { age: { upper: 65, upperOpen: true } }; // age < 65
   * where = { // multiple fields (AND)
   *   "name.first": "Piotr",
   *   "name.last": "Nowak",
   * };
   * ```
   */
  readonly where?: QueryFilters<StoreSchema> | undefined;
  /**
   * One or more field paths to sort the results by.
   *
   * When omitted, order depends on the specified fields in `where` (if any),
   * or the store's natural primary key order otherwise.
   */
  readonly orderBy?: QueryOrder<StoreSchema> | undefined;
}

/**
 * A partial map of field path → key range used to filter query results.
 *
 * Keys are the union of all filterable fields:
 * every component of the store's primary key ({@link QueryFieldsFromStore})
 * plus every component of every named index ({@link QueryFieldsFromIndexes}).
 *
 * Each value is either:
 * - a plain {@link IDBValidKey} value (interpreted as an equality filter), or
 * - an {@link IDBKeyRange}-shaped object
 *   (can be a plain object; interpreted as a bounds filter), or
 * - `undefined` / absent (field is not filtered).
 *
 * Each field value is additionally constrained to the actual type at that field path.
 */
export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in QueryFieldsFromStore<StoreSchema>]?: MaybeKeyRange<
    Extract<FieldValue<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>
  >;
} & {
  readonly [K in QueryFieldsFromIndexes<StoreSchema> & string]?: MaybeKeyRange<
    Extract<FieldValue<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>
  >;
};

/**
 * Extracts the filterable/sortable field names
 * that come from the store's own primary key path.
 *
 * - For a composite key path (array of key paths)
 *   this is the union of all its components.
 * - For a simple key path this is that single string.
 */
export type QueryFieldsFromStore<StoreSchema extends AnyStoreSchema> =
  StoreSchema["keyPath"] extends readonly string[]
    ? StoreSchema["keyPath"][number] & string
    : StoreSchema["keyPath"] extends string
      ? StoreSchema["keyPath"] & string
      : never;

/**
 * Extracts the union of all filterable/sortable field names
 * contributed by every named index defined on the store.
 *
 * Iterates over every entry in indexes map of store schema,
 * and collects the result of {@link QueryFieldsFromIndex} for each,
 * then unions them together.
 *
 * Resolves to `never` when the store has no indexes.
 */
export type QueryFieldsFromIndexes<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexes"] extends object
    ? {
        [I in keyof StoreSchema["indexes"]]: QueryFieldsFromIndex<StoreSchema["indexes"][I]>;
      }[keyof StoreSchema["indexes"]]
    : never;

/**
 * Extracts the filterable/sortable field names contributed by a single index.
 *
 * - For a composite index key path (array of strings)
 *   this is the union of all its components.
 * - For a simple index key path this is that single string.
 */
export type QueryFieldsFromIndex<IndexSchema extends AnyIndexSchema> =
  IndexSchema["keyPath"] extends readonly string[]
    ? IndexSchema["keyPath"][number] & string
    : IndexSchema["keyPath"] extends string
      ? IndexSchema["keyPath"] & string
      : never;

/**
 * Infers possible sort orders for a query.
 *
 * Can be either a single {@link QueryOrderField} or an array of them.
 *
 * Fields are applied left-to-right as tie-breakers,
 * mirroring the way IndexedDB composite keys work.
 */
export type QueryOrder<StoreSchema extends AnyStoreSchema> =
  | QueryOrderField<StoreSchema>
  | readonly QueryOrderField<StoreSchema>[];

/**
 * Infers a single field path that may be used in an `orderBy` clause.
 *
 * That is, the union of every field that comes from the store's primary key ({@link QueryFieldsFromStore})
 * and every field that comes from any of the store's named indexes ({@link QueryFieldsFromIndexes}).
 */
export type QueryOrderField<StoreSchema extends AnyStoreSchema> =
  | QueryFieldsFromStore<StoreSchema>
  | QueryFieldsFromIndexes<StoreSchema>;
