import type {
  AnyDatabaseSchema,
  AnyStoreSchema,
  Database,
  StoreKey,
  StoreRecord,
} from "./Database.ts";
import { iterateIndexesConcurrently } from "./iterateIndexesConcurrently.ts";
import { iterateStoreOrIndex, type CursorIterationOptions } from "./iterateStoreOrIndex.ts";
import type { KeyPathValue } from "./KeyPath.ts";
import { prefixRange, toIDBKeyRange, type KeyRangeObject } from "./KeyRange.ts";

/**
 * Executes a one-shot async query against a database
 * and returns all matching records as an array.
 *
 * The function automatically selects the most efficient strategy:
 *
 * 1. **Primary key** – used by default.
 * 2. **Simple index** – when ordering by an indexed field.
 * 3. **Composite index** – when filtering by one field and ordering by another.
 * 4. **Zig-zag merge join** – if multiple equality filters were specified
 *    the algorithm opens one cursor per filter (each on its own index)
 *    and advances them in lockstep, yielding only records
 *    whose primary key appears in every cursor position.
 *
 * Example usage:
 *
 * ```js
 * const results = await queryDB(db, "users", {
 *   where: {
 *     "name.first": "Alice",
 *   },
 *   orderBy: "age",
 *   lower: 18,
 * });
 * ```
 */
export async function queryDB<
  const Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  options: QueryOptions<Schema[StoreName]>,
): Promise<StoreRecord<Schema[StoreName]>[]> {
  // Open a no-op transaction to obtain the primary key path.
  const tx = db.idb.transaction(storeName),
    store = tx.objectStore(storeName),
    // Enforced by openDB to be a string
    primaryKeyPath = store.keyPath as string;

  // Extract and normalize the option values.
  const where = Object.entries<IDBValidKey | undefined>(options.where ?? {}).filter(
      (filter): filter is [string, IDBValidKey] => filter[1] != null,
    ),
    orderBy = options.orderBy ?? primaryKeyPath,
    lower = options.lower,
    lowerOpen = options.lowerOpen,
    upper = options.upper,
    upperOpen = options.upperOpen,
    range = toIDBKeyRange({ lower, lowerOpen, upper, upperOpen });

  if (where.length === 0) {
    if (orderBy === primaryKeyPath) {
      // Query by primary key range.
      return Array.fromAsync(iterateStoreOrIndex(store, range, undefined, options));
    }

    // Query by index range.
    const index = store.index(orderBy);
    return Array.fromAsync(iterateStoreOrIndex(index, range, undefined, options));
  }

  if (where.length === 1) {
    const [field, value] = where[0]!;

    if (orderBy === primaryKeyPath) {
      if (field === primaryKeyPath) {
        // Query by primary key value.
        if (range && !range.includes(value)) return [];
        return Array.fromAsync(
          iterateStoreOrIndex(store, IDBKeyRange.only(value), undefined, options),
        );
      }

      // Query by index value and primary key range.
      const index = store.index(field);
      return Array.fromAsync(iterateStoreOrIndex(index, IDBKeyRange.only(value), range, options));
    }

    if (field === primaryKeyPath) {
      // Query by index range and primary key value.
      const index = store.index(orderBy);
      return Array.fromAsync(iterateStoreOrIndex(index, range, IDBKeyRange.only(value), options));
    }

    if (field === orderBy) {
      // Query by index value.
      if (range && !range.includes(value)) return [];
      const index = store.index(field);
      return Array.fromAsync(
        iterateStoreOrIndex(index, IDBKeyRange.only(value), undefined, options),
      );
    }

    // Query by composite index value and range.
    const index = store.index(`${field}+${orderBy}`);
    return Array.fromAsync(
      iterateStoreOrIndex(index, prefixRange(value, range), undefined, options),
    );
  }

  const orderFilter = where.find(([field]) => field === orderBy);
  if (orderFilter) {
    if (range && !range.includes(orderFilter[1])) return [];

    // Query by multiple primary key/index values.
    const indexValues = where.map(
      ([field, value]) =>
        [field === primaryKeyPath ? store : store.index(field), IDBKeyRange.only(value)] as const,
    );
    return Array.fromAsync(iterateIndexesConcurrently(indexValues, undefined, options));
  }

  if (orderBy === primaryKeyPath) {
    // Query by multiple index values and primary key range.
    const indexValues = where.map(
      ([field, value]) => [store.index(field), IDBKeyRange.only(value)] as const,
    );
    return Array.fromAsync(iterateIndexesConcurrently(indexValues, range, options));
  }

  // Query by multiple composite index values and range.
  const keyFilter = where.find(([field]) => field === primaryKeyPath);
  const indexValues = where
    .filter(([field]) => field !== primaryKeyPath)
    .map(
      ([field, value]) => [store.index(`${field}+${orderBy}`), prefixRange(value, range)] as const,
    );
  return Array.fromAsync(
    iterateIndexesConcurrently(
      indexValues,
      keyFilter ? IDBKeyRange.only(keyFilter[1]) : undefined,
      options,
    ),
  );
}

