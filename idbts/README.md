# idbts

A strongly-typed IndexedDB wrapper with a rich query API and live updating results.

- **Type-safe** — stores, keys and values are all fully inferred.
- **Schema validation** — integrates with StandardSchema-compatible libraries for validation.
- **Automatic migrations** — bump the version number to automatically create stores and indexes.
- **Expressive queries** — filter and sort by any indexed field.
- **Smart query planner** — automatically use the most efficient index based on given query parameters.
- **Live updates** — subscribe to a query and receive fresh results whenever the store changes.
- **Familiar API** — reuse names and concepts from the underlying IndexedDB API.

## Installation

```sh
npm i idbts
```

## Quick start

Initialize the database:

```ts
import { openDB, schema } from "idbts";

type PersonEntry = {
  id: string;
  name: { first: string; last: string };
  age: number;
};

const db = await openDB("my-db", 1, {
  people: {
    value: schema<PersonEntry>(),
    keyPath: "id",
    indexes: {
      byFirstName: { keyPath: "name.first" },
      byLastName: { keyPath: "name.last" },
      byAge: { keyPath: "age" },
    },
  },
});
```

Mutate the database:

```ts
await db.insert("people", {
  id: someId,
  name: { first: "Jan", last: "Kowalski" },
  age: 31,
});

await db.update("people", someId, (person) => {
  if (person) {
    return {
      ...person,
      age: person.age + 1,
    };
  }
});

await db.delete("people", someId);
```

Query the database:

```ts
import { queryDB } from "idbts";

const people = await queryDB(db, "people", {
  where: {
    "name.first": "Jan",
    "name.last": "Kowalski",
    age: IDBKeyRange.lowerBound(18),
  },
  orderBy: "age",
});
```

Subscribe to live updates:

```ts
import { liveQueryDB } from "idbts";

const ac = new AbortController();

const livePeople = liveQueryDB(db, "people", { orderBy: "age" });
livePeople.subscribe(
  {
    next: (people) => console.log("Current results:", people),
    error: (err) => console.error("Query failed:", err),
  },
  { signal: ac.signal },
);

// Later, when you want to unsubscribe:
ac.abort();
```

## Type safety

Use `schema<T>()` helper to define your item types.
It creates a no-op [StandardSchema](https://standardschema.dev/)-compatible object
that carries your TypeScript type without any runtime validation overhead.

```ts
import { schema } from "idbts";

const s = schema<{ id: number; name: string }>();
```

## Runtime validation

You can substitute any [StandardSchema](https://standardschema.dev/)-compatible validator
in place of `schema<T>()` to get **runtime validation** on every mutation:

```ts
import { z } from "zod";
import { openDB } from "idbts";

const personSchema = z.object({
  id: z.string().uuid(),
  name: z.object({
    first: z.string().min(1),
    last: z.string().min(1),
  }),
  age: z.number().int().min(0),
});

const db = await openDB("my-db", 1, {
  people: {
    value: personSchema, // replaces schema<PersonEntry>()
    keyPath: "id",
  },
});
```

Mutations that fail validation throw SchemaValidationError:

```ts
import { SchemaValidationError } from "idbts";

try {
  await db.insert("people", {
    id: "not-a-uuid",
    name: { first: "", last: "" },
    age: -1,
  });
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error("Validation failed:", err.issues);
  }
}
```

> [!WARNING]
>
> Async validators are **not** supported.
> IndexedDB doesn't support performing other async operations while a transaction is active.
> If you use an async validator, the transaction will be automatically aborted
> and an error will be thrown.

## Automatic migrations

When you bump the version number, `openDB` automatically:

- **Creates** stores and indexes that are present in the new schema but absent in the database.
- **Deletes** stores and indexes that are absent from the new schema.

You never need to write `createObjectStore` / `createIndex` calls by hand.

## Smart query planner

Query automatically selects the most efficient index strategy:

1. **Primary key** — if all filter and order fields are part of the store's compound primary key (if it has one).
2. **Single index** — if one (possibly composite) index covers all filter and order fields in the right order.
3. **Zig-zag merge join** — if multiple equality (single value) filters
   each have their own index,
   this algorithm advances cursors in lockstep across indexes
   to intersect their results efficiently.

> [!TIP]
>
> If no suitable index exists, `queryDB` throws an error with a message like:
>
> ```txt
> Missing index on name.first+age.
> ```
>
> That tells you exactly which compound index to add to your schema.

## Live updates

Live queries subscribe to a `BroadcastChannel` which receives store mutations
and applies incoming changes to the live results array.

The items which didn't change from one emit to the next
are guaranteed to be the same objects as before,
so subscribers can memoize based on object reference equality.

Because changes are broadcast via `BroadcastChannel`,
live queries also receive updates made by **other tabs** in the same browser.
