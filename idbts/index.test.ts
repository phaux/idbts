import "fake-indexeddb/auto";
import "observable-polyfill";

import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { type Mock, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { KeyRange, openDB, schema } from "./index.ts";

/**
 * Returns a promise which resolves when the mock function is called.
 * Mocks implementation once to call the function and resolve the promise with the result.
 * This causes the call count to increase by 2.
 */
function whenMockCalled<Args extends unknown[], Ret>(fn: Mock<(...args: Args) => Ret>): Promise<Ret> {
  return new Promise((resolve) => {
    fn.mock.mockImplementationOnce((...args) => {
      const result = fn(...args);
      resolve(result);
      return result;
    });
  });
}

test("database lifecycle", async (t) => {
  type NumData = { a: number; b: number };

  await t.test("creates database with 1 store", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB("test-db", 1, { strs: { value: schema<string>() } }, { onUpgradeNeeded });
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 0);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 1);
  });

  await t.test("same version doesn't call onUpgradeNeeded", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB("test-db", 1, { strs: { value: schema<string>() } }, { onUpgradeNeeded });
    deepEqual(Array.from(db.storeNames), ["strs"]);
    db.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });

  await t.test("upgrade adds stores", async (t) => {
    const onUpgradeNeeded = t.mock.fn<NonNullable<IDBOpenDBRequest["onupgradeneeded"]>>();
    const db = await openDB(
      "test-db",
      2,
      {
        strs: { value: schema<string>() },
        nums: { value: schema<NumData>(), indexes: { byA: { keyPath: "a" } } },
      },
      { onUpgradeNeeded },
    );
    deepEqual(new Set(Array.from(db.storeNames)), new Set(["strs", "nums"]));
    const tx = db.tx("nums", "readonly");
    const numStore = tx.store("nums");
    deepEqual(Array.from(numStore.raw.indexNames), ["byA"]);
    await tx.done;
    db.close();
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
        strs: { value: schema<string>() },
        nums: { value: schema<NumData>(), indexes: { byA: { keyPath: "a" }, byB: { keyPath: "b" } } },
      },
      { onUpgradeNeeded },
    );
    {
      const tx = db.tx("nums", "readonly");
      const numStore = tx.store("nums");
      deepEqual(new Set(Array.from(numStore.raw.indexNames)), new Set(["byA", "byB"]));
      await tx.done;
    }
    db.close();
    deepEqual(onUpgradeNeeded.mock.calls.length, 1);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.oldVersion, 2);
    deepEqual(onUpgradeNeeded.mock.calls[0]?.arguments[0]?.newVersion, 3);
  });

  await t.test("upgrade deletes indexes", async (t) => {
    const db = await openDB("test-db", 4, {
      strs: { value: schema<string>() },
      nums: { value: schema<NumData>(), indexes: { byB: { keyPath: "b" } } },
    });
    {
      const tx = db.tx("nums", "readonly");
      const numStore = tx.store("nums");
      deepEqual(Array.from(numStore.raw.indexNames), ["byB"]);
      await tx.done;
    }
    db.close();
  });

  await t.test("upgrade deletes stores", async (t) => {
    const db = await openDB("test-db", 5, { nums: { value: schema<NumData>() } });
    deepEqual(Array.from(db.storeNames), ["nums"]);
    db.close();
  });

  await t.test("downgrade errors", async (t) => {
    const onUpgradeNeeded = t.mock.fn();
    await rejects(openDB("test-db", 3, { strs: { value: schema<string>() } }, { onUpgradeNeeded }));
    deepEqual(onUpgradeNeeded.mock.calls.length, 0);
  });
});

