import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, minKey } from "./KeyRange.ts";

export async function advanceCursorByRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: ReadonlyArray<IDBKeyRange | undefined>,
  primaryKeyRange: IDBKeyRange | undefined,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  skips: while (cursor) {
    // Move cursor according to postfix ranges.
    if (Array.isArray(cursor.key)) {
      for (let keyIdx = 0; keyIdx < cursor.key.length; keyIdx++) {
        const range = keyRanges[keyIdx];
        if (!range) continue;

        // Move cursor to the start of the range if it's before it.
        const start = reverse ? range.upper : range.lower;
        if (start != null) {
          let order = indexedDB.cmp(cursor.key[keyIdx], start);
          if (reverse) order = -order;
          const open = reverse ? range.upperOpen : range.lowerOpen;
          if (open) order--;
          if (order < 0) {
            const nextKey = [...cursor.key.slice(0, keyIdx), start];
            if (keyIdx < cursor.key.length - 1) nextKey.push(reverse ? getMaxKey() : minKey);
            cursor.continue(indexedDB.cmp(nextKey, cursor.key) != 0 ? nextKey : undefined);
            cursor = await idbReqToPromise(cursor.request);
            continue skips;
          }
        }

        // Move cursor to the next item if it's after the end of the range.
        const end = reverse ? range.lower : range.upper;
        if (end != null) {
          let order = indexedDB.cmp(cursor.key[keyIdx], end);
          if (reverse) order = -order;
          const open = reverse ? range.lowerOpen : range.upperOpen;
          if (open) order++;
          if (order > 0) {
            const nextKey = [...cursor.key.slice(0, keyIdx), reverse ? minKey : getMaxKey()];
            cursor.continue(nextKey);
            cursor = await idbReqToPromise(cursor.request);
            continue skips;
          }
        }
      }
    }

    // Move cursor according to primary key range.
    if (primaryKeyRange) {
      const oldKey = cursor.primaryKey;
      const nextCursor = await advanceCursorByPrimaryKeyRange(cursor, primaryKeyRange, reverse);
      if (!nextCursor || indexedDB.cmp(nextCursor.primaryKey, oldKey) !== 0) {
        cursor = nextCursor;
        continue skips;
      }
    }

    break skips;
  }

  return cursor;
}

export async function advanceCursorByPrimaryKeyRange(
  cursor: IDBCursorWithValue,
  range: IDBKeyRange,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  // Move cursor to the next item if it's after the end of the range.
  const end = reverse ? range.lower : range.upper;
  if (end != null) {
    let order = indexedDB.cmp(cursor.primaryKey, end);
    if (reverse) order = -order;
    const open = reverse ? range.lowerOpen : range.upperOpen;
    if (open) order++;
    if (order > 0) {
      cursor.continuePrimaryKey(cursor.key, reverse ? minKey : getMaxKey());
      return await idbReqToPromise(cursor.request);
    }
  }

  // Move cursor to the start of the range if it's before it.
  const start = reverse ? range.upper : range.lower;
  if (start != null) {
    let order = indexedDB.cmp(cursor.primaryKey, start);
    if (reverse) order = -order;
    const open = reverse ? range.upperOpen : range.lowerOpen;
    if (open) order--;
    if (order < 0) {
      if (indexedDB.cmp(cursor.primaryKey, start) === 0) {
        cursor.continue();
      } else {
        cursor.continuePrimaryKey(cursor.key, start);
      }
      return await idbReqToPromise(cursor.request);
    }
  }

  return cursor;
}
