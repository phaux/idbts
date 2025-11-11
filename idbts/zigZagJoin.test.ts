import "fake-indexeddb/auto";

import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { openDB, schema, type AnyStoreSchema, type DatabaseSchemaOf } from "./index.ts";
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
  await t.test("points", async () => {
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

    {
      const tx = db.tx("items", "readonly");
      await rejects(() => Array.fromAsync(zigZagJoin(tx.store("items"), [])));
      await tx.done;
    }

    {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byX", 123],
          ["byY", 321],
        ]),
      );
      await tx.done;
      deepEqual(results, []);
    }

    {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(zigZagJoin(tx.store("items"), [["byX", 1]]));
      await tx.done;
      deepEqual(results, [
        { id: 2, x: 1, y: 0 },
        { id: 4, x: 1, y: 1 },
        { id: 6, x: 1, y: 0 },
      ]);
    }

    {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byX", 1],
          ["byY", 1],
        ]),
      );
      await tx.done;
      deepEqual(results, [{ id: 4, x: 1, y: 1 }]);
    }

    {
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
    }
  });

  await t.test("with timestamp", async () => {
    const db = await initDB(
      [
        { id: 1, timestamp: 1_540_000_000_000, a: "nope", b: "lol" },
        { id: 2, timestamp: 1_530_000_000_000, a: "foo", b: "bar" },
        { id: 3, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 4, timestamp: 1_520_000_000_000, a: "foo", b: "nope" },
        { id: 5, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 6, timestamp: 1_510_000_000_000, a: "foo", b: "bar" },
        { id: 7, timestamp: 1_500_000_000_000, a: "foo", b: "nah" },
      ],
      {
        byA: { keyPath: ["a", "timestamp"] },
        byB: { keyPath: ["b", "timestamp"] },
      },
    );

    expectTypeOf(zigZagJoin<DatabaseSchemaOf<typeof db>["items"]>)
      .parameter(1)
      .toEqualTypeOf<
        ReadonlyArray<
          | readonly ["byA", readonly [string, number] | readonly [string] | readonly []]
          | readonly ["byB", readonly [string, number] | readonly [string] | readonly []]
        >
      >();

    {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(zigZagJoin(tx.store("items"), [["byB", ["bar"]]]));
      await tx.done;
      deepEqual(results, [
        { id: 6, timestamp: 1_510_000_000_000, a: "foo", b: "bar" },
        { id: 3, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 5, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 2, timestamp: 1_530_000_000_000, a: "foo", b: "bar" },
      ]);
    }

    {
      const tx = db.tx("items", "readonly");
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("items"), [
          ["byA", ["foo"]],
          ["byB", ["bar"]],
        ]),
      );
      await tx.done;
      deepEqual(results, [
        { id: 6, timestamp: 1_510_000_000_000, a: "foo", b: "bar" },
        { id: 3, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 5, timestamp: 1_520_000_000_000, a: "foo", b: "bar" },
        { id: 2, timestamp: 1_530_000_000_000, a: "foo", b: "bar" },
      ]);
    }
  });
});