test("simple key-value store", async (t) => {
  const db = await openDB("kv-store", 1, {
    num2str: {
      key: schema<number>(),
      value: schema<string>(),
    },
    str2unknown: {
      key: schema<string>(),
      value: schema<unknown>(),
    },
  });

  expectTypeOf(db.tx).parameter(0).toEqualTypeOf<"num2str" | "str2unknown" | readonly ("num2str" | "str2unknown")[]>();

  await t.test("object stores in transaction", async () => {
    const tx = db.tx(["num2str", "str2unknown"], "readonly");
    expectTypeOf(tx.store).parameter(0).toEqualTypeOf<"num2str" | "str2unknown">();
    tx.abort();
    await rejects(tx.done, /abort/i);
  });

  await t.test("number to string", async () => {
    const tx = db.tx(["num2str"], "readwrite");
    expectTypeOf(tx.store).parameter(0).toEqualTypeOf<"num2str" | undefined>();
    const store = tx.store("num2str");
    deepEqual(store.raw.name, "num2str");
    expectTypeOf(store.add).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<number>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<number>();
    deepEqual(await store.add("value", 1), 1);
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(store.get).returns.resolves.toEqualTypeOf<string>();
    deepEqual(await store.get(1), "value");
    deepEqual(await store.getAll(), ["value"]);
    deepEqual(await store.getAllKeys(), [1]);
    tx.commit();
    await tx.done;
  });

  await t.test("string to unknown", async () => {
    const tx = db.tx("str2unknown", "readwrite");
    expectTypeOf(tx.store).parameter(0).toEqualTypeOf<"str2unknown" | undefined>();
    const store = tx.store("str2unknown");
    deepEqual(store.raw.name, "str2unknown");
    expectTypeOf(store.add).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<string>();
    deepEqual(await store.add({ value: true }, "key"), "key");
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(store.get).returns.resolves.toEqualTypeOf<unknown>();
    deepEqual(await store.get("key"), { value: true });
    deepEqual(await store.getAll(), [{ value: true }]);
    deepEqual(await store.getAllKeys(), ["key"]);
    tx.commit();
    await tx.done;
  });

  await t.test("readonly transaction doesn't have write methods", async () => {
    const tx = db.tx("num2str");
    const store = tx.store("num2str");
    expectTypeOf(store).not.toHaveProperty("add");
    expectTypeOf(store).not.toHaveProperty("put");
    expectTypeOf(store).not.toHaveProperty("update");
    expectTypeOf(store).not.toHaveProperty("delete");
    expectTypeOf(store).not.toHaveProperty("clear");
    await tx.done;
  });

  await t.test("1 store transaction doesn't require to specify store name", async () => {
    const tx = db.tx("num2str");
    const store = tx.store();
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(store.get).returns.resolves.toEqualTypeOf<string>();
    deepEqual(await store.get(1), "value");
    await tx.done;
  });

  await t.test("update", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    const key = await store.update(1, (value) => value + "!");
    deepEqual(key, 1);
    deepEqual(await store.get(1), "value!");
    await tx.done;
  });

  await t.test("update can create entry", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    const key = await store.update(2, (value) => (value ?? "new") + "!");
    deepEqual(key, 2);
    deepEqual(await store.get(2), "new!");
    await tx.done;
  });

  await t.test("update can delete entry", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    const key = await store.update(2, () => undefined);
    deepEqual(key, undefined);
    deepEqual(await store.getAll(KeyRange.only(2)), []);
    await tx.done;
  });

  await t.test("update does nothing on undefined", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    const key = await store.update(2, () => undefined);
    deepEqual(key, undefined);
    deepEqual(await store.getAll(KeyRange.only(2)), []);
    await tx.done;
  });

  await t.test("iterate", async () => {
    const tx = db.tx("num2str");
    const store = tx.store("num2str");
    const entries: [number, string][] = [];
    for await (const cursor of store.iterate()) {
      entries.push([cursor.key, cursor.value]);
    }
    deepEqual(entries, [[1, "value!"]]);
    await tx.done;
  });

  await t.test("iterate empty", async () => {
    const tx = db.tx("num2str");
    const store = tx.store("num2str");
    const iter = store.iterate(KeyRange.upperBound(0));
    deepEqual(await iter.next(), { value: undefined, done: true });
    await tx.done;
  });

  await t.test("update while iterating", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    const keys: number[] = [];
    for await (const cursor of store.iterate()) {
      keys.push(await cursor.update(cursor.value + "?"));
    }
    deepEqual(keys, [1]);
    deepEqual(await store.get(1), "value!?");
    await tx.done;
  });

  await t.test("delete while iterating", async () => {
    const tx = db.tx("num2str", "readwrite");
    const store = tx.store("num2str");
    for await (const cursor of store.iterate()) {
      await cursor.delete();
    }
    deepEqual(await store.get(1), undefined);
    await tx.done;
  });

  await t.test("watch", async (t) => {
    const ac = new AbortController();
    const cb = t.mock.fn((v: string | undefined) => v);
    const called = whenMockCalled(cb); // increases call count by 2
    const finished = db.watch("num2str", 1).forEach(cb, { signal: ac.signal });
    deepEqual(await called, undefined);
    deepEqual(cb.mock.calls.length, 2);

    await t.test("add", async () => {
      const tx = db.tx("num2str", "readwrite");
      const store = tx.store("num2str");
      const called = whenMockCalled(cb);
      await store.put("new value", 1);
      await tx.done;
      deepEqual(await called, "new value");
      deepEqual(cb.mock.calls.length, 4);
    });

    await t.test("delete", async () => {
      const tx = db.tx("num2str", "readwrite");
      const store = tx.store("num2str");
      const called = whenMockCalled(cb);
      await store.delete(1);
      await tx.done;
      deepEqual(await called, undefined);
      deepEqual(cb.mock.calls.length, 6);
    });

    await t.test("add unwatched key", async () => {
      const tx = db.tx("num2str", "readwrite");
      const store = tx.store("num2str");
      const called = whenMockCalled(cb);
      await store.put("new value", 2);
      await tx.done;
      deepEqual(await Promise.race([called, setTimeout(10, "timeout")]), "timeout");
      deepEqual(cb.mock.calls.length, 6);
    });

    await t.test("clear", async () => {
      const tx = db.tx("num2str", "readwrite");
      const store = tx.store("num2str");
      const called = whenMockCalled(cb);
      await store.clear();
      await tx.done;
      deepEqual(await called, undefined);
      deepEqual(cb.mock.calls.length, 8);
    });

    await t.test("openCursor", async () => {
      {
        const tx = db.tx("num2str", "readwrite");
        const store = tx.store("num2str");
        for (let i = 0; i < 10; i++) {
          await store.put(`value ${i}`, i);
        }
        await tx.done;
      }
      {
        const tx = db.tx("num2str", "readonly");
        const store = tx.store("num2str");
        let cursor = await store.openCursor();
        let results: string[] = [];
        while (cursor != null) {
          results.push(cursor.value);
          cursor = await cursor.advance(1);
        }
        deepEqual(
          results,
          Array.from({ length: 10 }, (_, i) => `value ${i}`),
        );
      }
    });

    ac.abort();
    await rejects(finished, { name: "AbortError" });
  });

  await t.test("watch all", async (t) => {
    const ac = new AbortController();
    const cb = t.mock.fn((v: unknown[]) => v);
    const called = whenMockCalled(cb); // increases call count by 2
    const finished = db.watchAll("str2unknown").forEach(cb, { signal: ac.signal });
    deepEqual(await called, [{ value: true }]); // from previous test
    deepEqual(cb.mock.calls.length, 2);

    await t.test("add", async () => {
      const called = whenMockCalled(cb);
      await db.put("str2unknown", "some value", "zzz");
      deepEqual(await called, [{ value: true }, "some value"]);
      deepEqual(cb.mock.calls.length, 4);
    });

    await t.test("delete", async () => {
      const called = whenMockCalled(cb);
      await db.delete("str2unknown", "zzz");
      deepEqual(await called, [{ value: true }]);
      deepEqual(cb.mock.calls.length, 6);
    });

    ac.abort();
    await rejects(finished, { name: "AbortError" });
  });

  await t.test("watch all with range", async (t) => {
    const ac = new AbortController();
    const cb = t.mock.fn((v: unknown[]) => v);
    const called = whenMockCalled(cb); // increases call count by 2
    const finished = db.watchAll("str2unknown", KeyRange.bound("b", "x")).forEach(cb, { signal: ac.signal });
    deepEqual(await called, [{ value: true }]); // from previous test
    deepEqual(cb.mock.calls.length, 2);

    await t.test("add", async () => {
      const called = whenMockCalled(cb);
      await db.put("str2unknown", "new value", "b");
      deepEqual(await called, ["new value", { value: true }]);
      deepEqual(cb.mock.calls.length, 4);
    });

    await t.test("delete", async () => {
      const called = whenMockCalled(cb);
      await db.delete("str2unknown", "b");
      deepEqual(await called, [{ value: true }]);
      deepEqual(cb.mock.calls.length, 6);
    });

    await t.test("add unwatched key", async () => {
      const called = whenMockCalled(cb);
      await db.put("str2unknown", "another value", "a");
      deepEqual(await Promise.race([called, setTimeout(10, "timeout")]), "timeout");
      deepEqual(cb.mock.calls.length, 6);
    });

    await t.test("clear", async () => {
      const called = whenMockCalled(cb);
      await db.clear("str2unknown");
      deepEqual(await called, []);
      deepEqual(cb.mock.calls.length, 8);
    });

    ac.abort();
    await rejects(finished, { name: "AbortError" });
  });

  db.close();
});

