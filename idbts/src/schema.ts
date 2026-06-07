import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Creates a no-op [StandardSchema](https://standardschema.dev/) compatible type-only schema
 * that doesn't do any validation but still provides full type safety.
 */
export function schema<T extends object>(): StandardSchemaV1<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "idbts",
      validate: (value) => ({ value: value as T }),
    },
  };
}
