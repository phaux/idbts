/**
 * An alias for the global {@link IDBKeyRange} with a more strict type.
 */
export const KeyRange: KeyRangeCtor = IDBKeyRange;

export interface KeyRangeCtor {
  prototype: KeyRange<any>;

  /**
   * Returns a new IDBKeyRange spanning from `lowerKey` to `upperKey`.
   *
   * If `lowerExclusive` is true, `lowerKey` is not included in the range.
   * If `upperExclusive` is true, `upperKey` is not included in the range.
   */
  bound<const T extends ValidKey>(
    lowerKey: T,
    upperKey: T,
    lowerExclusive?: boolean,
    upperExclusive?: boolean,
  ): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange starting at `lowerKey` with no upper bound.
   *
   * If `exclusive` is true, `lowerKey` is not included in the range.
   */
  lowerBound<const T extends ValidKey>(lowerKey: T, exclusive?: boolean): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange with no lower bound and ending at `upperKey`.
   *
   * If `exclusive` is true, `upperKey` is not included in the range.
   */
  upperBound<const T extends ValidKey>(upperKey: T, exclusive?: boolean): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange spanning only `key`.
   */
  only<const T extends ValidKey>(key: T): KeyRange<T>;
}

/**
 * Any valid key. Similar to {@link IDBValidKey}.
 */
export type ValidKey = string | number | Date | BufferSource | readonly ValidKey[];

/**
 * A range of keys.
 * Used to query object stores.
 */
export interface KeyRange<out T extends ValidKey> extends IDBKeyRange {
  readonly lower: T | undefined;
  readonly upper: T | undefined;
}

/**
 * Either a single {@link ValidKey} or a {@link KeyRange}.
 */
export type MaybeKeyRange<T extends ValidKey> = T | KeyRange<T>;

/** Returns the maximum possible key value, which is greater than all other keys. */
export const getMaxKey = () => [[]] as const;

/** The minimum possible key value, which is less than all other keys. */
export const minKey = -Infinity;

/**
 * Converts a KeyRange into a KeyRange with array bounds.
 * If the range bounds are not already arrays, they are wrapped in single-element arrays.
 *
 * @example
 * // Converts scalar bounds to array bounds
 * const result = arrayifyRange(KeyRange.bound("a", "z"));
 * // Returns: KeyRange.bound(['a'], ['z'])
 */
export function arrayifyRange<T extends ValidKey>(
  range: KeyRange<T>,
): KeyRange<T extends readonly unknown[] ? T : readonly T[]> {
  if (range.lower != null && range.upper != null) {
    return KeyRange.bound(
      Array.isArray(range.lower) ? range.lower : ([range.lower] as any),
      Array.isArray(range.upper) ? range.upper : ([range.upper] as any),
      range.lowerOpen,
      range.upperOpen,
    );
  }
  if (range.lower != null) {
    return KeyRange.lowerBound(Array.isArray(range.lower) ? range.lower : ([range.lower] as any), range.lowerOpen);
  }
  if (range.upper != null) {
    return KeyRange.upperBound(Array.isArray(range.upper) ? range.upper : ([range.upper] as any), range.upperOpen);
  }
  throw new Error("Invalid range");
}

/**
 * Returns true if the given range represents a single value
 * (i.e. lower and upper bounds are equal and not open).
 */
export function isSingleValueRange(range: IDBKeyRange) {
  return (
    range.lower != null &&
    range.upper != null &&
    indexedDB.cmp(range.lower, range.upper) === 0 &&
    !range.lowerOpen &&
    !range.upperOpen
  );
}
