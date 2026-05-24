import "fake-indexeddb/auto";

import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { KeyRange, openDB, schema, type AnyStoreSchema } from "./index.ts";
import { zigZagQuery } from "./zigZagQuery.ts";

let dbId = 0;

async function initDB<T extends { id: string | number }, const Indexes extends AnyStoreSchema["indexes"]>(
  items: T[],
  indexes: Indexes,
) {
  const db = await openDB(`zigzag-${++dbId}`, 1, {
    items: {
      value: schema<T>(),
      keyPath: "id",
      indexes,
    },
  });
  await db.insert("items", items);
  return db;
}

test("zigZagJoin", async (t) => {
  await t.test("points database", async (t) => {
    const db = await initDB(
      [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 1, y: 0 },
        { id: 3, x: 0, y: 1 },
        { id: 4, x: 1, y: 1 },
        { id: 5, x: 0, y: 1 },
        { id: 6, x: 1, y: 0 },
        { id: 7, x: 2, y: 2 },
      ],
      {
        byX: { keyPath: "x" },
        byY: { keyPath: "y" },
      },
    );

    await t.test("rejects if no filters", async (t) => {
      await rejects(() => Array.fromAsync(zigZagQuery([])), {
        message: "Reduce of empty array with no initial value",
      });
    });

    await t.test("returns empty array when no matches", async (t) => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery([
          [store.index("byX"), 123],
          [store.index("byY"), 321],
        ]),
      );
      deepEqual(results, []);
    });

    await t.test("works with 1 filter", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(zigZagQuery([[store.index("byX"), 1]]));
      deepEqual(results, [
        { id: 2, x: 1, y: 0 },
        { id: 4, x: 1, y: 1 },
        { id: 6, x: 1, y: 0 },
      ]);
    });

    await t.test("works with 2 filters - 1 result", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery([
          [store.index("byX"), 1],
          [store.index("byY"), 1],
        ]),
      );
      deepEqual(results, [{ id: 4, x: 1, y: 1 }]);
    });

    await t.test("works with 2 filters - multiple results", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery([
          [store.index("byX"), 1],
          [store.index("byY"), 0],
        ]),
      );
      deepEqual(results, [
        { id: 2, x: 1, y: 0 },
        { id: 6, x: 1, y: 0 },
      ]);
    });

    await t.test("works with 2 filters reversed", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery(
          [
            [store.index("byX"), 1],
            [store.index("byY"), 0],
          ],
          undefined,
          undefined,
          { direction: "prev" },
        ),
      );
      deepEqual(results, [
        { id: 6, x: 1, y: 0 },
        { id: 2, x: 1, y: 0 },
      ]);
    });
  });

  await t.test("post database", { only: true }, async (t) => {
    const db = await initDB(
      [
        { id: 1, timestamp: 1_540, tag: "nope", title: "lol" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 4, timestamp: 1_520, tag: "foo", title: "nope" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
        { id: 7, timestamp: 1_500, tag: "foo", title: "nah" },
        { id: 8, timestamp: 1_490, tag: "wtf", title: "bar" },
      ],
      {
        byTagAndTime: { keyPath: ["tag", "timestamp"] },
        byTitleAndTime: { keyPath: ["title", "timestamp"] },
      },
    );

    await t.test("works with 1 filter", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(zigZagQuery([[store.index("byTitleAndTime"), ["bar"]]]));
      deepEqual(results, [
        { id: 8, timestamp: 1_490, tag: "wtf", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 1 filter and range", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery([[store.index("byTitleAndTime"), ["bar"]]], [KeyRange.upperBound(1_520, true)]),
      );
      deepEqual(results, [
        { id: 8, timestamp: 1_490, tag: "wtf", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery([
          [store.index("byTagAndTime"), ["foo"]],
          [store.index("byTitleAndTime"), ["bar"]],
        ]),
      );
      deepEqual(results, [
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters reversed", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery(
          [
            [store.index("byTagAndTime"), ["foo"]],
            [store.index("byTitleAndTime"), ["bar"]],
          ],
          undefined,
          undefined,
          { direction: "prev" },
        ),
      );
      deepEqual(results, [
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters and range", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery(
          [
            [store.index("byTagAndTime"), ["foo"]],
            [store.index("byTitleAndTime"), ["bar"]],
          ],
          [KeyRange.lowerBound(1_520)],
        ),
      );
      deepEqual(results, [
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters and range reversed", async () => {
      const tx = db.idb.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const results = await Array.fromAsync(
        zigZagQuery(
          [
            [store.index("byTagAndTime"), ["foo"]],
            [store.index("byTitleAndTime"), ["bar"]],
          ],
          [KeyRange.lowerBound(1_520)],
          undefined,
          { direction: "prev" },
        ),
      );
      deepEqual(results, [
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
      ]);
    });
  });
});
