import { idbReqToPromise } from "./idbReqToPromise.ts";
import { skipCursorOverRanges } from "./skipCursorOverRanges.ts";

/**
 * Options controlling how a cursor iterates over an object store or index.
 */
export interface CursorIterationOptions {
  /**
   * Cursor traversal direction.
   *
   * @see {@link IDBCursorDirection}
   */
  readonly direction?: "next" | "prev" | undefined;
  /**
   * Maximum number of records to yield. Defaults to `Infinity` (no limit).
   */
  readonly limit?: number | undefined;
}

/**
 * Yields store or index entries that satisfy the given key ranges.
 *
 * A key range for the record's key and/or primary key can be specified.
 * If iterating a composite key, an array of ranges should be provided.
 * In this case, each range corresponds to a composite key component.
 * Undefined ranges are treated as a wildcard (matches all values).
 *
 * The cursor is opened at the start of the store/index (or end if reversed)
 * and advanced by {@link skipCursorOverRanges} to efficiently skip records
 * that do not match the specified ranges.
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
 * Get intersection of index value and primary key ranges:
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
 *
 * Get intersection of name and age ranges:
 *
 * ```js
 * const results = await Array.fromAsync(
 *   iterateStoreOrIndex(
 *     store.index("byNameAndAge"),
 *     [
 *       IDBKeyRange.bound("M", "M\uFFFF"),
 *       IDBKeyRange.bound(20, 30),
 *     ],
 *     undefined,
 *     { ...options},
 *   )
 * );
 * ```
 */
export async function* iterateStoreOrIndex<T>(
  iteratable: IDBObjectStore | IDBIndex,
  keyRanges: IDBKeyRange | readonly (IDBKeyRange | undefined)[] | undefined,
  primaryKeyRanges: IDBKeyRange | readonly (IDBKeyRange | undefined)[] | undefined,
  options: CursorIterationOptions,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(iteratable.openCursor(null, direction));
  let i = 0;
  while (i < limit) {
    cursor = await skipCursorOverRanges(cursor, keyRanges, primaryKeyRanges, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request as IDBRequest<IDBCursorWithValue | null>);
  }
}