test("autoIncrement key", async (t) => {
  const db = await openDB("auto-increment-key", 1, {
    numbered: {
      key: schema<number>(),
      autoIncrement: true,
      value: schema<unknown>(),
    },
    named: {
      key: schema<string>(),
      autoIncrement: true,
      value: schema<unknown>(),
    },
  });

  await t.test("input key can be undefined when autoIncrement is true", async () => {
    const tx = db.tx("numbered", "readwrite");
    const store = tx.store("numbered");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<number | undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<number>();
    deepEqual(await store.add("val1"), 1);
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<number>();
    deepEqual(await store.get(1), "val1");
    await tx.done;
  });

  await t.test("output key includes number when autoIncrement is true", async () => {
    const tx = db.tx("named", "readwrite");
    const store = tx.store("named");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<string | undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<string | number>();
    deepEqual(await store.add("val1"), 1);
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<string | number>();
    deepEqual(await store.get(1), "val1");
    await tx.done;
  });

  db.close();
});

test("inline key and index", async (t) => {
  type NameValue = {
    id: number;
    name: string;
  };
  type DateValue = {
    id: number | string;
    created: Date;
  };
  const db = await openDB("inline-key+index", 1, {
    num2name: {
      keyPath: "id",
      value: schema<NameValue>(),
      indexes: {
        byName: {
          keyPath: "name",
        },
      },
    },
    union2date: {
      keyPath: "id",
      value: schema<DateValue>(),
      indexes: {
        byDate: {
          keyPath: "created",
        },
      },
    },
  });

  await t.test("num key from prop", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<number>();
    deepEqual(await store.add({ id: 1, name: "foo" }), 1);
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<number>();
    deepEqual(await store.get(1), { id: 1, name: "foo" });
    await tx.done;
  });

  await t.test("string index", async () => {
    const tx = db.tx("num2name");
    const store = tx.store("num2name");
    const idx = store.index("byName");
    deepEqual(idx.raw.name, "byName");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    deepEqual(await idx.get("foo"), { id: 1, name: "foo" });
    deepEqual(await idx.getAll(), [{ id: 1, name: "foo" }]);
    expectTypeOf(idx.getAllKeys).returns.resolves.toEqualTypeOf<number[]>();
    deepEqual(await idx.getAllKeys(), [1]);
    await tx.done;
  });

  const now = new Date();

  await t.test("union key from prop", async () => {
    const tx = db.tx("union2date", "readwrite");
    const store = tx.store("union2date");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<number | string>();
    deepEqual(await store.add({ id: 1, created: now }), 1);
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<number | string>();
    deepEqual(await store.get(1), { id: 1, created: now });
    await tx.done;
  });

  await t.test("date index", async () => {
    const tx = db.tx("union2date");
    const store = tx.store("union2date");
    const idx = store.index("byDate");
    deepEqual(idx.raw.name, "byDate");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<Date>();
    deepEqual(await idx.get(now), { id: 1, created: now });
    deepEqual(await idx.getAll(), [{ id: 1, created: now }]);
    expectTypeOf(idx.getAllKeys).returns.resolves.toEqualTypeOf<(string | number)[]>();
    deepEqual(await idx.getAllKeys(), [1]);
    await tx.done;
  });

  await t.test("update", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    const key = await store.update(1, (value) => value && { ...value, name: value.name + "!" });
    deepEqual(key, 1);
    deepEqual(await store.get(1), { id: 1, name: "foo!" });
    await tx.done;
  });

  await t.test("update can create entry", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    const key = await store.update(2, (value) => ({ id: 2, name: (value?.name ?? "new") + "!" }));
    deepEqual(key, 2);
    deepEqual(await store.get(2), { id: 2, name: "new!" });
    await tx.done;
  });

  await t.test("update can delete entry", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    const key = await store.update(2, () => undefined);
    deepEqual(key, undefined);
    deepEqual(await store.getAll(KeyRange.only(2)), []);
    await tx.done;
  });

  await t.test("update does nothing on undefined", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    const key = await store.update(2, () => undefined);
    deepEqual(key, undefined);
    deepEqual(await store.getAll(KeyRange.only(3)), []);
    await tx.done;
  });

  await t.test("deletes old entry if key changed", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    const key = await store.update(1, (value) => value && { ...value, id: 2 });
    deepEqual(key, 2);
    deepEqual(await store.getAll(KeyRange.only(1)), []);
    deepEqual(await store.getAll(KeyRange.only(2)), [{ id: 2, name: "foo!" }]);
    await tx.done;
  });

  await t.test("iterate index", async () => {
    const tx = db.tx("num2name");
    const store = tx.store("num2name");
    const idx = store.index("byName");
    const values: NameValue[] = [];
    for await (const cursor of idx.iterate()) {
      values.push(cursor.value);
    }
    deepEqual(values, [{ id: 2, name: "foo!" }]);
    await tx.done;
  });

  await t.test("watch all by index", async (t) => {
    const ac = new AbortController();
    const cb = t.mock.fn((v: unknown[]) => v);
    const called = whenMockCalled(cb); // increases call count by 2
    const finished = db.watchAllBy("num2name", "byName", KeyRange.lowerBound("b")).forEach(cb, { signal: ac.signal });
    deepEqual(await called, [{ id: 2, name: "foo!" }]);
    deepEqual(cb.mock.calls.length, 2);

    await t.test("add", async () => {
      const called = whenMockCalled(cb);
      await db.put("num2name", { id: 3, name: "bar!" });
      deepEqual(await called, [
        { id: 3, name: "bar!" },
        { id: 2, name: "foo!" },
      ]);
      deepEqual(cb.mock.calls.length, 4);
    });

    await t.test("delete", async () => {
      const called = whenMockCalled(cb);
      await db.delete("num2name", 2);
      deepEqual(await called, [{ id: 3, name: "bar!" }]);
      deepEqual(cb.mock.calls.length, 6);
    });

    // TODO: add unwatched key shouldn't trigger index watcher

    ac.abort();
    await rejects(finished, { name: "AbortError" });
  });

  await t.test("equal index entries are sorted by key", async () => {
    const tx = db.tx("num2name", "readwrite");
    const store = tx.store("num2name");
    await store.add({ id: 100, name: "test" });
    await store.add({ id: 10, name: "test" });
    await store.add({ id: 200, name: "test" });
    await store.add({ id: -1, name: "test" });
    await tx.done;
    deepEqual(await db.getAllBy("num2name", "byName", KeyRange.only("test")), [
      { id: -1, name: "test" },
      { id: 10, name: "test" },
      { id: 100, name: "test" },
      { id: 200, name: "test" },
    ]);
  });

  db.close();
});

