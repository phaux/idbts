import type { DBCursor } from "./DBCursor.ts";
import { type ValidKey, getMaxKey, KeyRange, minKey } from "./KeyRange.ts";

export async function advanceCursorByRanges<T>(
  cursor: DBCursor<T, ValidKey, ValidKey> | null,
  keyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  primaryKeyRange: KeyRange<ValidKey> | undefined,
  reverse: boolean,
): Promise<DBCursor<T, ValidKey, ValidKey> | null> {
  skips: while (cursor) {
    // Move cursor according to postfix ranges.
    if (Array.isArray(cursor.key)) {
      for (let keyIdx = 0; keyIdx < keyRanges.length; keyIdx++) {
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
            cursor = await cursor.continue(indexedDB.cmp(nextKey, cursor.key) != 0 ? nextKey : undefined);
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
            cursor = await cursor.continue(nextKey);
            continue skips;
          }
        }
      }
    }

    // Move cursor according to primary key range.
    if (primaryKeyRange) {
      // Move cursor to the start of the range if it's before it.
      const start = reverse ? primaryKeyRange.upper : primaryKeyRange.lower;
      if (start != null) {
        let order = indexedDB.cmp(cursor.primaryKey, start);
        if (reverse) order = -order;
        const open = reverse ? primaryKeyRange.upperOpen : primaryKeyRange.lowerOpen;
        if (open) order--;
        if (order < 0) {
          cursor = await cursor.continuePrimaryKey(cursor.key, start);
          continue skips;
        }
      }

      // Move cursor to the next item if it's after the end of the range.
      const end = reverse ? primaryKeyRange.lower : primaryKeyRange.upper;
      if (end != null) {
        let order = indexedDB.cmp(cursor.primaryKey, end);
        if (reverse) order = -order;
        const open = reverse ? primaryKeyRange.lowerOpen : primaryKeyRange.upperOpen;
        if (open) order++;
        if (order > 0) {
          cursor = await cursor.continuePrimaryKey(cursor.key, reverse ? minKey : getMaxKey());
          continue skips;
        }
      }
    }

    break skips;
  }

  return cursor;
}
