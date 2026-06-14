import { idbReqToPromise } from "./idbReqToPromise.ts";
import { getMaxKey, minKey } from "./KeyRange.ts";
import { logicalRangeCmp, toLogicalRange } from "./LogicalRange.ts";

/**
 * Advances an IDB cursor until it lands on a record that satisfies both
 * `keyRanges` and `primaryKeyRanges`, or until there are no more records.
 *
 * The cursor is moved as efficiently as possible:
 * when a key is out of range the function advances the cursor to the next key
 * which skips over as many non-matching records as possible in a single jump.
 * (TODO: could be optimized further)
 *
 * Pass a single `IDBKeyRange` for a simple key,
 * or an array of per-component ranges for compound/composite keys.
 * Undefined values are treated as a wildcard range that matches any value.
 *
 * Returns the cursor moved to satisfy all constraints,
 * or `null` if no such record exists.
 */
export async function skipCursorOverRanges(
  cursor: IDBCursorWithValue | null,
  keyRanges: IDBKeyRange | readonly (IDBKeyRange | undefined)[] | undefined,
  primaryKeyRanges: IDBKeyRange | readonly (IDBKeyRange | undefined)[] | undefined,
  reverse: boolean,
): Promise<IDBCursorWithValue | null> {
  while (cursor) {
    if (keyRanges) {
      // Test if the main key satisfies the key ranges.
      const keyMatch = matchKeyToRanges(cursor.key, keyRanges, reverse);
      if (!keyMatch.matches) {
        // Continue to the computed next key if available.
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continue(keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request as IDBRequest<IDBCursorWithValue | null>);
        continue;
      }
    }
    if (primaryKeyRanges) {
      // Test if the primary key satisfies the primary key ranges.
      const keyMatch = matchKeyToRanges(cursor.primaryKey, primaryKeyRanges, reverse);
      if (!keyMatch.matches) {
        // Continue to the computed next primary key if available.
        if (keyMatch.nextKey == null) cursor.continue();
        else cursor.continuePrimaryKey(cursor.key, keyMatch.nextKey);
        cursor = await idbReqToPromise(cursor.request as IDBRequest<IDBCursorWithValue | null>);
        continue;
      }
    }
    break;
  }
  return cursor;
}

/**
 * Tests whether `key` falls within the given range(s)
 * and, if not, computes the nearest key the cursor should jump to
 * in order to skip non-matching records as efficiently as possible.
 *
 * When `ranges` is an array the key is treated as a composite (array) key
 * and each component is checked against the corresponding range entry.
 * Undefined values are treated as a wildcard range that matches any value.
 *
 * Returns whether the key matches the ranges and, if not, the next key to jump to.
 */
function matchKeyToRanges(
  key: IDBValidKey,
  ranges: IDBKeyRange | readonly (IDBKeyRange | undefined)[],
  reverse: boolean,
): KeyMatchResult {
  if ((Array.isArray as (v: unknown) => v is readonly unknown[])(ranges)) {
    // When range array was provided, treat the key as a composite key
    // and compare each component against the corresponding range entry.
    const compositeKey = Array.isArray(key) ? key : [key];
    for (let keyIdx = 0; keyIdx < compositeKey.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (!range) continue;
      const logicalRange = toLogicalRange(range, reverse);
      const order = logicalRangeCmp(logicalRange, compositeKey[keyIdx]!, reverse);
      if (order === -2) {
        // Key component is before the range. The next key is:
        // - current cursor value for initial components (if any);
        // - range start for current component;
        // - min value for remaining components (if any).
        // This results in key value like `[...current, start, ...min]`.
        const nextKey = compositeKey.slice(0, keyIdx);
        nextKey.push(logicalRange.start!);
        for (let i = keyIdx + 1; i < compositeKey.length; i++) {
          nextKey.push(reverse ? getMaxKey() : minKey);
        }
        return { matches: false, nextKey };
      }
      if (order === -1) {
        // Key component is at the starting boundary, just before the range.
        // Next key is `undefined` to indicate the cursor should simply advance one step.
        return { matches: false, nextKey: undefined };
      }
      if (order > 0) {
        // Key component is after the range. The next key is:
        // - current cursor value for initial components (if any);
        // - max value for current and following components.
        // This results in key value like `[...current, ...max]`.
        const nextKey = compositeKey.slice(0, keyIdx);
        for (let i = keyIdx; i < compositeKey.length; i++) {
          nextKey.push(reverse ? minKey : getMaxKey());
        }
        return { matches: false, nextKey };
      }
    }
  } else {
    // When a single key range was provided,
    // treat the key as a simple (non-composite) key.
    const logicalRange = toLogicalRange(ranges, reverse);
    const order = logicalRangeCmp(logicalRange, key, reverse);
    if (order === -2) {
      // Key is before the range. Next key is the start of the range.
      return { matches: false, nextKey: logicalRange.start };
    }
    if (order === -1) {
      // Key is at the starting boundary of the range.
      // Next key is `undefined` to indicate the cursor should simply advance one step.
      return { matches: false, nextKey: undefined };
    }
    if (order > 0) {
      // Key is after the range. The next key is max value.
      // This usually causes the iteration to end
      // unless the key is the primary key of an index
      // which is used in addition to the main index key.
      return { matches: false, nextKey: reverse ? minKey : getMaxKey() };
    }
  }
  return { matches: true };
}

/**
 * Result of matching a cursor key against key ranges.
 */
interface KeyMatchResult {
  /** Whether the key satisfies the provided ranges. */
  matches: boolean;
  /**
   * When `matches` is `false`, the next key the cursor should jump to.
   * `undefined` means the cursor should simply advance one step.
   * (e.g. when the key sits exactly on an open boundary
   * and must be skipped without a specific target key).
   */
  nextKey?: IDBValidKey | undefined;
}