test("empty string key and index", async (t) => {
  const db = await openDB("empty-string-key+index", 1, {
    strings: {
      keyPath: "",
      value: schema<string>(),
      indexes: {
        byValue: {
          keyPath: "",
        },
      },
    },
  });

  await t.test("add", async () => {
    const tx = db.tx("strings", "readwrite");
    const store = tx.store("strings");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<string>();
    deepEqual(await store.add("foo"), "foo");
    expectTypeOf(store.put).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.put).returns.resolves.toEqualTypeOf<string>();
    deepEqual(await store.put("bar"), "bar");
    await tx.done;
  });

  await t.test("get by primary key", async () => {
    const tx = db.tx("strings", "readonly");
    const store = tx.store("strings");
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<string>();
    deepEqual(await store.get("foo"), "foo");
    await tx.done;
  });

  await t.test("get by index", async () => {
    const tx = db.tx("strings", "readonly");
    const store = tx.store("strings");
    const idx = store.index("byValue");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    deepEqual(await idx.get("bar"), "bar");
    await tx.done;
  });

  db.close();
});

test("deeply nested key and index", async (t) => {
  const db = await openDB("deeply-nested-key+index", 1, {
    deeplyNested: {
      keyPath: "foo.bar.baz",
      autoIncrement: true,
      value: schema<{ foo: { bar: { baz: string } } }>(),
      indexes: {
        byBaz: {
          keyPath: "foo.bar.baz",
        },
      },
    },
  });

  await t.test("deeply nested key", async () => {
    const tx = db.tx("deeplyNested", "readwrite");
    const store = tx.store("deeplyNested");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.add).returns.resolves.toEqualTypeOf<string | number>();
    deepEqual(await store.add({ foo: { bar: { baz: "1" } } }), "1");
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<string | number>();
    deepEqual(await store.get("1"), { foo: { bar: { baz: "1" } } });
    await tx.done;
  });

  await t.test("deeply nested index", async () => {
    const tx = db.tx("deeplyNested");
    const store = tx.store("deeplyNested");
    const idx = store.index("byBaz");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    deepEqual(await idx.get("1"), { foo: { bar: { baz: "1" } } });
    await tx.done;
  });

  db.close();
});

