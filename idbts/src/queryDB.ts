import type { AnyDatabaseSchema, AnyStoreSchema, Database, StoreValue } from "./Database.ts";
import { iterateIndexesConcurrently } from "./iterateIndexesConcurrently.ts";
import { iterateStoreOrIndex, type CursorIterationOptions } from "./iterateStoreOrIndex.ts";
import type { FieldValue } from "./KeyPath.ts";
import { toKeyRange, type KeyRangeObject } from "./KeyRange.ts";

/**
 * Executes a one-shot async query against a database
 * and returns all matching items as an array.
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
): Promise<StoreValue<Schema[StoreName]>[]> {
  // Create a no-op transaction to get the primary key path.
  const tx = db.idb.transaction(storeName, "readonly"),
    store = tx.objectStore(storeName),
    // Enforced by openDB to be a string
    primaryKeyPath = store.keyPath as string;

  // Extract and normalize the option values.
  const where: Record<string, IDBValidKey | undefined> = options.where ?? {},
    filters = Object.entries(where).filter(
      (entry): entry is [string, IDBValidKey] => entry[1] != null,
    ),
    orderBy = options.orderBy ?? primaryKeyPath,
    lower = options.lower,
    lowerOpen = options.lowerOpen,
    upper = options.upper,
    upperOpen = options.upperOpen,
    range = toKeyRange({ lower, lowerOpen, upper, upperOpen });

  if (filters.length === 0) {
    if (orderBy === primaryKeyPath) {
      // Query by primary key range.
      return Array.fromAsync(iterateStoreOrIndex(store, range, undefined, options));
    }

    // Query by index range.
    const index = store.index(orderBy);
    return Array.fromAsync(iterateStoreOrIndex(index, range, undefined, options));
  }

  if (filters.length === 1) {
    const [field, value] = filters[0]!;

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
      iterateStoreOrIndex(index, [IDBKeyRange.only(value), range], undefined, options),
    );
  }

  const orderFilter = filters.find(([field]) => field === orderBy);
  if (orderFilter) {
    if (range && !range.includes(orderFilter[1])) return [];

    // Query by multiple primary key/index values.
    const indexValues = filters.map(
      ([field, value]) => [field === primaryKeyPath ? store : store.index(field), value] as const,
    );
    return Array.fromAsync(iterateIndexesConcurrently(indexValues, undefined, undefined, options));
  }

  if (orderBy === primaryKeyPath) {
    // Query by multiple index values and primary key range.
    const indexValues = filters.map(([field, value]) => [store.index(field), value] as const);
    return Array.fromAsync(iterateIndexesConcurrently(indexValues, undefined, range, options));
  }

  // Query by multiple composite index values and range.
  const keyFilter = filters.find(([field]) => field === primaryKeyPath);
  const indexValues = filters
    .filter(([field]) => field !== primaryKeyPath)
    .map(([field, value]) => [store.index(`${field}+${orderBy}`), [value] as IDBValidKey] as const);
  return Array.fromAsync(
    iterateIndexesConcurrently(
      indexValues,
      [range],
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
export type QueryOptions<StoreSchema extends AnyStoreSchema> = QueryOptionsForStore<StoreSchema> &
  CursorIterationOptions;

/**
 * Query options specific to a store.
 *
 * Infers options specific to primary and every sortable key path in the store schema.
 */
export type QueryOptionsForStore<StoreSchema extends AnyStoreSchema> =
  | {
      [K in StoreSortableKeyPaths<StoreSchema>]: QueryOptionsForStoreKeyPath<StoreSchema, K>;
    }[StoreSortableKeyPaths<StoreSchema>]
  | Partial<QueryOptionsForStoreKeyPath<StoreSchema, StoreSchema["primaryKeyPath"] | undefined>>;

/**
 * Query options specific to a given store schema and sort key path.
 */
export interface QueryOptionsForStoreKeyPath<
  StoreSchema extends AnyStoreSchema,
  OrderKeyPath extends string | undefined,
> extends KeyRangeObject<
  OrderKeyPath extends NonNullable<unknown>
    ? FieldValue<StoreValue<StoreSchema>, OrderKeyPath>
    : undefined
> {
  /**
   * Key path used to sort the query results.
   *
   * When omitted, the default order based on the primary key is used.
   */
  readonly orderBy: OrderKeyPath;
  /**
   * Field equality filter predicates.
   *
   * Store item must satisfy all of them to be included in the results (AND semantics).
   *
   * Omit entirely to return all records.
   */
  readonly where?: QueryFilters<StoreSchema> | undefined;
}

/**
 * A partial map of primary/indexed key path → key value at that path.
 * Used to filter query results.
 */
export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in StoreSchema["primaryKeyPath"] | StoreIndexedKeyPaths<StoreSchema>]?: FieldValue<
    StoreValue<StoreSchema>,
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
