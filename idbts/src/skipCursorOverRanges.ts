import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, minKey } from "./KeyRange.ts";
import { logicalRangeCmp, toLogicalRange } from "./LogicalRange.ts";

export async function skipCursorOverRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  primaryKeyRanges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined> | undefined,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    if (keyRanges) {
      const keyMatch = matchKeyToRanges(cursor.key, keyRanges, reverse);
      if (!keyMatch.matches) {
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continue(keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }
    if (primaryKeyRanges) {
      const keyMatch = matchKeyToRanges(cursor.primaryKey, primaryKeyRanges, reverse);
      if (!keyMatch.matches) {
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continuePrimaryKey(cursor.key, keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }
    break;
  }
  return cursor;
}

function matchKeyToRanges(
  key: IDBValidKey,
  ranges: IDBKeyRange | ReadonlyArray<IDBKeyRange | undefined>,
  reverse: boolean,
): KeyMatchResult {
  if ((Array.isArray as (v: unknown) => v is readonly unknown[])(ranges)) {
    const compoundKey = Array.isArray(key) ? key : [key];
    for (let keyIdx = 0; keyIdx < compoundKey.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (!range) continue;
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, compoundKey[keyIdx]!, reverse);
      if (order == -2) {
        const nextKey = compoundKey.slice(0, keyIdx);
        nextKey.push(logicalRange.start!);
        if (keyIdx < compoundKey.length - 1) nextKey.push(reverse ? getMaxKey() : minKey);
        return { matches: false, nextKey };
      }
      if (order == -1) {
        return { matches: false, nextKey: undefined };
      }
      if (order > 0) {
        const nextKey = compoundKey.slice(0, keyIdx);
        nextKey.push(reverse ? minKey : getMaxKey());
        return { matches: false, nextKey };
      }
    }
  } else {
    const logicalRange = toLogicalRange(ranges, reverse);
    const order = logicalRangeCmp(logicalRange, key, reverse);
    if (order == -2) {
      return { matches: false, nextKey: logicalRange.start };
    }
    if (order == -1) {
      return { matches: false, nextKey: undefined };
    }
    if (order > 0) {
      return { matches: false, nextKey: reverse ? minKey : getMaxKey() };
    }
  }
  return { matches: true };
}

interface KeyMatchResult {
  matches: boolean;
  nextKey?: IDBValidKey | undefined;
}
