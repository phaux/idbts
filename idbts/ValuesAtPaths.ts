/**
 * Given an object type and dot-separated path strings, returns the types of the values at those paths.
 *
 * Will only return types that are valid {@link IDBValidKey}s.
 *
 * @example
 * ```ts
 * type A = ValuesAtPaths<{ a: { b: number } }, ["a.b"]> // number
 * ```
 */
export type ValuesAtPaths<
  Value,
  Paths extends AnyKeyPath | null | undefined,
> = Paths extends infer P extends readonly string[]
  ? {
      [I in keyof P]: Extract<ValueAtPath<Value, P[I]>, IDBValidKey>;
    }
  : Paths extends string
    ? Extract<ValueAtPath<Value, Paths>, IDBValidKey>
    : never;

/**
 * Given an object type and a dot-separated path string, returns the type of the value at that path.
 *
 * @example
 * ```ts
 * type A = ValueAtPath<{ a: { b: number } }, "a.b"> // number
 * ```
 */
export type ValueAtPath<Value, Path extends string> = Value extends {}
  ? Path extends `${infer Prop}.${infer Rest}`
    ? Prop extends keyof Value
      ? ValueAtPath<Value[Prop], Rest>
      : never
    : Path extends ""
      ? Value
      : Path extends keyof Value
        ? Value[Path]
        : never
  : never;

export type AnyKeyPath = string | readonly string[];
