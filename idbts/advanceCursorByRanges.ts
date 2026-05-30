import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, minKey } from "./KeyRange.ts";

export async function advanceStoreRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    const keySkip = trySkipKey(cursor.key, keyRanges, reverse);
    if (!keySkip) break;
    if (keySkip.nextKey) cursor.continue(keySkip.nextKey);
    else cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
  return cursor;
}

export async function advanceIndexRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  primaryKeyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    const keySkip = trySkipKey(cursor.key, keyRanges, reverse);
    if (keySkip) {
      if (keySkip.nextKey) cursor.continue(keySkip.nextKey);
      else cursor.continue();
      cursor = await idbReqToPromise(cursor.request);
      continue;
    }
    const primaryKeySkip = trySkipKey(cursor.primaryKey, primaryKeyRanges, reverse);
    if (primaryKeySkip) {
      if (primaryKeySkip.nextKey) cursor.continuePrimaryKey(cursor.key, primaryKeySkip.nextKey);
      else cursor.continue();
      cursor = await idbReqToPromise(cursor.request);
      continue;
    }
    break;
  }
  return cursor;
}

function trySkipKey(
  key: IDBValidKey,
  ranges: ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): SkipResult | undefined {
  if (Array.isArray(key)) {
    for (let keyIdx = 0; keyIdx < key.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (!range) continue;
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, key[keyIdx]!, reverse);
      if (order == -2) {
        const nextKey = key.slice(0, keyIdx);
        nextKey.push(logicalRange.start!);
        if (keyIdx < key.length - 1) nextKey.push(reverse ? getMaxKey() : minKey);
        return { nextKey };
      }
      if (order == -1) {
        return { nextKey: undefined };
      }
      if (order > 0) {
        const nextKey = key.slice(0, keyIdx);
        nextKey.push(reverse ? minKey : getMaxKey());
        return { nextKey };
      }
    }
  } else {
    const range = ranges[0];
    if (range) {
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, key, reverse);
      if (order == -2) return { nextKey: logicalRange.start };
      if (order == -1) return { nextKey: undefined };
      else if (order > 0) return { nextKey: reverse ? minKey : getMaxKey() };
    }
  }
}

interface SkipResult {
  nextKey: IDBValidKey | undefined;
}

const toLogicalRange = (range: IDBKeyRange, reverse: boolean): LogicalKeyRange => ({
  start: reverse ? range.upper : range.lower,
  startOpen: reverse ? range.upperOpen : range.lowerOpen,
  end: reverse ? range.lower : range.upper,
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
 * - -1: key is at the start of the range (if open)
 * -  0: key is within the range
 * -  1: key is at the end of the range (if open)
 * -  2: key is after the range
 */
function logicalRangeCmp(range: LogicalKeyRange, key: IDBValidKey, reverse: boolean) {
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
