import type { DBIndex, IndexKey } from "./DBIndex.ts";
import type { AnyStoreSchema, ReadonlyDBStore, StoreOutputKey } from "./DBStore.ts";
import type { KeyRange, ValidKey } from "./KeyRange.ts";
import type { SchemaValue } from "./StandardSchema.ts";
import { zigZagJoin } from "./zigZagJoin.ts";

export async function query<const Schema extends AnyStoreSchema>(
  store: ReadonlyDBStore<Schema>,
  params: QueryParams<Schema>,
): Promise<SchemaValue<Schema["value"]>[]> {
  const queryFn = planQuery(store, params);
  return queryFn();
}

function planQuery(store: ReadonlyDBStore<any>, params: QueryParams<any>): () => Promise<any[]> {
  const { by, range, where = [] } = params;

  if (by == null) {
    // Null order implies order by primary key.

    if (where.length === 0) {
      return () => store.getAll(range);
    }

    // Find index for every where clause
    const filters = where.map(([path, op, key]) => [findIndex(store, path).raw.name, key] as const);

    return () => Array.fromAsync(zigZagJoin(store, filters, null));
  }

  // Order by some index

  if (where.length === 0) {
    // Find index for sorting
    const index = findIndex(store, by);
    return () => index.getAll(range);
  }

  // Both order and filters are specified.
  // Every index for where clause must also end with the field for ordering.
  const filters = where.map(([path, op, key]) => [findIndex(store, [path, by].flat(1)).raw.name, key] as const);

  return () => Array.fromAsync(zigZagJoin(store, filters, range));
}

function findIndex(store: ReadonlyDBStore<any>, path: AnyPath): DBIndex<any, any> {
  const indexNames = Array.from(store.raw.indexNames);
  const indexName = indexNames.find((name) => indexedDB.cmp(store.raw.index(name).keyPath, path) === 0);
  if (indexName == null) throw new Error(`Index for path ${JSON.stringify(path)} not found.`);
  return store.index(indexName);
}

export type QueryParams<Schema extends AnyStoreSchema> =
  | QueryParam<
      undefined,
      StoreOutputKey<Schema>,
      Schema["indexes"] extends {}
        ? {
            [I in keyof Schema["indexes"] & string]: QueryFilter<Schema["indexes"][I]["keyPath"], IndexKey<Schema, I>>;
          }[keyof Schema["indexes"] & string]
        : never
    >
  | (Schema["indexes"] extends {}
      ? {
          [I in keyof Schema["indexes"] & string]: QueryParam<
            Schema["indexes"][I]["keyPath"],
            IndexKey<Schema, I>,
            never
          >;
        }[keyof Schema["indexes"] & string]
      : never);

export type QueryParam<
  out Order extends AnyPath | undefined,
  out Key extends ValidKey,
  out Filter extends AnyFilter,
> = {
  readonly by: Order;
  readonly range?: KeyRange<Key>;
  readonly where?: readonly Filter[];
};

export type AnyFilter = QueryFilter<AnyPath, ValidKey>;

export type QueryFilter<Path extends AnyPath, Key extends ValidKey> = readonly [Path, QueryOp, Key];

export type AnyPath = string | readonly string[];

export type QueryOp = "eq";

export type AnySuffix<T> = T extends readonly [unknown, ...infer Rest] ? T | AnySuffix<readonly [...Rest]> : T;

// export interface QueryParams<Schema extends AnyStoreSchema> {
//   orderBy?: Schema["indexes"] extends NonNullable<unknown>
//     ?
//         | {
//             [I in keyof Schema["indexes"] & string]: AnySuffix<Schema["indexes"][I]["keyPath"]>;
//           }[keyof Schema["indexes"] & string]
//         | undefined
//     : undefined;
//   where?:
//     | ReadonlyArray<
//         | (Schema["indexes"] extends NonNullable<unknown>
//             ? {
//                 [I in keyof Schema["indexes"] & string]: QueryWhereClause<Schema, Schema["indexes"][I]>;
//               }[keyof Schema["indexes"] & string]
//             : never)
//         | readonly ["$key", QueryOp, StoreOutputKey<Schema>]
//       >
//     | undefined;
// }

// export type QueryWhereClause<StoreSchema extends AnyStoreSchema, IndexSchema extends AnyIndexSchema> = {
//   [KP in FlatArray<IndexSchema["keyPath"], 1>]: readonly [
//     KP,
//     QueryOp,
//     ValuesAtPaths<SchemaValue<StoreSchema["value"]>, IndexSchema["keyPath"]> extends infer Key extends ValidKey
//       ? IndexSchema["multiEntry"] extends true
//         ? FlatArray<Key, 1>
//         : Key
//       : never,
//   ];
// }[FlatArray<IndexSchema["keyPath"], 1>];
