/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { expectTypeOf } from "expect-type";
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { suite, test } from "node:test";
import { z } from "zod";
import { SchemaValidationError } from "../src/Database.ts";
import { openDB } from "../src/openDB.ts";
import { schema } from "../src/schema.ts";

await suite("Database", { concurrency: true }, async () => {
  await test("inline key and index", async (t) => {
    interface NameRecord {
      readonly id: number;
      readonly name: string;
    }
    interface DateRecord {
      readonly id: number | string;
      readonly created: Date;
    }
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
      await db.update("num2name", 2, () => ({ id: 2, name: "new?" }));
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new?" });
    });

    await t.test("upsert", async () => {
      await db.upsert("num2name", { id: 1, name: "foo!" });
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo!" });
      await db.upsert("num2name", { id: 3, name: "another!" });
      deepEqual(await db.get("num2name", 3), { id: 3, name: "another!" });
    });

    await t.test("upsert many", async () => {
      await db.upsert(
        "num2name",
        [
          { id: 1, name: "foo?" },
          { id: 2, name: "new?" },
        ],
        (oldValue, newValue) => ({ id: oldValue.id, name: newValue.name + "!" }),
      );
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo?!" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new?!" });
    });

    await t.test("upsert many rollbacks if updater throws", async () => {
      await rejects(async () =>
        db.upsert(
          "num2name",
          [
            { id: 1, name: "foo~" },
            { id: 2, name: "new~" },
          ],
          (oldValue, newValue) => {
            if (oldValue.id === 2) {
              throw new Error("fail");
            }
            return { id: oldValue.id, name: newValue.name + "!" };
          },
        ),
      );
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo?!" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new?!" });
    });

    await t.test("upsert throws if key changed", async () => {
      await rejects(async () =>
        db.upsert("num2name", { id: 1, name: "foo!" }, (oldValue, newValue) => ({
          ...oldValue,
          ...newValue,
          id: 2,
        })),
      );
    });

    await t.test("update many", async () => {
      await db.update("num2name", [1, 2], (value) => ({ id: value!.id, name: value!.name + "?" }));
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo?!?" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new?!?" });
    });

    await t.test("update many rollbacks if one fails", async () => {
      await rejects(async () =>
        db.update("num2name", [1, 2], (value) => {
          if (value!.id === 2) {
            throw new Error("fail");
          }
          return { id: value!.id, name: value!.name + "." };
        }),
      );
      deepEqual(await db.get("num2name", 1), { id: 1, name: "foo?!?" });
      deepEqual(await db.get("num2name", 2), { id: 2, name: "new?!?" });
    });

    await t.test("update can delete entry", async () => {
      await db.update("num2name", 2, () => undefined);
      deepEqual(await db.get("num2name", 2), undefined);
    });

    await t.test("update throws if key changed", async () => {
      await rejects(async () => db.update("num2name", 1, (value) => ({ ...value!, id: 2 })));
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

  await test("deeply nested key and index", async (t) => {
    interface Record {
      foo: { bar: { baz: string } };
    }
    const db = await openDB("deeply-nested-key+index", 1, {
      deeplyNested: {
        keyPath: "foo.bar.baz",
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
      await rejects(async () =>
        db.update("deeplyNested", "1", (value) => ({
          foo: { bar: { baz: value!.foo.bar.baz + "!" } },
        })),
      );
    });

    await t.test("insert fails with missing value at key path", async () => {
      await rejects(async () => db.insert("deeplyNested", { foo: { bar: {} } } as any), {
        name: "DataError",
      });
    });

    await t.test("upsert fails with missing value at key path", async () => {
      await rejects(async () => db.upsert("deeplyNested", { foo: { bar: {} } } as any), {
        name: "DataError",
      });
      await rejects(
        async () =>
          db.upsert("deeplyNested", { foo: { bar: { baz: "1" } } }, () => ({ foo: "wtf" }) as any),
        { name: "DataError" },
      );
    });

    await t.test("update fails with missing value at key path", async () => {
      await rejects(
        async () => db.update("deeplyNested", "1", () => ({ foo: { bar: null } }) as any),
        {
          name: "DataError",
        },
      );
    });

    db.idb.close();
  });

  await test("invalid key path - missing", async () => {
    const db = await openDB("missing-key-path", 1, {
      invalid: {
        keyPath: "doesnt.exist",
        value: schema<object>(),
      },
    });

    await rejects(async () => db.insert("invalid", {}));

    expectTypeOf(db.get<"invalid">)
      .parameter(1)
      .toEqualTypeOf<never>();

    db.idb.close();
  });

  await test("invalid key path - boolean", async () => {
    interface Record {
      foo: boolean;
    }
    const db = await openDB("boolean-key-path", 1, {
      invalid: {
        keyPath: "foo",
        value: schema<Record>(),
      },
    });

    await rejects(async () => db.insert("invalid", { foo: true }));

    expectTypeOf(db.get<"invalid">)
      .parameter(1)
      .toEqualTypeOf<never>();

    db.idb.close();
  });

  await test("special properties - string", async () => {
    interface Record {
      str: string;
    }
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

  await test("special properties - array", async () => {
    interface Record {
      arr: boolean[];
    }
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

  await test("array key", async (t) => {
    interface Record {
      coords: [x: number, y: number];
      name?: string;
    }
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
      await rejects(async () =>
        db.update("points", [[1, 2]], (value) => ({
          coords: [value!.coords[0] + 1, value!.coords[1] + 1],
        })),
      );
    });

    db.idb.close();
  });

  await test("compound key", async (t) => {
    interface Record {
      x: number;
      y: number;
      name?: string;
    }
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
      await rejects(async () =>
        db.update("points", [[1, 2]], (value) => ({
          x: value!.x + 1,
          y: value!.y + 1,
        })),
      );
    });

    db.idb.close();
  });

  await test("schema validation with zod", async (t) => {
    const userSchema = z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      age: z.number().int().min(0),
    });

    type User = z.infer<typeof userSchema>;

    const db = await openDB("zod-validation", 1, {
      users: {
        value: userSchema,
        keyPath: "id",
      },
    });

    await t.test("insert valid value succeeds", async () => {
      await db.insert("users", { id: 1, name: "Alice", age: 30 });
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice", age: 30 });
    });

    await t.test("insert invalid value throws SchemaValidationError", async () => {
      await rejects(
        async () => db.insert("users", { id: 2, name: "", age: 30 }),
        (err) => {
          ok(err instanceof SchemaValidationError, "error should be SchemaValidationError");
          ok(err.issues.length > 0, "error should have issues");
          return true;
        },
      );
    });

    await t.test("insert rolls back on validation failure", async () => {
      await rejects(async () =>
        db.insert("users", [
          { id: 10, name: "Valid", age: 25 },
          { id: 11, name: "", age: 25 },
        ]),
      );
      deepEqual(await db.get("users", 10), undefined);
      deepEqual(await db.get("users", 11), undefined);
    });

    await t.test("upsert valid value succeeds", async () => {
      await db.upsert("users", { id: 1, name: "Alice Updated", age: 31 });
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice Updated", age: 31 });
    });

    await t.test("upsert invalid value throws SchemaValidationError", async () => {
      await rejects(
        async () => db.upsert("users", { id: 1, name: "", age: 31 }),
        SchemaValidationError,
      );
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice Updated", age: 31 });
    });

    await t.test("upsert with updater validates result", async () => {
      await rejects(
        async () =>
          db.upsert("users", { id: 1, name: "Alice", age: 31 }, (old) => ({
            ...old,
            name: "",
            age: -1,
          })),
        SchemaValidationError,
      );
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice Updated", age: 31 });
    });

    await t.test("update invalid value throws SchemaValidationError", async () => {
      await rejects(
        async () => db.update("users", 1, (old) => ({ ...old!, name: "", age: -5 })),
        (err) => {
          ok(err instanceof SchemaValidationError, "error should be SchemaValidationError");
          ok(err.issues.length > 0, "error should have issues");
          return true;
        },
      );
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice Updated", age: 31 });
    });

    await t.test("update valid value succeeds", async () => {
      await db.update("users", 1, (old) => ({ ...old!, age: old!.age + 1 }));
      deepEqual(await db.get("users", 1), { id: 1, name: "Alice Updated", age: 32 });
    });

    await t.test("no-op schema skips validation", async () => {
      const db2 = await openDB("zod-noop", 1, {
        items: {
          value: schema<User>(),
          keyPath: "id",
        },
      });
      await db2.insert("items", { id: 99, name: "", age: -1 });
      deepEqual(await db2.get("items", 99), { id: 99, name: "", age: -1 });
      db2.idb.close();
    });

    db.idb.close();
  });

  await test("InferInput vs InferOutput types with transform schema", async (t) => {
    // A schema where Input and Output are different types.
    interface UserInput {
      id: number;
      rawName: string;
    }
    interface UserOutput {
      id: string;
      name: string;
    }

    const transformSchema: StandardSchemaV1<UserInput, UserOutput> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (v) => {
          const input = v as UserInput;
          return { value: { id: String(input.id), name: input.rawName.trim() } };
        },
      },
    };

    const db = await openDB("transform-schema-types", 1, {
      users: {
        value: transformSchema,
        keyPath: "id",
      },
    });

    // insert and upsert accept InferInput
    expectTypeOf(db.insert<"users">)
      .parameter(1)
      .toEqualTypeOf<Readonly<UserInput> | readonly Readonly<UserInput>[]>();

    expectTypeOf(db.upsert<"users">)
      .parameter(1)
      .toEqualTypeOf<Readonly<UserInput> | readonly Readonly<UserInput>[]>();

    // get and getAll return InferOutput
    expectTypeOf(db.get<"users">).returns.resolves.toEqualTypeOf<
      Readonly<UserOutput> | undefined
    >();

    expectTypeOf(db.getAll<"users">).returns.resolves.toEqualTypeOf<Readonly<UserOutput>[]>();

    // update: updater receives InferOutput (old value from DB), returns InferInput | undefined
    const updateType = expectTypeOf(db.update<"users">);
    const updateUpdater = updateType.parameter(2);
    updateUpdater.parameter(0).toEqualTypeOf<Readonly<UserOutput> | undefined>();
    updateUpdater.returns.toEqualTypeOf<Readonly<UserInput> | undefined>();

    // upsert: updater receives InferOutput, returns InferInput
    const upsertType = expectTypeOf(db.upsert<"users">);
    const upsertUpdater = upsertType.parameter(2);
    upsertUpdater.parameter(0).toEqualTypeOf<Readonly<UserOutput>>();
    upsertUpdater.parameter(1).toEqualTypeOf<Readonly<UserOutput>>();
    upsertUpdater.returns.toEqualTypeOf<Readonly<UserInput>>();

    // primary key type is derived from InferOutput
    expectTypeOf(db.get<"users">)
      .parameter(1)
      .toEqualTypeOf<string>();

    // Verify runtime behavior
    await t.test("insert transforms input to output", async () => {
      await db.insert("users", { id: 1, rawName: "  Alice  " });
      deepEqual(await db.get("users", "1"), { id: "1", name: "Alice" });
    });

    await t.test("update transforms input to output", async () => {
      await db.update("users", "1", (oldValue) => ({
        id: Number(oldValue!.id satisfies string),
        rawName: oldValue!.name + "!",
      }));
      deepEqual(await db.get("users", "1"), { id: "1", name: "Alice!" });
    });

    await t.test("upsert transforms input to output", async () => {
      await db.upsert("users", { id: 1, rawName: "  Alice  " }, (oldValue, newValue) => ({
        id: Number(oldValue.id satisfies string),
        rawName: newValue.name,
      }));
      deepEqual(await db.get("users", "1"), { id: "1", name: "Alice" });
    });

    await t.test("update rejects if key of transformed value changed", async () => {
      await rejects(
        async () =>
          db.update("users", "1", (oldValue) => ({
            id: Number(oldValue!.id satisfies string) + 1,
            rawName: oldValue!.name,
          })),
        (err) => {
          ok(err instanceof DOMException);
          equal(err.name, "InvalidStateError");
          return true;
        },
      );
    });

    await t.test("upsert rejects if key of transformed value changed", async () => {
      await rejects(
        async () =>
          db.upsert("users", { id: 1, rawName: "Bob" }, (oldValue, newValue) => ({
            id: Number(oldValue.id satisfies string) + 1,
            rawName: newValue.name,
          })),
        (err) => {
          ok(err instanceof DOMException);
          equal(err.name, "InvalidStateError");
          return true;
        },
      );
    });

    db.idb.close();
  });
});
