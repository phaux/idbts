import type { AnyDatabaseSchema, AnyIndexSchema, AnyStoreSchema, Database } from "./Database.ts";
import {
  iterateIndexesConcurrently,
  iterateStoreOrIndex,
  type CursorIterationOptions,
} from "./iterateStoreOrIndex.ts";
import type { FieldValue } from "./KeyPath.ts";
import { isSingleValueRange, toKeyRange, type MaybeKeyRange } from "./KeyRange.ts";
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
  const { where = {}, orderBy = [] } = options;

  const queryFilters = Object.entries<MaybeKeyRange<IDBValidKey>>(where).map(
    ([path, range]) => [path, toKeyRange(range)] as const,
  );
  const queryFilterMap = new Map(queryFilters);
  const queryRangeFilters = queryFilters.filter(([, range]) => !isSingleValueRange(range));
  const queryEqFilters = queryFilters
    .filter(([, range]) => isSingleValueRange(range))
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
            : ([index, queryFilterMap.get(index.keyPath)!.lower!] as const),
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

export interface QueryOptions<StoreSchema extends AnyStoreSchema> extends CursorIterationOptions {
  readonly where?: QueryFilters<StoreSchema> | undefined;
  readonly orderBy?: QueryOrder<StoreSchema> | undefined;
}

export type QueryFilters<StoreSchema extends AnyStoreSchema> = {
  readonly [K in QueryFieldsFromStore<StoreSchema>]?:
    | MaybeKeyRange<Extract<FieldValue<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>>
    | undefined;
} & {
  readonly [K in QueryFieldsFromIndexes<StoreSchema> & string]?:
    | MaybeKeyRange<Extract<FieldValue<SchemaValue<StoreSchema["value"]>, K>, IDBValidKey>>
    | undefined;
};

export type QueryFieldsFromStore<StoreSchema extends AnyStoreSchema> =
  StoreSchema["keyPath"] extends readonly string[]
    ? StoreSchema["keyPath"][number] & string
    : StoreSchema["keyPath"] extends string
      ? StoreSchema["keyPath"] & string
      : never;

export type QueryFieldsFromIndexes<StoreSchema extends AnyStoreSchema> =
  StoreSchema["indexes"] extends object
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
