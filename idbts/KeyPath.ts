/**
 * Given an object type and dot-separated path strings, returns the types of the values at those paths.
 *
 * Will only return types that are valid {@link IDBValidKey}s.
 *
 * @example
 * ```ts
 * type A = KeyPathValue<{ a: { b: number } }, ["a.b"]> // number
 * ```
 */
export type KeyPathValue<
  Value,
  Paths extends AnyKeyPath | null | undefined,
> = Paths extends infer P extends readonly string[]
  ? {
      [I in keyof P]: Extract<FieldValue<Value, P[I]>, IDBValidKey>;
    }
  : Paths extends string
    ? Extract<FieldValue<Value, Paths>, IDBValidKey>
    : never;

/**
 * Given an object type and a dot-separated path string, returns the type of the value at that path.
 *
 * @example
 * ```ts
 * type A = FieldValue<{ a: { b: number } }, "a.b"> // number
 * ```
 */
export type FieldValue<Value, Path extends string> = Value extends {}
  ? Path extends `${infer Prop}.${infer Rest}`
    ? Prop extends keyof Value
      ? FieldValue<Value[Prop], Rest>
      : never
    : Path extends ""
      ? Value
      : Path extends keyof Value
        ? Value[Path]
        : never
  : never;

export function getKeyPathValue(obj: unknown, keyPath: AnyKeyPath): unknown {
  if (typeof keyPath === "string") return getFieldValue(obj, keyPath);
  return keyPath.map((kp) => getFieldValue(obj, kp));
}

export function getFieldValue(obj: unknown, field: string): unknown {
  const parts = field.split(".");
  let current = obj;
  for (const part of parts) {
    if (typeof current != "object" || current == null) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as any)[part];
  }
  return current;
}

export type AnyKeyPath = string | readonly string[];
