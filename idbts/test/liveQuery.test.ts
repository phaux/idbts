import { deepEqual, equal } from "node:assert/strict";
import { suite, test } from "node:test";
import { liveQuery } from "../src/liveQuery.ts";
import type { MiniObservable } from "../src/MiniObservable.ts";
import { openDB } from "../src/openDB.ts";
import { schema } from "../src/StandardSchema.ts";

await suite("liveQuery", { concurrency: true }, async () => {
  await test("buffers changes until initial query resolves", async () => {
    const db = await openDB("live-query-buffering", 1, {
      items: {
        value: schema<{ id: number }>(),
        keyPath: "id",
      },
    });
    const mutations: Promise<void>[] = [];
    const ac = new AbortController();
    mutations.push(db.insert("items", { id: 1 }));
    mutations.push(db.insert("items", { id: 2 }));
    const changes = collect(liveQuery(db, "items", {}), ac.signal);
    mutations.push(db.insert("items", { id: 3 }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    ac.abort();
    await Promise.all(mutations);
    deepEqual((await changes).at(-1), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    db.idb.close();
  });

  await test("by primary key", async (t) => {
    type Record = { n: number; s?: string };
    const db = await openDB("live-query-primary-key", 1, {
      nums: {
        value: schema<Record>(),
        keyPath: "n",
      },
    });

    await t.test("watching all keys", async (t) => {
      await t.test("insert", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.insert("nums", [{ n: 1 }, { n: 3 }, { n: 5 }]);
        await db.upsert("nums", [{ n: 2 }, { n: 4 }]);
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [
          [],
          [{ n: 1 }, { n: 3 }, { n: 5 }],
          [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
        ]);
        equal(changes[1]![0], changes[2]![0]);
        equal(changes[1]![1], changes[2]![2]);
        equal(changes[1]![2], changes[2]![4]);
      });

      await t.test("update", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
        await db.update("nums", 4, (value) => ({ n: value!.n, s: "updated" }));
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [
          [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
          [{ n: 1 }, { n: 2, s: "updated" }, { n: 3 }, { n: 4 }, { n: 5 }],
          [{ n: 1 }, { n: 2, s: "updated" }, { n: 3 }, { n: 4, s: "updated" }, { n: 5 }],
        ]);
        equal(changes[0]![0], changes[1]![0]);
        equal(changes[1]![0], changes[2]![0]);
        equal(changes[0]![2], changes[1]![2]);
        equal(changes[1]![2], changes[2]![2]);
        equal(changes[0]![4], changes[1]![4]);
        equal(changes[1]![4], changes[2]![4]);
      });

      await t.test("update many", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.update("nums", [2, 4], (value) => ({ n: value!.n, s: "updated again" }));
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [
          [{ n: 1 }, { n: 2, s: "updated" }, { n: 3 }, { n: 4, s: "updated" }, { n: 5 }],
          [
            { n: 1 },
            { n: 2, s: "updated again" },
            { n: 3 },
            { n: 4, s: "updated again" },
            { n: 5 },
          ],
        ]);
        equal(changes[0]![0], changes[1]![0]);
        equal(changes[0]![2], changes[1]![2]);
        equal(changes[0]![4], changes[1]![4]);
      });

      await t.test("delete", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.delete("nums", 2);
        await db.delete("nums", 4);
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [
          [
            { n: 1 },
            { n: 2, s: "updated again" },
            { n: 3 },
            { n: 4, s: "updated again" },
            { n: 5 },
          ],
          [{ n: 1 }, { n: 3 }, { n: 4, s: "updated again" }, { n: 5 }],
          [{ n: 1 }, { n: 3 }, { n: 5 }],
        ]);
        equal(changes[0]![0], changes[1]![0]);
        equal(changes[1]![0], changes[2]![0]);
        equal(changes[0]![2], changes[1]![1]);
        equal(changes[1]![1], changes[2]![1]);
        equal(changes[0]![4], changes[1]![3]);
        equal(changes[1]![3], changes[2]![2]);
      });

      await t.test("delete many", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.delete("nums", [1, 2, 4, 5]);
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [[{ n: 1 }, { n: 3 }, { n: 5 }], [{ n: 3 }]]);
        equal(changes[0]![1], changes[1]![0]);
      });
    });

    await t.test("watching key range", async () => {
      const ac = new AbortController();
      const changesPromise = collect(
        liveQuery(db, "nums", { where: { n: { lower: 2, upper: 4 } } }),
        ac.signal,
      );
      await db.insert("nums", { n: 2 });
      await db.insert("nums", { n: 6 });
      await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
      await db.update("nums", 6, (value) => ({ n: value!.n, s: "updated" }));
      await db.delete("nums", 2);
      await db.delete("nums", 6);
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [
        [{ n: 3 }],
        [{ n: 2 }, { n: 3 }],
        [{ n: 2, s: "updated" }, { n: 3 }],
        [{ n: 3 }],
      ]);
      equal(changes[0]![0], changes[1]![1]);
      equal(changes[1]![1], changes[2]![1]);
      equal(changes[2]![1], changes[3]![0]);
    });

    await t.test("watching undefined key", async () => {
      const ac = new AbortController();
      const changesPromise = collect(
        liveQuery(db, "nums", { where: { n: undefined as never } }),
        ac.signal,
      );

      await db.upsert("nums", { n: 0 });
      await db.delete("nums", 0);
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [[{ n: 3 }], [{ n: 0 }, { n: 3 }], [{ n: 3 }]]);
    });

    db.idb.close();
  });

  await test("by compound primary key", async (t) => {
    type Record = { x: number; y: number; s?: string };
    const db = await openDB("live-query-compound-key", 1, {
      points: {
        value: schema<Record>(),
        keyPath: ["x", "y"],
      },
    });

    await t.test("watching all keys", async (t) => {
      await t.test("insert at the end", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "points", {}), ac.signal);
        await db.insert("points", { x: 1, y: 1 });
        await db.insert("points", { x: 2, y: 2 });
        ac.abort();
        deepEqual(await changes, [
          [],
          [{ x: 1, y: 1 }],
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        ]);
      });

      await t.test("insert in between", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "points", {}), ac.signal);
        await db.insert("points", { x: 2, y: 1 });
        await db.insert("points", { x: 1, y: 2 });
        ac.abort();
        deepEqual(await changes, [
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 1, y: 2 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
          ],
        ]);
      });

      await t.test("update", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "points", {}), ac.signal);
        await db.update("points", [[1, 2]], (value) => ({
          x: value!.x,
          y: value!.y,
          s: "updated",
        }));
        await db.update("points", [[2, 1]], (value) => ({
          x: value!.x,
          y: value!.y,
          s: "updated",
        }));
        ac.abort();
        deepEqual(await changes, [
          [
            { x: 1, y: 1 },
            { x: 1, y: 2 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 1, y: 2, s: "updated" },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 1, y: 2, s: "updated" },
            { x: 2, y: 1, s: "updated" },
            { x: 2, y: 2 },
          ],
        ]);
      });

      await t.test("delete", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "points", {}), ac.signal);
        await db.delete("points", [[1, 2]]);
        await db.delete("points", [[2, 1]]);
        ac.abort();
        deepEqual(await changes, [
          [
            { x: 1, y: 1 },
            { x: 1, y: 2, s: "updated" },
            { x: 2, y: 1, s: "updated" },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 2, y: 1, s: "updated" },
            { x: 2, y: 2 },
          ],
          [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        ]);
      });
    });

    db.idb.close();
  });

  await test("by index", async (t) => {
    type Record = { id: number; name: string; age: number };
    const db = await openDB("live-query-index", 1, {
      people: {
        value: schema<Record>(),
        keyPath: "id",
        indexes: {
          byName: { keyPath: "name" },
          byAge: { keyPath: "age" },
        },
      },
    });

    await t.test("watching ordered", async (t) => {
      await t.test("insert at the end", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "people", { orderBy: "name" }), ac.signal);
        await db.insert("people", { id: 3, name: "Alice", age: 30 });
        await db.upsert("people", { id: 2, name: "Charlie", age: 25 });
        ac.abort();
        deepEqual(await changes, [
          [],
          [{ id: 3, name: "Alice", age: 30 }],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 25 },
          ],
        ]);
      });

      await t.test("insert in between", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "people", { orderBy: "name" }), ac.signal);
        await db.insert("people", { id: 1, name: "Bob", age: 35 });
        ac.abort();
        deepEqual(await changes, [
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 25 },
          ],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 1, name: "Bob", age: 35 },
            { id: 2, name: "Charlie", age: 25 },
          ],
        ]);
      });

      await t.test("update watched field", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "people", { orderBy: "name" }), ac.signal);
        await db.update("people", 1, (value) => ({ ...value!, name: "David" }));
        ac.abort();
        deepEqual(await changes, [
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 1, name: "Bob", age: 35 },
            { id: 2, name: "Charlie", age: 25 },
          ],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 25 },
            { id: 1, name: "David", age: 35 },
          ],
        ]);
      });

      await t.test("update unwatched field", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "people", { orderBy: "name" }), ac.signal);
        await db.update("people", 2, (value) => ({ ...value!, age: 20 }));
        ac.abort();
        deepEqual(await changes, [
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 25 },
            { id: 1, name: "David", age: 35 },
          ],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 20 },
            { id: 1, name: "David", age: 35 },
          ],
        ]);
      });

      await t.test("delete", async () => {
        const ac = new AbortController();
        const changes = collect(liveQuery(db, "people", { orderBy: "name" }), ac.signal);
        await db.delete("people", 1);
        ac.abort();
        deepEqual(await changes, [
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 20 },
            { id: 1, name: "David", age: 35 },
          ],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 2, name: "Charlie", age: 20 },
          ],
        ]);
      });
    });

    await t.test("watching range", async (t) => {
      await t.test("insert and delete in range", async () => {
        const ac = new AbortController();
        const changes = collect(
          liveQuery(db, "people", { where: { age: { lower: 25 } } }),
          ac.signal,
        );
        await db.insert("people", { id: 4, name: "Eve", age: 28 });
        await db.delete("people", 4);
        ac.abort();
        deepEqual(await changes, [
          [{ id: 3, name: "Alice", age: 30 }],
          [
            { id: 3, name: "Alice", age: 30 },
            { id: 4, name: "Eve", age: 28 },
          ],
          [{ id: 3, name: "Alice", age: 30 }],
        ]);
      });

      await t.test("insert and delete outside range", async () => {
        const ac = new AbortController();
        const changes = collect(
          liveQuery(db, "people", { where: { age: { lower: 25 } } }),
          ac.signal,
        );
        await db.insert("people", { id: 5, name: "Frank", age: 22 });
        await db.delete("people", 5);
        ac.abort();
        deepEqual(await changes, [[{ id: 3, name: "Alice", age: 30 }]]);
      });

      await t.test("update", async () => {
        const ac = new AbortController();
        const changes = collect(
          liveQuery(db, "people", { orderBy: "age", where: { age: { upper: 25 } } }),
          ac.signal,
        );
        await db.update("people", 3, (value) => ({ ...value!, age: 25 }));
        await db.update("people", 3, (value) => ({ ...value!, age: 15 }));
        await db.update("people", 2, (value) => ({ ...value!, age: 35 }));
        ac.abort();
        deepEqual(await changes, [
          [{ id: 2, name: "Charlie", age: 20 }],
          [
            { id: 2, name: "Charlie", age: 20 },
            { id: 3, name: "Alice", age: 25 },
          ],
          [
            { id: 3, name: "Alice", age: 15 },
            { id: 2, name: "Charlie", age: 20 },
          ],
          [{ id: 3, name: "Alice", age: 15 }],
        ]);
      });

      await t.test("watching undefined range", async () => {
        const ac = new AbortController();
        const changes = collect(
          liveQuery(db, "people", { where: { age: undefined as never } }),
          ac.signal,
        );
        await db.upsert("people", { id: 4, name: "Eve", age: 28 });
        await db.delete("people", 4);
        ac.abort();
        deepEqual(await changes, [
          [
            { id: 2, name: "Charlie", age: 35 },
            { id: 3, name: "Alice", age: 15 },
          ],
          [
            { id: 2, name: "Charlie", age: 35 },
            { id: 3, name: "Alice", age: 15 },
            { id: 4, name: "Eve", age: 28 },
          ],
          [
            { id: 2, name: "Charlie", age: 35 },
            { id: 3, name: "Alice", age: 15 },
          ],
        ]);
      });
    });

    db.idb.close();
  });
});

function collect<T>(observable: MiniObservable<T>, signal: AbortSignal): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results: T[] = [];
    const ac = new AbortController();
    observable.subscribe(
      {
        next: (value) => results.push(value),
        error: (err) => reject(err),
      },
      { signal: ac.signal },
    );
    if (signal.aborted) complete();
    else signal.addEventListener("abort", () => complete());
    function complete() {
      ac.abort();
      resolve(results);
    }
  });
}
