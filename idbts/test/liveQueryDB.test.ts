import { deepEqual, equal } from "node:assert/strict";
import { suite, test } from "node:test";
import { liveQueryDB } from "../src/liveQueryDB.ts";
import type { MiniObservable } from "../src/MiniObservable.ts";
import { openDB } from "../src/openDB.ts";
import { schema } from "../src/schema.ts";

await suite("liveQueryDB", { concurrency: true }, async () => {
  await test("buffers changes until initial query resolves", async () => {
    const db = await openDB("live-query-buffering", 1, {
      items: {
        itemSchema: schema<{ id: number }>(),
        primaryKeyPath: "id",
      },
    });
    const mutations: Promise<void>[] = [];
    const ac = new AbortController();
    // DB: []
    mutations.push(db.insert("items", { id: 1 }));
    mutations.push(db.insert("items", { id: 2 }));
    // subscription starts while inserts are still in-flight
    const changes = collect(liveQueryDB(db, "items", {}), ac.signal);
    mutations.push(db.insert("items", { id: 3 }));
    await Promise.all(mutations);
    // DB: [{id:1}, {id:2}, {id:3}]
    await tick();
    ac.abort();
    deepEqual((await changes).at(-1), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    db.idb.close();
  });

  await test("by primary key", async (t) => {
    interface Item {
      n: number;
      s?: string;
    }
    const db = await openDB("live-query-primary-key", 1, {
      nums: {
        itemSchema: schema<Item>(),
        primaryKeyPath: "n",
      },
    });

    await t.test("watching all keys", async (t) => {
      await t.test("insert", async () => {
        // DB: []
        const ac = new AbortController();
        const changesPromise = collect(liveQueryDB(db, "nums", {}), ac.signal);
        await db.insert("nums", [{ n: 1 }, { n: 3 }, { n: 5 }]);
        // DB: [1, 3, 5]
        await db.upsert("nums", [{ n: 2 }, { n: 4 }]);
        // DB: [1, 2, 3, 4, 5]
        await tick();
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
        // DB: [1, 2, 3, 4, 5]
        const ac = new AbortController();
        const changesPromise = collect(liveQueryDB(db, "nums", {}), ac.signal);
        await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
        // DB: [1, {n:2,s:"updated"}, 3, 4, 5]
        await db.update("nums", 4, (value) => ({ n: value!.n, s: "updated" }));
        // DB: [1, {n:2,s:"updated"}, 3, {n:4,s:"updated"}, 5]
        await tick();
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
        // DB: [1, {n:2,s:"updated"}, 3, {n:4,s:"updated"}, 5]
        const ac = new AbortController();
        const changesPromise = collect(liveQueryDB(db, "nums", {}), ac.signal);
        await db.update("nums", [2, 4], (value) => ({ n: value!.n, s: "updated again" }));
        // DB: [1, {n:2,s:"updated again"}, 3, {n:4,s:"updated again"}, 5]
        await tick();
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
        // DB: [1, {n:2,s:"updated again"}, 3, {n:4,s:"updated again"}, 5]
        const ac = new AbortController();
        const changesPromise = collect(liveQueryDB(db, "nums", {}), ac.signal);
        await db.delete("nums", 2);
        // DB: [1, 3, {n:4,s:"updated again"}, 5]
        await db.delete("nums", 4);
        // DB: [1, 3, 5]
        await tick();
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
        // DB: [1, 3, 5]
        const ac = new AbortController();
        const changesPromise = collect(liveQueryDB(db, "nums", {}), ac.signal);
        await db.delete("nums", [1, 2, 4, 5]); // 2 and 4 are already absent
        // DB: [3]
        await tick();
        ac.abort();
        const changes = await changesPromise;
        deepEqual(changes, [[{ n: 1 }, { n: 3 }, { n: 5 }], [{ n: 3 }]]);
        equal(changes[0]![1], changes[1]![0]);
      });
    });

    await t.test("watching key range", async () => {
      // DB: [3]
      const ac = new AbortController();
      const changesPromise = collect(
        liveQueryDB(db, "nums", { orderBy: "n", lower: 2, upper: 4 }),
        ac.signal,
      );
      await db.insert("nums", { n: 2 });
      // DB: [2, 3]
      await db.insert("nums", { n: 6 });
      // DB: [2, 3, 6]
      await db.update("nums", 2, (value) => ({ n: value!.n, s: "updated" }));
      // DB: [{n:2,s:"updated"}, 3, 6]
      await db.update("nums", 6, (value) => ({ n: value!.n, s: "updated" }));
      // DB: [{n:2,s:"updated"}, 3, {n:6,s:"updated"}]
      await db.delete("nums", 2);
      // DB: [3, {n:6,s:"updated"}]
      await db.delete("nums", 6);
      // DB: [3]
      await tick();
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
      // DB: [3]
      const ac = new AbortController();
      const changesPromise = collect(
        liveQueryDB(db, "nums", { where: { n: undefined as never } }),
        ac.signal,
      );

      await db.upsert("nums", { n: 0 });
      // DB: [0, 3]
      await db.delete("nums", 0);
      // DB: [3]
      await tick();
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [[{ n: 3 }], [{ n: 0 }, { n: 3 }], [{ n: 3 }]]);
    });

    db.idb.close();
  });

  await test("by index", async (t) => {
    interface Item {
      id: number;
      name: string;
      age: number;
    }
    const db = await openDB("live-query-index", 1, {
      people: {
        itemSchema: schema<Item>(),
        primaryKeyPath: "id",
        indexedKeyPaths: {
          name: { sortable: true },
          age: { sortable: true },
        },
      },
    });

    await t.test("watching ordered", async (t) => {
      await t.test("insert at the end", async () => {
        // DB: []
        const ac = new AbortController();
        const changes = collect(liveQueryDB(db, "people", { orderBy: "name" }), ac.signal);
        await db.insert("people", { id: 3, name: "Alice", age: 30 });
        // DB: [{id:3,"Alice",30}]
        await db.upsert("people", { id: 2, name: "Charlie", age: 25 });
        // DB: [{id:2,"Charlie",25}, {id:3,"Alice",30}]
        await tick();
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
        // DB: [{id:2,"Charlie",25}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(liveQueryDB(db, "people", { orderBy: "name" }), ac.signal);
        await db.insert("people", { id: 1, name: "Bob", age: 35 });
        // DB: [{id:1,"Bob",35}, {id:2,"Charlie",25}, {id:3,"Alice",30}]
        await tick();
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
        // DB: [{id:1,"Bob",35}, {id:2,"Charlie",25}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(liveQueryDB(db, "people", { orderBy: "name" }), ac.signal);
        await db.update("people", 1, (value) => ({ ...value!, name: "David" }));
        // DB: [{id:1,"David",35}, {id:2,"Charlie",25}, {id:3,"Alice",30}]
        await tick();
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
        // DB: [{id:1,"David",35}, {id:2,"Charlie",25}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(liveQueryDB(db, "people", { orderBy: "name" }), ac.signal);
        await db.update("people", 2, (value) => ({ ...value!, age: 20 }));
        // DB: [{id:1,"David",35}, {id:2,"Charlie",20}, {id:3,"Alice",30}]
        await tick();
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
        // DB: [{id:1,"David",35}, {id:2,"Charlie",20}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(liveQueryDB(db, "people", { orderBy: "name" }), ac.signal);
        await db.delete("people", 1);
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        await tick();
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
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(
          liveQueryDB(db, "people", { orderBy: "age", lower: 25 }),
          ac.signal,
        );
        await db.insert("people", { id: 4, name: "Eve", age: 28 });
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}, {id:4,"Eve",28}]
        await db.delete("people", 4);
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        await tick();
        ac.abort();
        deepEqual(await changes, [
          [{ id: 3, name: "Alice", age: 30 }],
          [
            { id: 4, name: "Eve", age: 28 },
            { id: 3, name: "Alice", age: 30 },
          ],
          [{ id: 3, name: "Alice", age: 30 }],
        ]);
      });

      await t.test("insert and delete outside range", async () => {
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(
          liveQueryDB(db, "people", { orderBy: "age", lower: 25 }),
          ac.signal,
        );
        await db.insert("people", { id: 5, name: "Frank", age: 22 });
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}, {id:5,"Frank",22}]
        await db.delete("people", 5);
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        await tick();
        ac.abort();
        deepEqual(await changes, [[{ id: 3, name: "Alice", age: 30 }]]);
      });

      await t.test("update", async () => {
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",30}]
        const ac = new AbortController();
        const changes = collect(
          liveQueryDB(db, "people", { orderBy: "age", upper: 25 }),
          ac.signal,
        );
        await db.update("people", 3, (value) => ({ ...value!, age: 25 }));
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",25}]
        await db.update("people", 3, (value) => ({ ...value!, age: 15 }));
        // DB: [{id:2,"Charlie",20}, {id:3,"Alice",15}]
        await db.update("people", 2, (value) => ({ ...value!, age: 35 }));
        // DB: [{id:2,"Charlie",35}, {id:3,"Alice",15}]
        await tick();
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
        // DB: [{id:2,"Charlie",35}, {id:3,"Alice",15}]
        const ac = new AbortController();
        const changes = collect(
          liveQueryDB(db, "people", { where: { age: undefined as never } }),
          ac.signal,
        );
        await db.upsert("people", { id: 4, name: "Eve", age: 28 });
        // DB: [{id:2,"Charlie",35}, {id:3,"Alice",15}, {id:4,"Eve",28}]
        await db.delete("people", 4);
        // DB: [{id:2,"Charlie",35}, {id:3,"Alice",15}]
        await tick();
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

  await test("with limit", async (t) => {
    interface Record {
      n: number;
    }
    const db = await openDB("live-query-limit", 1, {
      nums: {
        itemSchema: schema<Record>(),
        primaryKeyPath: "n",
      },
    });

    await t.test("initial results respect limit", async () => {
      await db.insert("nums", [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
      const ac = new AbortController();
      const changesPromise = collect(liveQueryDB(db, "nums", { limit: 3 }), ac.signal);
      await tick();
      ac.abort();
      deepEqual(await changesPromise, [[{ n: 1 }, { n: 2 }, { n: 3 }]]);
    });
    // DB: [1, 2, 3, 4, 5]

    await t.test("insert at beginning truncates last item", async () => {
      const ac = new AbortController();
      const changesPromise = collect(liveQueryDB(db, "nums", { limit: 3 }), ac.signal);
      await db.insert("nums", { n: 0 });
      await tick();
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [
        [{ n: 1 }, { n: 2 }, { n: 3 }],
        [{ n: 0 }, { n: 1 }, { n: 2 }],
      ]);
      // Items that remained in the window keep their object references.
      equal(changes[0]![0], changes[1]![1]); // {n:1} preserved
      equal(changes[0]![1], changes[1]![2]); // {n:2} preserved
    });
    // DB: [0, 1, 2, 3, 4, 5]

    await t.test("insert past limit does not appear in results", async () => {
      const ac = new AbortController();
      const changesPromise = collect(liveQueryDB(db, "nums", { limit: 3 }), ac.signal);
      await db.insert("nums", { n: 6 });
      await tick();
      ac.abort();
      // n=6 sorts after the limit window [0,1,2], so no extra emit.
      deepEqual(await changesPromise, [[{ n: 0 }, { n: 1 }, { n: 2 }]]);
    });
    // DB: [0, 1, 2, 3, 4, 5, 6]

    await t.test("delete from results re-queries to fill up", async () => {
      const ac = new AbortController();
      const changesPromise = collect(liveQueryDB(db, "nums", { limit: 3 }), ac.signal);
      await db.delete("nums", 0);
      await tick();
      ac.abort();
      const changes = await changesPromise;
      deepEqual(changes, [
        [{ n: 0 }, { n: 1 }, { n: 2 }],
        [{ n: 1 }, { n: 2 }, { n: 3 }],
      ]);
      // Items that were already in the window keep their object references.
      equal(changes[0]![1], changes[1]![0]); // {n:1} preserved
      equal(changes[0]![2], changes[1]![1]); // {n:2} preserved
    });
    // DB: [1, 2, 3, 4, 5, 6]

    await t.test("delete outside results does not change results", async () => {
      const ac = new AbortController();
      const changesPromise = collect(liveQueryDB(db, "nums", { limit: 3 }), ac.signal);
      await db.delete("nums", 6);
      await tick();
      ac.abort();
      // n=6 was outside the limit window [1,2,3], so no extra emit.
      deepEqual(await changesPromise, [[{ n: 1 }, { n: 2 }, { n: 3 }]]);
    });
    // DB: [1, 2, 3, 4, 5]

    await t.test("limit + direction prev", async () => {
      const ac = new AbortController();
      const changesPromise = collect(
        liveQueryDB(db, "nums", { limit: 2, reverse: true }),
        ac.signal,
      );
      await tick();
      await db.insert("nums", { n: 6 });
      await tick();
      ac.abort();
      deepEqual(await changesPromise, [
        [{ n: 5 }, { n: 4 }], // initial: 2 largest
        [{ n: 6 }, { n: 5 }], // 6 displaces 4
      ]);
    });
    // DB: [1, 2, 3, 4, 5, 6]

    await t.test("limit + where", async () => {
      const ac = new AbortController();
      const changesPromise = collect(
        liveQueryDB(db, "nums", { orderBy: "n", lower: 4, limit: 2 }),
        ac.signal,
      );
      await tick();
      await db.delete("nums", 4);
      await tick();
      ac.abort();
      deepEqual(await changesPromise, [
        [{ n: 4 }, { n: 5 }], // initial: n≥4, top 2: [4,5]
        [{ n: 5 }, { n: 6 }], // 4 deleted, re-query fills: [5,6]
      ]);
    });
    // DB: [1, 2, 3, 5, 6]

    await t.test("limit + orderBy", async () => {
      interface Item {
        id: number;
        score: number;
      }
      const db2 = await openDB("live-query-limit-orderby", 1, {
        items: {
          itemSchema: schema<Item>(),
          primaryKeyPath: "id",
          indexedKeyPaths: {
            score: { sortable: true },
          },
        },
      });
      await db2.insert("items", [
        { id: 1, score: 30 },
        { id: 2, score: 10 },
        { id: 3, score: 20 },
        { id: 4, score: 40 },
        { id: 5, score: 50 },
      ]);
      const ac = new AbortController();
      const changesPromise = collect(
        liveQueryDB(db2, "items", { orderBy: "score", limit: 2 }),
        ac.signal,
      );
      await tick();
      await db2.insert("items", { id: 6, score: 5 });
      await tick();
      ac.abort();
      deepEqual(await changesPromise, [
        [
          { id: 2, score: 10 },
          { id: 3, score: 20 },
        ], // initial: lowest 2 by score
        [
          { id: 6, score: 5 },
          { id: 2, score: 10 },
        ], // score:5 displaces score:20
      ]);
      db2.idb.close();
    });

    db.idb.close();
  });
});

/**
 * fake-indexeddb fires each IDB cursor step via one setImmediate.
 * This function chains enough hops so every pending IDB step and the async queue chain
 * (Promise microtasks, which drain between hops) all complete before the test continues.
 * 15 is safely above the maximum steps in these tests.
 */
async function tick() {
  let p: Promise<void> = Promise.resolve();
  for (let i = 0; i < 15; i++) {
    p = p.then(async () => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  return p;
}

async function collect<T>(observable: MiniObservable<T>, signal: AbortSignal): Promise<T[]> {
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
