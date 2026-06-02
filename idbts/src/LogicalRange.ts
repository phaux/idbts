export const toLogicalRange = (range: IDBKeyRange, reverse: boolean): LogicalKeyRange => ({
  start: (reverse ? range.upper : range.lower) as IDBValidKey | undefined,
  startOpen: reverse ? range.upperOpen : range.lowerOpen,
  end: (reverse ? range.lower : range.upper) as IDBValidKey | undefined,
  endOpen: reverse ? range.lowerOpen : range.upperOpen,
});

interface LogicalKeyRange {
  start: IDBValidKey | undefined;
  startOpen: boolean;
  end: IDBValidKey | undefined;
  endOpen: boolean;
}

/**
 * Checks the position of the key in relation to the given range:
 * - -2: key is before the range
 * - -1: key is at the start of the range (if excluded)
 * -  0: key is within the range (including boundary if inclusive)
 * -  1: key is at the end of the range (if excluded)
 * -  2: key is after the range
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
