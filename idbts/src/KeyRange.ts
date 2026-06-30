/**
 * A plain-object representation of an {@link IDBKeyRange},
 * describing optional lower and upper bounds together with
 * whether each bound is open (exclusive) or closed (inclusive).
 *
 * This type is accepted anywhere a key range is needed
 * so callers can avoid constructing a native `IDBKeyRange` manually.
 */
export interface KeyRangeObject<out T extends IDBValidKey | undefined> {
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
 * Converts a plain object representing a range into a native {@link IDBKeyRange}.
 *
 * Returns `undefined` when the input range is undefined or unbounded.
 */
export function toIDBKeyRange(
  range: KeyRangeObject<IDBValidKey> | undefined,
): IDBKeyRange | undefined {
  if (range?.lower != null && range.upper != null) {
    return IDBKeyRange.bound(range.lower, range.upper, range.lowerOpen, range.upperOpen);
  } else if (range?.lower != null) {
    return IDBKeyRange.lowerBound(range.lower, range.lowerOpen);
  } else if (range?.upper != null) {
    return IDBKeyRange.upperBound(range.upper, range.upperOpen);
  }
  return undefined;
}

/**
 * Given a prefix key value and a postfix key range,
 * returns a range over a composite key where:
 * - the first component matches the given prefix value,
 * - and the second component is within the given postfix range.
 *
 * For example, given prefix value `"foo"` and a postfix range from `1` to `10`,
 * the result is a range from `["foo", 1]` to `["foo", 10]`
 *
 * Undefined postfix range means the second component is not constrained.
 */
export function prefixRange(
  prefix: IDBValidKey,
  postfixRange: KeyRangeObject<IDBValidKey> | undefined,
): IDBKeyRange {
  return IDBKeyRange.bound(
    [prefix, ...(postfixRange?.lower != null ? [postfixRange.lower] : [])],
    [prefix, postfixRange?.upper ?? getMaxKey()],
    postfixRange?.lowerOpen,
    postfixRange?.upperOpen,
  );
}

/** Returns the maximum possible key value, which is greater than all other keys. */
export const getMaxKey = (): [[]] => [[]]; // Not actually the largest possible but close enough.

/** The minimum possible key value, which is less than all other keys. */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- needed for isolatedDeclarations
export const minKey: number = -Infinity;
