/**
 * Given an object type and a dot-separated path string, returns the type of the value at that path.
 *
 * Will only return types that are valid {@link IDBValidKey}s.
 *
 * Example:
 *
 * ```ts
 * type T = KeyPathValue<{ a: { b: number } }, "a.b"> // number
 * ```
 */
export type KeyPathValue<Entry, Path extends string> =
  Entry extends NonNullable<unknown>
    ? Path extends `${infer Prop}.${infer Rest}`
      ? Prop extends keyof Entry
        ? KeyPathValue<Entry[Prop], Rest>
        : never
      : Path extends keyof Entry
        ? Extract<Entry[Path], IDBValidKey>
        : never
    : never;

/**
 * Traverses an object by a dot-separated key path and returns the value at that path.
 * Returns `undefined` if any segment of the path is missing
 * or if an intermediate value is not an object.
 */
export function getKeyPathValue(obj: unknown, keyPath: string): unknown {
  const fields = keyPath.split(".");
  let current = obj;
  for (const field of fields) {
    if (typeof current != "object" || current == null) return undefined;
    if (!Object.hasOwn(current, field)) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    current = (current as any)[field];
  }
  return current;
}
