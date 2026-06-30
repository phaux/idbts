import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, minKey, type KeyRangeObject } from "./KeyRange.ts";

/**
 * Advances an IDB cursor until it lands on a record
 * that satisfies a primary key range, or until there are no more records.
 *
 * When the primary key is out of range the function advances the cursor to the next key
 * which skips over as many non-matching records as possible in a single jump.
 *
 * Returns the cursor moved to the next valid record,
 * or `null` if no such record exists.
 */
export async function continuePrimaryKeyRange(
  cursor: IDBCursorWithValue | null,
  pKeyRange: KeyRangeObject<IDBValidKey>,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    // Normalize range bounds based on the cursor's direction.
    const start = reverse ? pKeyRange.upper : pKeyRange.lower,
      startOpen = (reverse ? pKeyRange.upperOpen : pKeyRange.lowerOpen) ?? false,
      end = reverse ? pKeyRange.lower : pKeyRange.upper,
      endOpen = (reverse ? pKeyRange.lowerOpen : pKeyRange.upperOpen) ?? false;

    // Check relative to the start of the range.
    if (start != null) {
      let order = indexedDB.cmp(cursor.primaryKey, start);
      if (reverse) order = -order;

      if (order < 0) {
        // Key is before the range.
        // Next key is the start of the range.
        cursor.continuePrimaryKey(cursor.key, start);
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }

      if (startOpen && order === 0) {
        // Key is at the starting boundary of the range.
        // The cursor should simply advance one step.
        cursor.continue();
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }

    // Check relative to the end of the range.
    if (end != null) {
      let order = indexedDB.cmp(cursor.primaryKey, end);
      if (reverse) order = -order;
      if (endOpen) order += 1;
      if (order > 0) {
        // Key is after the range. The next key is max value.
        // This causes the iteration to continue to the next non-primary key.
        cursor.continuePrimaryKey(cursor.key, reverse ? minKey : getMaxKey());
        cursor = await idbReqToPromise(cursor.request);
        continue;
      }
    }

    break;
  }
  return cursor;
}