test("invalid key path", async (t) => {
  type Value = {
    bool: boolean;
    maybeStr?: string | null;
    boolOrNum: boolean | number;
    unknown?: unknown;
  };
  const db = await openDB("invalid-key-path", 1, {
    invalid: {
      keyPath: "doesnt.exist",
      value: schema<Value>(),
      indexes: {
        byBool: {
          keyPath: "bool",
        },
        byMaybeStr: {
          keyPath: "maybeStr",
        },
        byBoolOrNum: {
          keyPath: "boolOrNum",
        },
        byUnknown: {
          keyPath: "unknown",
        },
      },
    },
  });

  await t.test("non existent key path is never", async () => {
    const tx = db.tx("invalid", "readwrite");
    const store = tx.store("invalid");
    expectTypeOf(store.add).parameter(1).toEqualTypeOf<undefined>();
    expectTypeOf(store.add).returns.resolves.toBeNever();
    await rejects(async () => store.add({ bool: false, boolOrNum: 0 }));
    expectTypeOf(store.get).parameter(0).toBeNever();
    expectTypeOf(store.get).returns.resolves.toEqualTypeOf<unknown>();
    await tx.done.catch(() => {});
  });

  await t.test("key path to invalid key value is never", async () => {
    const tx = db.tx("invalid", "readwrite");
    const store = tx.store("invalid");
    const idx = store.index("byBool");
    expectTypeOf(idx.get).parameter(0).toBeNever();
    expectTypeOf(idx.get).returns.resolves.toEqualTypeOf<unknown>();
    await tx.done;
  });

  await t.test("key path to optional value is non-optional", async () => {
    const tx = db.tx("invalid", "readwrite");
    const store = tx.store("invalid");
    const idx = store.index("byMaybeStr");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(idx.get).returns.resolves.toEqualTypeOf<Value>();
    await tx.done;
  });

  await t.test("key path to partially-invalid value extracts valid key types", async () => {
    const tx = db.tx("invalid", "readwrite");
    const store = tx.store("invalid");
    const idx = store.index("byBoolOrNum");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(idx.get).returns.resolves.toEqualTypeOf<Value>();
    await tx.done;
  });

  await t.test("key path to unknown is never (?)", async () => {
    const tx = db.tx("invalid", "readwrite");
    const store = tx.store("invalid");
    const idx = store.index("byUnknown");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<never>();
    expectTypeOf(idx.get).returns.resolves.toEqualTypeOf<unknown>();
    await tx.done;
  });

  db.close();
});

