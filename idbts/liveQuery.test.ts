import "fake-indexeddb/auto";
import "observable-polyfill";

import { deepEqual, equal } from "node:assert/strict";
import { suite, test } from "node:test";
import { KeyRange, openDB, primaryKey, schema } from "./index.ts";
import { liveQuery } from "./liveQuery.ts";
import type { MiniObservable } from "./MiniObservable.ts";

suite("liveQuery", { concurrency: true }, async () => {
  test("buffers changes until initial query resolves", async (t) => {
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
    await delay(250);
    ac.abort();
    await Promise.all(mutations);
    deepEqual((await changes).at(-1), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    db.idb.close();
  });

  test("by primary key", async (t) => {
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
        await db.insert("nums", [{ n: 2 }, { n: 4 }]);
        await delay();
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [[], [{ n: 1 }, { n: 3 }, { n: 5 }], [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]]);
        equal(changes[1]![0], changes[2]![0]);
        equal(changes[1]![1], changes[2]![2]);
        equal(changes[1]![2], changes[2]![4]);
      });

      await t.test("update", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
        await db.update("nums", 4, (value) => ({ n: value!.n, s: "updated" }));
        await delay();
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

      await t.test("delete", async () => {
        const ac = new AbortController();
        const changesPromise = collect(liveQuery(db, "nums", {}), ac.signal);
        await db.delete("nums", 2);
        await db.delete("nums", 4);
        await delay();
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [
          [{ n: 1 }, { n: 2, s: "updated" }, { n: 3 }, { n: 4, s: "updated" }, { n: 5 }],
          [{ n: 1 }, { n: 3 }, { n: 4, s: "updated" }, { n: 5 }],
          [{ n: 1 }, { n: 3 }, { n: 5 }],
        ]);
        equal(changes[0]![0], changes[1]![0]);
        equal(changes[1]![0], changes[2]![0]);
        equal(changes[0]![2], changes[1]![1]);
        equal(changes[1]![1], changes[2]![1]);
        equal(changes[0]![4], changes[1]![3]);
        equal(changes[1]![3], changes[2]![2]);
      });
    });

    await t.test("watching key range", async () => {
      const ac = new AbortController();
      const changesPromise = collect(
        liveQuery(db, "nums", { where: { [primaryKey]: KeyRange.bound(2, 4) } }),
        ac.signal,
      );
      await db.insert("nums", { n: 2 });
      await db.insert("nums", { n: 6 });
      await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
      await db.update("nums", 6, (value) => ({ n: value!.n, s: "updated" }));
      await db.delete("nums", 2);
      await db.delete("nums", 6);
      await delay();
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [[{ n: 3 }], [{ n: 2 }, { n: 3 }], [{ n: 2, s: "updated" }, { n: 3 }], [{ n: 3 }]]);
      equal(changes[0]![0], changes[1]![1]);
      equal(changes[1]![1], changes[2]![1]);
      equal(changes[2]![1], changes[3]![0]);
    });

    db.idb.close();
  });

  test("by compound primary key", async (t) => {
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
        await delay();
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
        await delay();
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
        await db.update("points", [1, 2], (value) => ({ x: value!.x, y: value!.y, s: "updated" }));
        await db.update("points", [2, 1], (value) => ({ x: value!.x, y: value!.y, s: "updated" }));
        await delay();
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
        await db.delete("points", [1, 2]);
        await db.delete("points", [2, 1]);
        await delay();
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

  test("by index", async (t) => {
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
        await db.insert("people", { id: 2, name: "Charlie", age: 25 });
        await delay();
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
        await delay();
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
        await delay();
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
        await delay();
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
        await delay();
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
        const changes = collect(liveQuery(db, "people", { where: { age: KeyRange.lowerBound(25) } }), ac.signal);
        await db.insert("people", { id: 4, name: "Eve", age: 28 });
        await db.delete("people", 4);
        await delay();
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
        const changes = collect(liveQuery(db, "people", { where: { age: KeyRange.lowerBound(25) } }), ac.signal);
        await db.insert("people", { id: 5, name: "Frank", age: 22 });
        await db.delete("people", 5);
        await delay();
        ac.abort();
        deepEqual(await changes, [[{ id: 3, name: "Alice", age: 30 }]]);
      });

      await t.test("update", async () => {
        const ac = new AbortController();
        const changes = collect(
          liveQuery(db, "people", { orderBy: "age", where: { age: KeyRange.upperBound(25) } }),
          ac.signal,
        );
        await db.update("people", 3, (value) => ({ ...value!, age: 25 }));
        await db.update("people", 3, (value) => ({ ...value!, age: 15 }));
        await db.update("people", 2, (value) => ({ ...value!, age: 35 }));
        await delay();
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
    });

    db.idb.close();
  });
});

function collect<T>(observable: MiniObservable<T>, signal: AbortSignal): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results: T[] = [];
    observable.subscribe({ next: (value) => results.push(value) }, { signal }).then(() => resolve(results), reject);
  });
}

function delay(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
