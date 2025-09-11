/**
 * An alias for the global {@link IDBKeyRange} with a more strict type.
 */
export const TIDBKeyRange: TIDBKeyRangeCtor = IDBKeyRange;

export interface TIDBKeyRangeCtor {
  prototype: TIDBKeyRange<any>;

  /**
   * Returns a new IDBKeyRange spanning from lower to upper. If lowerOpen is true, lower is not included in the range. If upperOpen is true, upper is not included in the range.
   */
  bound<T extends IDBValidKey>(
    lower: TIDBKeyBound<T>,
    upper: TIDBKeyBound<T>,
    lowerOpen?: boolean,
    upperOpen?: boolean,
  ): TIDBKeyRange<T>;

  /**
   * Returns a new IDBKeyRange starting at key with no upper bound. If open is true, key is not included in the range.
   */
  lowerBound<T extends IDBValidKey>(lower: TIDBKeyBound<T>, open?: boolean): TIDBKeyRange<T>;

  /**
   * Returns a new IDBKeyRange with no lower bound and ending at key. If open is true, key is not included in the range.
   */
  upperBound<T extends IDBValidKey>(upper: TIDBKeyBound<T>, open?: boolean): TIDBKeyRange<T>;

  /**
   * Returns a new IDBKeyRange spanning only key.
   */
  only<T extends IDBValidKey>(value: T): TIDBKeyRange<T>;
}

/**
 * A range of keys.
 * Used to query object stores.
 */
export interface TIDBKeyRange<out T extends IDBValidKey> extends IDBKeyRange {
  readonly lower: TIDBKeyBound<T>;
  readonly upper: TIDBKeyBound<T>;
}

/**
 * Either a single {@link IDBValidKey} or a {@link TIDBKeyRange}.
 */
export type MaybeTIDBKeyRange<T extends IDBValidKey> = T | TIDBKeyRange<T>;

/**
 * An upper or lower range bound of a {@link TIDBKeyRange}.
 *
 * It allows value of the specified type or {@link minKey} or {@link maxKey}.
 *
 * If the key is a compound key, it allows omitting elements from the end.
 * It allows you to query keys that are prefixes of the specified key.
 *
 * @example
 * ```ts
 * const r: TIDBKeyRange<[string, number]> = TIDBKeyRange.bound(["a"], ["a", maxKey])
 * ```
 */
export type TIDBKeyBound<T> = T extends readonly unknown[]
  ? PartialTuple<{ [I in keyof T]: TIDBKeyValue<T[I]> }>
  : TIDBKeyValue<T>;

/**
 * A key of the specified type or {@link minKey} or {@link maxKey}.
 */
export type TIDBKeyValue<T> = T | typeof minKey | typeof maxKey;

/**
 * Modifies a tuple type so it allows omitting elements from the end.
 *
 * @example
 * ```ts
 * type A = PartialTuple<[string, number, boolean]>
 * // [] | [string] | [string, number] | [string, number, boolean]
 * ```
 */
export type PartialTuple<T extends readonly unknown[]> = T extends readonly [infer First, ...infer Rest]
  ? readonly [First] | readonly [First, ...PartialTuple<Rest>]
  : [];

/** Smallest possible key */
export const minKey: unique symbol = -Infinity as any;

/** Largest possible key */
export const maxKey = [[]] as const;
