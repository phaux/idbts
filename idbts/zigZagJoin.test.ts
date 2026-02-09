import "fake-indexeddb/auto";

import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { KeyRange, openDB, schema, type AnyStoreSchema, type DatabaseSchemaOf } from "./index.ts";
import { zigZagJoin } from "./zigZagJoin.ts";

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
  {
    const tx = db.tx("items", "readwrite");
    const store = tx.store("items");
    for (const item of items) {
      await store.add(item);
    }
    await tx.done;
  }
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

    expectTypeOf(zigZagJoin<DatabaseSchemaOf<typeof db>["items"]>)
      .parameter(1)
      .toEqualTypeOf<ReadonlyArray<readonly ["byX", number] | readonly ["byY", number]>>();

    await t.test("rejects if no filters", async (t) => {
      const tx = db.tx("items", "readonly");
      await rejects(() => Array.fromAsync(zigZagJoin(tx.store("items"), [])));
      await tx.done;
    });

    await t.test("returns empty array when no matches", async (t) => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byX", 123],
          ["byY", 321],
        ]),
      );
      await tx.done;
      deepEqual(results, []);
    });

    await t.test("works with 1 filter", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(zigZagJoin(tx.store("items"), [["byX", 1]]));
      await tx.done;
      deepEqual(results, [
        { id: 2, x: 1, y: 0 },
        { id: 4, x: 1, y: 1 },
        { id: 6, x: 1, y: 0 },
      ]);
    });

    await t.test("works with 2 filters - 1 result", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byX", 1],
          ["byY", 1],
        ]),
      );
      await tx.done;
      deepEqual(results, [{ id: 4, x: 1, y: 1 }]);
    });

    await t.test("works with 2 filters - multiple results", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byX", 1],
          ["byY", 0],
        ]),
      );
      await tx.done;
      deepEqual(results, [
        { id: 2, x: 1, y: 0 },
        { id: 6, x: 1, y: 0 },
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

    expectTypeOf(zigZagJoin<DatabaseSchemaOf<typeof db>["items"]>)
      .parameter(1)
      .toEqualTypeOf<
        ReadonlyArray<
          | readonly ["byTagAndTime", readonly [string, number] | readonly [string] | readonly []]
          | readonly ["byTitleAndTime", readonly [string, number] | readonly [string] | readonly []]
        >
      >();

    await t.test("works with 1 filter", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(zigZagJoin(tx.store("items"), [["byTitleAndTime", ["bar"]]]));
      await tx.done;
      deepEqual(results, [
        { id: 8, timestamp: 1_490, tag: "wtf", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 1 filter and range", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [["byTitleAndTime", ["bar"]]], KeyRange.upperBound([1_520], true)),
      );
      await tx.done;
      deepEqual(results, [
        { id: 8, timestamp: 1_490, tag: "wtf", title: "bar" },
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byTagAndTime", ["foo"]],
          ["byTitleAndTime", ["bar"]],
        ]),
      );
      await tx.done;
      deepEqual(results, [
        { id: 6, timestamp: 1_510, tag: "foo", title: "bar" },
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });

    await t.test("works with 2 filters and range", async () => {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(
          tx.store("items"),
          [
            ["byTagAndTime", ["foo"]],
            ["byTitleAndTime", ["bar"]],
          ],
          KeyRange.lowerBound([1_520]),
        ),
      );
      await tx.done;
      deepEqual(results, [
        { id: 3, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 5, timestamp: 1_520, tag: "foo", title: "bar" },
        { id: 2, timestamp: 1_530, tag: "foo", title: "bar" },
      ]);
    });
  });
});
