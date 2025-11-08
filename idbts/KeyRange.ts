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
  bound<T extends ValidKey>(lowerKey: T, upperKey: T, lowerExclusive?: boolean, upperExclusive?: boolean): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange starting at `lowerKey` with no upper bound.
   *
   * If `exclusive` is true, `lowerKey` is not included in the range.
   */
  lowerBound<T extends ValidKey>(lowerKey: T, exclusive?: boolean): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange with no lower bound and ending at `upperKey`.
   *
   * If `exclusive` is true, `upperKey` is not included in the range.
   */
  upperBound<T extends ValidKey>(upperKey: T, exclusive?: boolean): KeyRange<T>;

  /**
   * Returns a new IDBKeyRange spanning only `key`.
   */
  only<T extends ValidKey>(key: T): KeyRange<T>;
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
  readonly lower: T;
  readonly upper: T;
}

/**
 * Either a single {@link ValidKey} or a {@link KeyRange}.
 */
export type MaybeKeyRange<T extends ValidKey> = T | KeyRange<T>;
