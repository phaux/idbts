/**
 * A type that can be either a single value or an array of values.
 */
export type MaybeArray<T> = T | readonly T[];

/**
 * Wraps the type in an array if not already an array.
 */
export type ToArray<T> = T extends readonly unknown[] ? T : readonly [T];

/**
 * Returns the element type of the array. If there is only one element, makes it optional.
 */
export type ElementsUnlessSingle<T extends readonly unknown[]> = T extends readonly [infer Only]
  ? Only | undefined
  : T[number];

/**
 * Returns the first non-nullable type.
 */
export type Or<T, U> = T extends NonNullable<unknown> ? T : U;

/**
 * Create a tuple with element of the given type which is optional if the type is nullable.
 */
export type OptionalArg<T> = [T] extends [never] ? [undefined?] : undefined extends T ? [T?] : [T];
