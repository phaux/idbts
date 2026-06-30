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
export type FieldValue<Value, Path extends string> =
  Value extends NonNullable<unknown>
    ? Path extends `${infer Prop}.${infer Rest}`
      ? Prop extends keyof Value
        ? FieldValue<Value[Prop], Rest>
        : never
      : Path extends keyof Value
        ? Extract<Value[Path], IDBValidKey>
        : never
    : never;

/**
 * Extracts the runtime value at a given dot-separated key path from an object.
 *
 * If `keyPath` is a string, the corresponding field value is returned directly.
 * If `keyPath` is an array of strings (composite key path), an array of field
 * values is returned in the same order.
 */
export function getKeyPathValue(obj: unknown, keyPath: AnyKeyPath): unknown {
  if (typeof keyPath === "string") return getFieldValue(obj, keyPath);
  return keyPath.map((kp) => getFieldValue(obj, kp));
}

/**
 * Traverses an object by a dot-separated field path and returns the value at that path.
 * Returns `undefined` if any segment of the path is missing
 * or if an intermediate value is not an object.
 */
export function getFieldValue(obj: unknown, field: string): unknown {
  const parts = field.split(".");
  let current = obj;
  for (const part of parts) {
    if (typeof current != "object" || current == null) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    current = (current as any)[part];
  }
  return current;
}

/**
 * A single dot-separated key path string,
 * or an array of such strings representing a composite (multi-field) key.
 *
 * Mirrors the `keyPath` option accepted by {@link IDBObjectStore.createIndex}
 * and related IndexedDB APIs.
 */
export type AnyKeyPath = string | readonly string[];