test("special properties", async (t) => {
  const valueSchema = schema<{
    str: string;
    arr: unknown[];
    blob: Blob;
    file: File;
  }>();
  const db = await openDB("special-properties", 1, {
    special: {
      autoIncrement: true,
      value: valueSchema,
      indexes: {
        byStrLen: { keyPath: "str.length" },
        byArrLen: { keyPath: "arr.length" },
        byBlobSize: { keyPath: "blob.size" },
        byFileType: { keyPath: "file.type" },
      },
    },
  });

  const blob = new Blob(["123"], { type: "text/plain" });
  const file = new File(["1234"], "test", { type: "text/plain" });
  await db.add("special", { str: "12", arr: [1], blob, file });

  await t.test("string length index", async () => {
    const tx = db.tx("special", "readwrite");
    const store = tx.store("special");
    const idx = store.index("byStrLen");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<number>();
    deepEqual((await idx.get(2)).str, "12");
    await tx.done;
  });

  await t.test("array length index", async () => {
    const tx = db.tx("special", "readwrite");
    const store = tx.store("special");
    const idx = store.index("byArrLen");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<number>();
    deepEqual((await idx.get(1)).str, "12");
    await tx.done;
  });

  await t.test("blob size index", async () => {
    const tx = db.tx("special", "readwrite");
    const store = tx.store("special");
    const idx = store.index("byBlobSize");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<number>();
    deepEqual((await idx.get(3)).str, "12");
    await tx.done;
  });

  await t.test("file type index", async () => {
    const tx = db.tx("special", "readwrite");
    const store = tx.store("special");
    const idx = store.index("byFileType");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    deepEqual((await idx.get("text/plain")).str, "12");
    await tx.done;
  });

  db.close();
});

