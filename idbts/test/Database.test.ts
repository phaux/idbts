import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { suite, test } from "node:test";
import { openDB } from "../src/openDB.ts";
import { schema } from "../src/StandardSchema.ts";

suite("Database", { concurrency: true }, () => {
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
      await db.insert("union2date", [
        { id: 1, created: now },
        { id: "two", created: now },
      ]);
      expectTypeOf(db.get<"union2date">)
        .parameter(1)
        .toEqualTypeOf<number | string>();
      deepEqual(await db.get("union2date", 1), { id: 1, created: now });
      expectTypeOf(db.getAll<"union2date">).returns.resolves.toEqualTypeOf<DateRecord[]>();
      deepEqual(await db.getAll("union2date"), [
        { id: 1, created: now },
        { id: "two", created: now },
      ]);
    });

    await t.test("update name", async () => {
      const type = expectTypeOf(db.update<"num2name">);
      type.parameter(1).toEqualTypeOf<number | readonly number[]>();
      const updater = type.parameter(2);
      updater.parameter(0).toEqualTypeOf<Readonly<NameRecord> | undefined>();
      updater.returns.toEqualTypeOf<Readonly<NameRecord> | undefined>();
      await db.update("num2name", 1, (value) => ({ ...value!, name: value!.name + "!" }));
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo!" });
    });

    await t.test("update can create entry", async () => {
      deepEqual(await db.get("num2name", 2), undefined);
      await db.update("num2name", 2, () => ({ id: 2, name: "new!" }));
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new!" });
    });

    await t.test("update many", async () => {
      await db.update("num2name", [1, 2], (value) => ({ id: value!.id, name: value!.name + "?" }));
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo!?" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new!?" });
    });

    await t.test("update many rollbacks if one fails", async () => {
      await rejects(() =>
        db.update("num2name", [1, 2], (value) => {
          if (value!.id === 2) {
            throw new Error("fail");
          }
          return { id: value!.id, name: value!.name + "." };
        }),
      );
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo!?" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new!?" });
    });

    await t.test("update can delete entry", async () => {
      await db.update("num2name", 2, () => undefined);
      deepEqual(await db.get("num2name", 2), undefined);
    });

    await t.test("update throws if key changed", async () => {
      await rejects(() => db.update("num2name", 1, (value) => ({ ...value!, id: 2 })));
    });

    await t.test("delete", async () => {
      expectTypeOf(db.delete<"union2date">)
        .parameter(1)
        .toEqualTypeOf<number | string | readonly (number | string)[]>();
      await db.delete("union2date", 1);
      deepEqual(await db.get("union2date", 1), undefined);
    });

    await t.test("delete non-existing", async () => {
      await db.delete("union2date", 123);
    });

    await t.test("delete all", async () => {
      await db.clear("union2date");
      deepEqual(await db.getAll("union2date"), []);
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

  test("invalid key path - missing", async () => {
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

  test("invalid key path - boolean", async () => {
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

  test("special properties - string", async () => {
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

  test("special properties - array", async () => {
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
      name?: string;
    };
    const db = await openDB("array-key", 1, {
      points: {
        value: schema<Record>(),
        keyPath: "coords",
      },
    });

    await t.test("insert and get", async () => {
      await db.insert("points", [{ coords: [1, 2] }, { coords: [3, 4] }]);
      expectTypeOf(db.get<"points">)
        .parameter(1)
        .toEqualTypeOf<[number, number]>();
      deepEqual(await db.get("points", [1, 2]), { coords: [1, 2] });
    });

    await t.test("update", async () => {
      const type = expectTypeOf(db.update<"points">);
      type.parameter(1).toEqualTypeOf<readonly [number, number][]>();
      const updater = type.parameter(2);
      updater.parameter(0).toEqualTypeOf<Readonly<Record> | undefined>();
      updater.returns.toEqualTypeOf<Readonly<Record> | undefined>();
      await db.update("points", [[1, 2]], (value) => ({ coords: value!.coords, name: "point" }));
      deepEqual(await db.get("points", [1, 2]), { coords: [1, 2], name: "point" });
    });

    await t.test("update many", async () => {
      await db.update(
        "points",
        [
          [1, 2],
          [3, 4],
        ],
        (value) => ({ coords: value!.coords, name: "updated" }),
      );
      deepEqual(await db.get("points", [1, 2]), { coords: [1, 2], name: "updated" });
      deepEqual(await db.get("points", [3, 4]), { coords: [3, 4], name: "updated" });
    });

    await t.test("update throws if key changed", async () => {
      await rejects(() =>
        db.update("points", [[1, 2]], (value) => ({
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
      name?: string;
    };
    const db = await openDB("compound-key", 1, {
      points: {
        value: schema<Record>(),
        keyPath: ["x", "y"],
      },
    });

    await t.test("insert and get", async () => {
      await db.insert("points", [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]);
      expectTypeOf(db.get<"points">)
        .parameter(1)
        .toEqualTypeOf<readonly [number, number]>();
      deepEqual(await db.get("points", [1, 2]), { x: 1, y: 2 });
    });

    await t.test("update", async () => {
      const type = expectTypeOf(db.update<"points">);
      type.parameter(1).toEqualTypeOf<readonly (readonly [number, number])[]>();
      const updater = type.parameter(2);
      updater.parameter(0).toEqualTypeOf<Readonly<Record> | undefined>();
      updater.returns.toEqualTypeOf<Readonly<Record> | undefined>();
      await db.update("points", [[1, 2]], (value) => ({ x: value!.x, y: value!.y, name: "point" }));
      deepEqual(await db.get("points", [1, 2]), { x: 1, y: 2, name: "point" });
    });

    await t.test("update many", async () => {
      await db.update(
        "points",
        [
          [1, 2],
          [3, 4],
        ],
        (value) => ({ x: value!.x, y: value!.y, name: "updated" }),
      );
      deepEqual(await db.get("points", [1, 2]), { x: 1, y: 2, name: "updated" });
      deepEqual(await db.get("points", [3, 4]), { x: 3, y: 4, name: "updated" });
    });

    await t.test("update throws if key changed", async () => {
      await rejects(() =>
        db.update("points", [[1, 2]], (value) => ({
          x: value!.x + 1,
          y: value!.y + 1,
        })),
      );
    });

    db.idb.close();
  });
});
