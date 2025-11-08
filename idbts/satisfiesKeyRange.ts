import type { KeyRange, ValidKey } from "./KeyRange.ts";

/**
 * Checks if a key satisfies a key range.
 */
export function satisfiesKeyRange(key: ValidKey, range: KeyRange<ValidKey> | undefined) {
  if (!range) return true;
  if (range.lower) {
    if (range.lowerOpen) {
      if (indexedDB.cmp(key, range.lower) <= 0) return false;
    } else {
      if (indexedDB.cmp(key, range.lower) < 0) return false;
    }
  }
  if (range.upper) {
    if (range.upperOpen) {
      if (indexedDB.cmp(key, range.upper) >= 0) return false;
    } else {
      if (indexedDB.cmp(key, range.upper) > 0) return false;
    }
  }
  return true;
}
