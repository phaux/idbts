import { deepEqual, rejects } from "node:assert/strict";
import { suite, test } from "node:test";
import { openDB } from "../src/openDB.ts";
import { schema } from "../src/StandardSchema.ts";

await suite("openDB", async () => {
  type StrRecord = { id: number; str: string };
  type NumRecord = { id: number; num: number };

  await test("creates database with 1 store", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      1,
      {
        strs: { keyPath: "id", value: schema<StrRecord>() },
      },
      { onUpgradeNeeded },
    );
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 0);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 1);
  });

  await test("same version doesn't call onUpgradeNeeded", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      1,
      {
        strs: { keyPath: "id", value: schema<StrRecord>() },
      },
      { onUpgradeNeeded },
    );
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });

  await test("upgrade adds stores", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      2,
      {
        strs: { keyPath: "id", value: schema<StrRecord>() },
        nums: { keyPath: "id", value: schema<NumRecord>(), indexes: { byA: { keyPath: "a" } } },
      },
      { onUpgradeNeeded },
    );
    deepEqual(new Set(Array.from(db.storeNames)), new Set(["strs", "nums"]));
    const tx = db.idb.transaction("nums", "readonly");
    const numStore = tx.objectStore("nums");
    deepEqual(Array.from(numStore.indexNames), ["byA"]);
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 2);
  });

  await test("upgrade adds indexes", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      3,
      {
        strs: { keyPath: "id", value: schema<StrRecord>() },
        nums: {
          keyPath: "id",
          value: schema<NumRecord>(),
          indexes: { byA: { keyPath: "a" }, byB: { keyPath: "b" } },
        },
      },
      { onUpgradeNeeded },
    );
    {
      const tx = db.idb.transaction("nums", "readonly");
      const numStore = tx.objectStore("nums");
      deepEqual(new Set(Array.from(numStore.indexNames)), new Set(["byA", "byB"]));
    }
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 2);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 3);
  });

  await test("upgrade deletes indexes", async () => {
    const db = await openDB("test-db", 4, {
      strs: { keyPath: "id", value: schema<StrRecord>() },
      nums: { keyPath: "id", value: schema<NumRecord>(), indexes: { byB: { keyPath: "b" } } },
    });
    {
      const tx = db.idb.transaction("nums", "readonly");
      const numStore = tx.objectStore("nums");
      deepEqual(Array.from(numStore.indexNames), ["byB"]);
    }
    db.idb.close();
  });

  await test("upgrade deletes stores", async () => {
    const db = await openDB("test-db", 5, { nums: { keyPath: "id", value: schema<NumRecord>() } });
    deepEqual(Array.from(db.storeNames), ["nums"]);
    db.idb.close();
  });

  await test("downgrade errors", async (t) => {
    const onUpgradeNeeded = t.mock.fn();
    await rejects(
      openDB(
        "test-db",
        3,
        {
          strs: { keyPath: "id", value: schema<StrRecord>() },
        },
        { onUpgradeNeeded },
      ),
    );
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });
});