/**
 * Query options object for querying a given store schema.
 *
 * Accepted by {@link queryDB} and others.
 */
export type QueryOptions<StoreSchema extends AnyStoreSchema> = QueryPredicates<StoreSchema> &
  CursorIterationOptions;

/**
 * Query predicates specific to a store.
 *
 * Infers options specific to primary and every sortable key path in the store schema.
 */
export type QueryPredicates<StoreSchema extends AnyStoreSchema> =
  | {
      [K in StoreSortableKeyPaths<StoreSchema>]: QueryPredicatesForKeyPath<StoreSchema, K>;
    }[StoreSortableKeyPaths<StoreSchema>]
  | Partial<QueryPredicatesForKeyPath<StoreSchema, StoreSchema["primaryKeyPath"] | undefined>>;

/**
 * Query predicates specific to a given store schema and sort key path.
 */
export interface QueryPredicatesForKeyPath<
  StoreSchema extends AnyStoreSchema,
  OrderKeyPath extends string | undefined,
> extends KeyRangeObject<
  OrderKeyPath extends NonNullable<unknown> ? StoreKey<StoreSchema, OrderKeyPath> : undefined
> {
  /**
   * Key path used to sort the query results.
   *
   * When omitted, the default order based on the primary key is used.
   */
  readonly orderBy: OrderKeyPath;
  /**
   * Field equality filters. Accepts a map of key path to key value.
   *
   * Each record is tested for equality against the values at the specified key paths.
   * A record must satisfy all of them to be included in the results (AND semantics).
   *
   * Omit entirely to get all records.
   */
  readonly where?: QueryFilters<StoreSchema> | undefined;
}

/**
 * A partial map of primary/indexed key path → key value at that path.
 * Used to filter query results.
 */
export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in StoreSchema["primaryKeyPath"] | StoreIndexedKeyPaths<StoreSchema>]?: KeyPathValue<
    StoreRecord<StoreSchema>,
    K & string
  >;
};

/**
 * Infers the indexed key paths from a store schema.
 *
 * These are all the key paths specified in {@link AnyStoreSchema.indexedKeyPaths}.
 */
export type StoreIndexedKeyPaths<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexedKeyPaths"] extends object
    ? keyof StoreSchema["indexedKeyPaths"] & string
    : never;

/**
 * Infers the sortable indexed key paths from a store schema.
 *
 * These are all the key paths specified in {@link AnyStoreSchema.indexedKeyPaths}
 * that have `sortable` option set to `true`.
 */
export type StoreSortableKeyPaths<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexedKeyPaths"] extends object
    ? {
        [K in StoreIndexedKeyPaths<StoreSchema>]: StoreSchema["indexedKeyPaths"][K]["sortable"] extends true
          ? K
          : never;
      }[StoreIndexedKeyPaths<StoreSchema>]
    : never;
