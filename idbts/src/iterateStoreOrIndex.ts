import { continuePrimaryKeyRange } from "./continuePrimaryKeyRange.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";

/**
 * Options controlling how a cursor iterates over an object store or index.
 */
export interface CursorIterationOptions {
  /**
   * Whether to reverse the traversal direction.
   */
  readonly reverse?: boolean | undefined;
  /**
   * Maximum number of records to yield. Defaults to `Infinity` (no limit).
   */
  readonly limit?: number | undefined;
}

/**
 * Yields store or index entries that satisfy the given key ranges.
 * A key range for the record's key and/or primary key can be specified.
 * Undefined ranges are treated as a wildcard (matches all values).
 *
 * Note that when iterating a store directly, the key and primary key are the same value.
 * In this case, the second range argument should be omitted.
 *
 * ## Examples
 *
 * Iterate primary key range:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateStoreOrIndex(
 *     store,
 *     IDBKeyRange.bound(1, 10),
 *     undefined,
 *     { ...options},
 *   )
 * );
 * ```
 *
 * Get intersection of index and primary key ranges:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateStoreOrIndex(
 *     store.index("byName"),
 *     IDBKeyRange.bound("M", "M\uFFFF"),
 *     IDBKeyRange.bound(20, 30),
 *     { ...options},
 *   )
 * );
 * ```
 */
export async function* iterateStoreOrIndex<T>(
  iterable: IDBObjectStore | IDBIndex,
  keyRange: IDBKeyRange | undefined,
  primaryKeyRange: IDBKeyRange | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { reverse = false, limit = Infinity } = options;
  let cursor = await idbReqToPromise(iterable.openCursor(keyRange, reverse ? "prev" : "next"));
  let i = 0;
  while (i < limit) {
    if (primaryKeyRange) {
      cursor = await continuePrimaryKeyRange(cursor, primaryKeyRange, reverse);
    }
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}
