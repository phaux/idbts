/**
 * A plain-object representation of an {@link IDBKeyRange},
 * describing optional lower and upper bounds together with
 * whether each bound is open (exclusive) or closed (inclusive).
 *
 * This type is accepted anywhere a key range is needed
 * so callers can avoid constructing a native `IDBKeyRange` manually.
 *
 * Using a plain object also allows it to be JSON-stringified.
 */
export interface KeyRangeObject<out T extends IDBValidKey> {
  /**
   * The lower bound of the range. Omit for an unbounded lower end.
   */
  readonly lower?: T | undefined;
  /**
   * The upper bound of the range. Omit for an unbounded upper end.
   */
  readonly upper?: T | undefined;
  /**
   * When `true`, the lower bound is excluded from the range (open/exclusive).
   * Defaults to `false` (inclusive).
   */
  readonly lowerOpen?: boolean | undefined;
  /**
   * When `true`, the upper bound is excluded from the range (open/exclusive).
   * Defaults to `false` (inclusive).
   */
  readonly upperOpen?: boolean | undefined;
}

/**
 * A flexible key range descriptor:
 * either a {@link KeyRangeObject} with explicit bounds,
 * or a single key value treated as an exact-equality range
 * (i.e. `lower === upper`, both inclusive).
 */
export type MaybeKeyRange<T extends IDBValidKey> = KeyRangeObject<T> | T;

/**
 * Converts a {@link MaybeKeyRange} value into a native {@link IDBKeyRange},
 * or returns `undefined` when the input is `undefined`
 * (representing an unbounded range / no filter).
 */
export function toKeyRange(
  maybeRange: MaybeKeyRange<IDBValidKey> | undefined,
): IDBKeyRange | undefined {
  const range = toKeyRangeObject(maybeRange);
  if (range.lower != null && range.upper != null) {
    return IDBKeyRange.bound(range.lower, range.upper, range.lowerOpen, range.upperOpen);
  }
  if (range.lower != null) {
    return IDBKeyRange.lowerBound(range.lower, range.lowerOpen);
  }
  if (range.upper != null) {
    return IDBKeyRange.upperBound(range.upper, range.upperOpen);
  }
  return undefined;
}

/**
 * Normalises a {@link MaybeKeyRange} into a {@link KeyRangeObject}.
 *
 * Primitive keys, arrays, `Date`s, `ArrayBuffer`s, and typed-array views
 * are treated as exact-equality ranges by setting both `lower` and `upper` to the same value.
 * Plain objects that are already {@link KeyRangeObject}s are returned as-is.
 */
function toKeyRangeObject(
  maybeRange: MaybeKeyRange<IDBValidKey> | undefined,
): KeyRangeObject<IDBValidKey> {
  if (
    typeof maybeRange != "object" ||
    Array.isArray(maybeRange) ||
    maybeRange instanceof Date ||
    ArrayBuffer.isView(maybeRange) ||
    maybeRange instanceof ArrayBuffer
  ) {
    return { lower: maybeRange, upper: maybeRange };
  } else {
    return maybeRange;
  }
}

/** Returns the maximum possible key value, which is greater than all other keys. */
export const getMaxKey = (): [[]] => [[]]; // Not actually the largest possible but close enough.

/** The minimum possible key value, which is less than all other keys. */
export const minKey: number = -Infinity;

/**
 * Returns true if the given range represents a single value
 * (i.e. lower and upper bounds are equal and not open/exclusive).
 */
export function isSingleValueRange(range: KeyRangeObject<IDBValidKey> | undefined): boolean {
  return (
    range != null &&
    range.lower != null &&
    range.upper != null &&
    indexedDB.cmp(range.lower, range.upper) === 0 &&
    !range.lowerOpen &&
    !range.upperOpen
  );
}