test("array key and index", async (t) => {
  type Value = {
    coords: [x: number, y: number];
    label: [title: string, subtitle: string];
  };
  const db = await openDB("array-key+index", 1, {
    points: {
      keyPath: "coords",
      value: schema<Value>(),
      indexes: {
        byLabel: { keyPath: "label" },
      },
    },
  });

  const value: Value = { coords: [1, 2], label: ["foo", "bar"] };
  deepEqual(await db.add("points", value), [1, 2]);

  await t.test("array key", async () => {
    const tx = db.tx("points", "readonly");
    const store = tx.store("points");
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<[number, number]>();
    deepEqual(await store.get([1, 2]), value);
    expectTypeOf(store.getAll).parameter(0).toEqualTypeOf<KeyRange<[number, number]> | null | undefined>();
    deepEqual(await store.getAll(KeyRange.lowerBound([1, -Infinity])), [value]);
    expectTypeOf(store.getAllKeys).parameter(0).toEqualTypeOf<KeyRange<[number, number]> | null | undefined>();
    deepEqual(await store.getAllKeys(KeyRange.upperBound([1, Infinity])), [[1, 2]]);
    await tx.done;
    expectTypeOf(db.get<"points">)
      .parameter(1)
      .toEqualTypeOf<[number, number]>();
    deepEqual(await db.get("points", [1, 2]), value);
    expectTypeOf(db.getAll<"points">)
      .parameter(1)
      .toEqualTypeOf<KeyRange<[number, number]> | null | undefined>();
    deepEqual(await db.getAll("points", KeyRange.bound([1, -Infinity], [1, Infinity])), [value]);
  });

  await t.test("array index", async () => {
    const tx = db.tx("points", "readonly");
    const store = tx.store("points");
    const idx = store.index("byLabel");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<[string, string]>();
    deepEqual(await idx.get(["foo", "bar"]), value);
    expectTypeOf(idx.getAll).parameter(0).toEqualTypeOf<KeyRange<[string, string]> | null | undefined>();
    deepEqual(await idx.getAll(KeyRange.bound(["foo", ""], ["foo", "\uFFFF"])), [value]);
    expectTypeOf(idx.getAllKeys).parameter(0).toEqualTypeOf<KeyRange<[string, string]> | null | undefined>();
    deepEqual(await idx.getAllKeys(KeyRange.bound(["a", ""], ["z", "\uFFFF"])), [[1, 2]]);
    await tx.done;
    expectTypeOf(db.getAllBy<"points", "byLabel">)
      .parameter(2)
      .toEqualTypeOf<KeyRange<[string, string]> | null | undefined>();
    deepEqual(await db.getAllBy("points", "byLabel", KeyRange.bound(["foo", ""], ["foo", "\uFFFF"])), [value]);
  });

  db.close();
});

