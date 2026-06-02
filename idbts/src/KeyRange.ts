export interface KeyRangeObject<T extends IDBValidKey> {
  readonly lower?: T | undefined;
  readonly upper?: T | undefined;
  readonly lowerOpen?: boolean | undefined;
  readonly upperOpen?: boolean | undefined;
}

export type MaybeKeyRange<T extends IDBValidKey> = KeyRangeObject<T> | T;

export function toKeyRange(maybeRange: MaybeKeyRange<IDBValidKey>): IDBKeyRange | undefined {
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

function toKeyRangeObject(maybeRange: MaybeKeyRange<IDBValidKey>): KeyRangeObject<IDBValidKey> {
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
export const getMaxKey = (): [[]] => [[]];

/** The minimum possible key value, which is less than all other keys. */
export const minKey: number = -Infinity;

/**
 * Returns true if the given range represents a single value
 * (i.e. lower and upper bounds are equal and not open).
 */
export function isSingleValueRange(range: IDBKeyRange | undefined): boolean {
  return (
    range != null &&
    range.lower != null &&
    range.upper != null &&
    indexedDB.cmp(range.lower, range.upper) === 0 &&
    !range.lowerOpen &&
    !range.upperOpen
  );
}
