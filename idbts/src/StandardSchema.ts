/**
 * Creates a noop [StandardSchema](https://standardschema.dev/), which doesn't validate anything.
 */
export function schema<T>(): StandardSchema<T> {
  return { "~standard": {} };
}

/**
 * A [StandardSchema](https://standardschema.dev/) compatible schema.
 */
export interface StandardSchema<T = unknown> {
  readonly "~standard": {
    readonly types?: { readonly output: T } | undefined;
  };
}

/**
 * The output type of a [StandardSchema](https://standardschema.dev/).
 */
export type SchemaValue<Schema extends StandardSchema | undefined> = Schema extends object
  ? NonNullable<Schema["~standard"]["types"]>["output"]
  : never;
