# idbts-react

React bindings for [idbts](../idbts/README.md) — a strongly-typed IndexedDB wrapper.

Provides a single hook, `useDBQuery`, that runs a live IndexedDB query
and keeps your component in sync with the database automatically.

## Installation

```sh
npm install idbts idbts-react
```

Requires **React 19+** (uses `React.use` for Suspense integration).

## `useDBQuery()`

```ts
const results: Value[] = useDBQuery(db, storeName, options);
```

Runs a live query against an IndexedDB store and returns the current result array.
The component **re-renders automatically** whenever the store changes.

| Parameter   | Description                                           |
| ----------- | ----------------------------------------------------- |
| `db`        | The `Database` instance returned by `openDB`.         |
| `storeName` | Name of the object store to query.                    |
| `options`   | Query options — identical to `liveQuery` from `idbts` |

### Basic usage

```tsx
import { useDBQuery } from "idbts-react";
import { db } from "./db";

export function UserList() {
  const users = useDBQuery(db, "users", {
    orderBy: "name",
  });

  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}

export function UserPage(props: { id: number }) {
  const user = useDBQuery(db, "users", {
    where: { id: props.id },
  }).at(0);

  if (!user) throw new Error("User not found");

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
    </div>
  );
}
```

## Suspense

This hook uses React's `use()` API internally.
The component **suspends** until the initial query resolves.

Wrapping your component in a `<Suspense>` boundary is usually not needed
because the initial results are almost instant.

Errors from the query (e.g. a missing index) are thrown as normal exceptions
and can be caught with an **error boundary**.

## Deduplication

Multiple components calling `useDBQuery` with the same arguments
share **one** underlying subscription.
The shared subscription is kept alive for few seconds after the last subscriber unmounts,
so quick unmount/remount cycles (React StrictMode, route transitions)
do not open redundant change listeners.