test("compound key and index", async (t) => {
  type Value = {
    x: number;
    y: number;
    title: string;
    subtitle: string;
  };
  const db = await openDB("compound-key+index", 1, {
    points: {
      keyPath: ["x", "y"],
      value: schema<Value>(),
      indexes: {
        byLabel: { keyPath: ["title", "subtitle"] },
      },
    },
  });

  const value: Value = { x: 1, y: 2, title: "foo", subtitle: "bar" };
  await db.put("points", value);

  await t.test("compound key", async () => {
    const tx = db.tx("points", "readonly");
    const store = tx.store("points");
    expectTypeOf(store.get).parameter(0).toEqualTypeOf<[number, number]>();
    deepEqual(await store.get([1, 2]), value);
    deepEqual(await store.getAll(KeyRange.only([1, 2])), [value]);
    deepEqual(await store.getAllKeys(KeyRange.only([1, 2])), [[1, 2]]);
    await tx.done;
    expectTypeOf(db.get<"points">)
      .parameter(1)
      .toEqualTypeOf<[number, number]>();
    deepEqual(await db.get("points", [1, 2]), value);
    deepEqual(await db.getAll("points", KeyRange.only([1, 2])), [value]);
  });

  await t.test("compound index", async () => {
    const tx = db.tx("points", "readonly");
    const store = tx.store("points");
    const idx = store.index("byLabel");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<readonly [string, string]>();
    deepEqual(await idx.get(["foo", "bar"]), value);
    deepEqual(await idx.getAll(KeyRange.only(["foo", "bar"])), [value]);
    deepEqual(await idx.getAllKeys(KeyRange.only(["foo", "bar"])), [[1, 2]]);
    await tx.done;
    expectTypeOf(db.getAllBy<"points", "byLabel">)
      .parameter(2)
      .toEqualTypeOf<KeyRange<readonly [string, string]> | null | undefined>();
    deepEqual(await db.getAllBy("points", "byLabel", KeyRange.only(["foo", "bar"])), [value]);
  });

  db.close();
});

test("multi entry index", async (t) => {
  type Value = {
    id: string;
    tags: string[];
    category?: null | number | number[];
    path: [string, number];
  };
  const db = await openDB("multi-entry-index", 1, {
    posts: {
      keyPath: "id",
      value: schema<Value>(),
      indexes: {
        byTag: { keyPath: "tags", multiEntry: true },
        byCategory: { keyPath: "category", multiEntry: true },
        byPath: { keyPath: "path", multiEntry: true },
      },
    },
  });

  const value: Value = { id: "1", tags: ["foo"], category: 1, path: ["bar", 2] };
  deepEqual(await db.add("posts", value), "1");

  await t.test("multi entry index flattens array type", async () => {
    const tx = db.tx("posts", "readwrite");
    const store = tx.store("posts");
    const idx = store.index("byTag");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string>();
    deepEqual(await idx.get("foo"), value);
    await tx.done;
    expectTypeOf(db.getAllBy<"posts", "byTag">)
      .parameter(2)
      .toEqualTypeOf<KeyRange<string> | null | undefined>();
    deepEqual(await db.getAllBy("posts", "byTag", KeyRange.only("foo")), [value]);
  });

  await t.test("multi entry index of maybe-array flattens array type", async () => {
    const tx = db.tx("posts", "readwrite");
    const store = tx.store("posts");
    const idx = store.index("byCategory");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<number>();
    deepEqual(await idx.get(1), value);
    await tx.done;
    expectTypeOf(db.getAllBy<"posts", "byCategory">)
      .parameter(2)
      .toEqualTypeOf<KeyRange<number> | null | undefined>();
    deepEqual(await db.getAllBy("posts", "byCategory", KeyRange.only(1)), [value]);
  });

  await t.test("multi entry index of tuple", async () => {
    const tx = db.tx("posts", "readwrite");
    const store = tx.store("posts");
    const idx = store.index("byPath");
    expectTypeOf(idx.get).parameter(0).toEqualTypeOf<string | number>();
    deepEqual(await idx.get("bar"), value);
    deepEqual(await idx.get(2), value);
    await tx.done;
    expectTypeOf(db.getAllBy<"posts", "byPath">)
      .parameter(2)
      .toEqualTypeOf<KeyRange<string | number> | null | undefined>();
    deepEqual(await db.getAllBy("posts", "byPath", KeyRange.only("bar")), [value]);
  });

  db.close();
});

test("multi entry compound index", async () => {
  type Value = { nums: number[]; strs: string[] };
  // Disallowed by spec.
  await rejects(async () =>
    openDB("multi-entry-compound-index", 1, {
      things: {
        key: schema<number>(),
        value: schema<Value>(),
        indexes: {
          byValue: { keyPath: ["strs", "nums"], multiEntry: true },
        },
      },
    }),
  );
});
