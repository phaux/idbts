import "fake-indexeddb/auto";
import "observable-polyfill";

import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { openDB, schema } from "./index.ts";

test("database lifecycle", async (t) => {
  type StrRecord = { id: number; str: string };
  type NumRecord = { id: number; num: number };

  await t.test("creates database with 1 store", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB("test-db", 1, { strs: { keyPath: "id", value: schema<StrRecord>() } }, { onUpgradeNeeded });
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 0);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 1);
  });

  await t.test("same version doesn't call onUpgradeNeeded", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB("test-db", 1, { strs: { keyPath: "id", value: schema<StrRecord>() } }, { onUpgradeNeeded });
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.idb.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });

  await t.test("upgrade adds stores", async (t) => {
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

  await t.test("upgrade adds indexes", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      3,
      {
        strs: { keyPath: "id", value: schema<StrRecord>() },
        nums: { keyPath: "id", value: schema<NumRecord>(), indexes: { byA: { keyPath: "a" }, byB: { keyPath: "b" } } },
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

  await t.test("upgrade deletes indexes", async (t) => {
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

  await t.test("upgrade deletes stores", async (t) => {
    const db = await openDB("test-db", 5, { nums: { keyPath: "id", value: schema<NumRecord>() } });
    deepEqual(Array.from(db.storeNames), ["nums"]);
    db.idb.close();
  });

  await t.test("downgrade errors", async (t) => {
    const onUpgradeNeeded = t.mock.fn();
    await rejects(openDB("test-db", 3, { strs: { keyPath: "id", value: schema<StrRecord>() } }, { onUpgradeNeeded }));
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });
});

test("inline key and index", async (t) => {
  type NameRecord = {
    id: number;
    name: string;
  };
  type DateRecord = {
    id: number | string;
    created: Date;
  };
  const db = await openDB("inline-key+index", 1, {
    num2name: {
      keyPath: "id",
      value: schema<NameRecord>(),
      indexes: {
        byName: {
          keyPath: "name",
        },
      },
    },
    union2date: {
      keyPath: "id",
      value: schema<DateRecord>(),
      indexes: {
        byDate: {
          keyPath: "created",
        },
      },
    },
  });

  await t.test("insert and get name", async () => {
    expectTypeOf(db.insert<"num2name">)
      .parameter(1)
      .toEqualTypeOf<NameRecord | readonly NameRecord[]>();
    await db.insert("num2name", { id: 1, name: "foo" });
    expectTypeOf(db.get<"num2name">)
      .parameter(1)
      .toEqualTypeOf<number>();
    expectTypeOf(db.get<"num2name">).returns.resolves.toEqualTypeOf<NameRecord | undefined>();
    deepEqual(await db.get("num2name", 1), { id: 1, name: "foo" });
    expectTypeOf(db.getAll<"num2name">).returns.resolves.toEqualTypeOf<NameRecord[]>();
    deepEqual(await db.getAll("num2name"), [{ id: 1, name: "foo" }]);
  });

  const now = new Date();

  await t.test("insert and get date", async () => {
    expectTypeOf(db.insert<"union2date">)
      .parameter(1)
      .toEqualTypeOf<DateRecord | readonly DateRecord[]>();
    await db.insert("union2date", { id: 1, created: now });
    expectTypeOf(db.get<"union2date">)
      .parameter(1)
      .toEqualTypeOf<number | string>();
    deepEqual(await db.get("union2date", 1), { id: 1, created: now });
    expectTypeOf(db.getAll<"union2date">).returns.resolves.toEqualTypeOf<DateRecord[]>();
    deepEqual(await db.getAll("union2date"), [{ id: 1, created: now }]);
  });

  await t.test("update name", async () => {
    const updater = expectTypeOf(db.update<"num2name">).parameter(2);
    updater.parameter(0).toEqualTypeOf<Readonly<NameRecord> | undefined>();
    updater.returns.toEqualTypeOf<Readonly<NameRecord>>();
    await db.update("num2name", 1, (value) => ({ ...value!, name: value!.name + "!" }));
    deepEqual(await db.get("num2name", 1), { id: 1, name: "foo!" });
  });

  await t.test("update can create entry", async () => {
    await db.update("num2name", 2, (value) => ({ id: 2, name: (value?.name ?? "new") + "!" }));
    deepEqual(await db.get("num2name", 2), { id: 2, name: "new!" });
  });

  await t.test("update throws if key changed", async () => {
    await rejects(() => db.update("num2name", 1, (value) => ({ ...value!, id: 2 })));
  });

  await t.test("delete", async () => {
    expectTypeOf(db.delete<"union2date">)
      .parameter(1)
      .toEqualTypeOf<number | string>();
    await db.delete("union2date", 1);
    deepEqual(await db.get("union2date", 1), undefined);
  });

  await t.test("delete non-existing", async () => {
    await db.delete("union2date", 123);
  });

  db.idb.close();
});

test("deeply nested key and index", async (t) => {
  type Record = { foo: { bar: { baz: string } } };
  const db = await openDB("deeply-nested-key+index", 1, {
    deeplyNested: {
      keyPath: "foo.bar.baz",
      autoIncrement: true,
      value: schema<Record>(),
      indexes: {
        byBaz: {
          keyPath: "foo.bar.baz",
        },
      },
    },
  });

  await t.test("insert and get", async () => {
    await db.insert("deeplyNested", { foo: { bar: { baz: "1" } } });
    expectTypeOf(db.get<"deeplyNested">)
      .parameter(1)
      .toEqualTypeOf<string>();
    deepEqual(await db.get("deeplyNested", "1"), { foo: { bar: { baz: "1" } } });
  });

  await t.test("update throws if key changed", async () => {
    await rejects(() =>
      db.update("deeplyNested", "1", (value) => ({
        foo: { bar: { baz: value!.foo.bar.baz + "!" } },
      })),
    );
  });

  db.idb.close();
});

test("invalid key path - missing", async (t) => {
  const db = await openDB("missing-key-path", 1, {
    invalid: {
      keyPath: "doesnt.exist",
      value: schema<{}>(),
    },
  });

  await rejects(() => db.insert("invalid", {}));

  expectTypeOf(db.get<"invalid">)
    .parameter(1)
    .toEqualTypeOf<never>();

  db.idb.close();
});

test("invalid key path - boolean", async (t) => {
  type Record = { foo: boolean };
  const db = await openDB("boolean-key-path", 1, {
    invalid: {
      keyPath: "foo",
      value: schema<Record>(),
    },
  });

  await rejects(() => db.insert("invalid", { foo: true }));

  expectTypeOf(db.get<"invalid">)
    .parameter(1)
    .toEqualTypeOf<never>();

  db.idb.close();
});

test("special properties - string", async (t) => {
  type Record = { str: string };
  const db = await openDB("special-properties-string", 1, {
    special: {
      value: schema<Record>(),
      keyPath: "str.length",
    },
  });

  await db.insert("special", { str: "foo" });

  expectTypeOf(db.get<"special">)
    .parameter(1)
    .toEqualTypeOf<number>();
  deepEqual(await db.get("special", 3), { str: "foo" });

  db.idb.close();
});

test("special properties - array", async (t) => {
  type Record = { arr: boolean[] };
  const db = await openDB("special-properties-array", 1, {
    special: {
      value: schema<Record>(),
      keyPath: "arr.length",
    },
  });

  await db.insert("special", { arr: [true, false] });

  expectTypeOf(db.get<"special">)
    .parameter(1)
    .toEqualTypeOf<number>();
  deepEqual(await db.get("special", 2), { arr: [true, false] });

  db.idb.close();
});

test("array key", async (t) => {
  type Record = {
    coords: [x: number, y: number];
  };
  const db = await openDB("array-key", 1, {
    points: {
      value: schema<Record>(),
      keyPath: "coords",
    },
  });

  await t.test("insert and get", async () => {
    await db.insert("points", { coords: [1, 2] });
    expectTypeOf(db.get<"points">)
      .parameter(1)
      .toEqualTypeOf<[number, number]>();
    deepEqual(await db.get("points", [1, 2]), { coords: [1, 2] });
  });

  await t.test("update throws if key changed", async () => {
    await rejects(() =>
      db.update("points", [1, 2], (value) => ({
        coords: [value!.coords[0] + 1, value!.coords[1] + 1],
      })),
    );
  });

  db.idb.close();
});

test("compound key", async (t) => {
  type Record = {
    x: number;
    y: number;
  };
  const db = await openDB("compound-key", 1, {
    points: {
      value: schema<Record>(),
      keyPath: ["x", "y"],
    },
  });

  await t.test("insert and get", async () => {
    await db.insert("points", { x: 1, y: 2 });
    expectTypeOf(db.get<"points">)
      .parameter(1)
      .toEqualTypeOf<readonly [number, number]>();
    deepEqual(await db.get("points", [1, 2]), { x: 1, y: 2 });
  });

  await t.test("update throws if key changed", async () => {
    await rejects(() =>
      db.update("points", [1, 2], (value) => ({
        x: value!.x + 1,
        y: value!.y + 1,
      })),
    );
  });

  db.idb.close();
});
