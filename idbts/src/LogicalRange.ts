/**
 * Converts an {@link IDBKeyRange} into a {@link LogicalKeyRange}
 * whose `start`/`end` terminology always reflects the direction of traversal.
 *
 * When iterating in reverse (`reverse === true`),
 * the IDB `upper` bound becomes the logical `start`
 * (the first key encountered during traversal)
 * and the IDB `lower` bound becomes the logical `end`
 * (the last key encountered),
 * and vice versa for forward iteration.
 */
export const toLogicalRange = (range: IDBKeyRange, reverse: boolean): LogicalKeyRange => ({
  start: (reverse ? range.upper : range.lower) as IDBValidKey | undefined,
  startOpen: reverse ? range.upperOpen : range.lowerOpen,
  end: (reverse ? range.lower : range.upper) as IDBValidKey | undefined,
  endOpen: reverse ? range.lowerOpen : range.upperOpen,
});

/**
 * A key range expressed in terms of the current iteration direction, where
 * `start` is the first key that could be in range and `end` is the last.
 *
 * Construct one from an {@link IDBKeyRange} using {@link toLogicalRange}.
 */
interface LogicalKeyRange {
  /**
   * The first key (in traversal order) that may fall within the range.
   * `undefined` means unbounded at the start.
   */
  start: IDBValidKey | undefined;
  /**
   * Whether the start bound is open (exclusive).
   */
  startOpen: boolean;
  /**
   * The last key (in traversal order) that may fall within the range.
   * `undefined` means unbounded at the end.
   */
  end: IDBValidKey | undefined;
  /**
   * Whether the end bound is open (exclusive).
   */
  endOpen: boolean;
}

/**
 * Checks the position of `key` relative to `range`, oriented to the current
 * traversal direction.
 *
 * Return values:
 * - `-2`: key is before the start of the range (cursor has not yet reached it).
 * - `-1`: key is exactly at the start boundary, but the boundary is open (exclusive),
 *   so the key is not included in the range.
 * - `0`: key is within the range (inclusive of closed boundaries).
 * - `1`: key is exactly at the end boundary, but the boundary is open (exclusive),
 *   so the key is not included in the range.
 * - `2`: key is past the end of the range (cursor has gone beyond it).
 *
 * If reversed, key comparisons are negated
 * so that "before" and "after" remain consistent with descending cursor iteration.
 * Pass the same reverse value used when constructing `range` via {@link toLogicalRange}.
 */
export function logicalRangeCmp(
  range: LogicalKeyRange,
  key: IDBValidKey,
  reverse: boolean,
): number {
  const { start, startOpen, end, endOpen } = range;
  if (start != null) {
    let order = indexedDB.cmp(key, start);
    if (reverse) order = -order;
    if (order < 0) return -2;
    if (startOpen && order == 0) return -1;
  }
  if (end != null) {
    let order = indexedDB.cmp(key, end);
    if (reverse) order = -order;
    if (order > 0) return 2;
    if (endOpen && order == 0) return 1;
  }
  return 0;
}
