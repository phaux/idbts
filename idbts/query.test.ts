import "fake-indexeddb/auto";
import "observable-polyfill";

import { deepEqual } from "assert/strict";
import { expectTypeOf } from "expect-type";
import { test } from "node:test";
import { type DatabaseSchemaOf, KeyRange, openDB, schema } from "./index.ts";
import { query, type QueryFilter, type QueryParam } from "./query.ts";

test("simple store query", async (t) => {
  const db = await openDB("query-simple", 1, {
    items: {
      value: schema<{ name: string; age: number }>(),
      key: schema<number>(),
      indexes: {
        byName: { keyPath: "name" },
        byAge: { keyPath: "age" },
        byNameAndAge: { keyPath: ["name", "age"] },
      },
    },
  });

  {
    const tx = db.tx("items", "readwrite");
    tx.store("items").add({ name: "Kazik", age: 30 }, 1);
    tx.store("items").add({ name: "Zenek", age: 40 }, 3);
    tx.store("items").add({ name: "Halina", age: 35 }, 5);
    tx.store("items").add({ name: "Halina", age: 35 }, 100);
    await tx.done;
  }

  expectTypeOf(query<DatabaseSchemaOf<typeof db>["items"]>)
    .parameter(1)
    .toEqualTypeOf<
      | QueryParam<
          undefined,
          number,
          | QueryFilter<"name", string>
          | QueryFilter<"age", number>
          | QueryFilter<readonly ["name", "age"], readonly [string, number]>
        >
      | QueryParam<"name", string, never>
      | QueryParam<"age", number, never>
      | QueryParam<readonly ["name", "age"], readonly [string, number], never>
    >();

  await t.test("get one by key", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), { by: undefined, range: KeyRange.only(1) });
    deepEqual(result, [{ name: "Kazik", age: 30 }]);
    await tx.done;
  });

  await t.test("get key range", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), {
      by: undefined,
      range: KeyRange.bound(2, 4),
    });
    deepEqual(result, [{ name: "Zenek", age: 40 }]);
    await tx.done;
  });

  await t.test("get one by index", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), { by: "name", range: KeyRange.only("Zenek") });
    deepEqual(result, [{ name: "Zenek", age: 40 }]);
    await tx.done;
  });

  await t.test("get index range 1", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), {
      by: "name",
      range: KeyRange.bound("I", "Y", true, true),
    });
    deepEqual(result, [{ name: "Kazik", age: 30 }]);
    await tx.done;
  });

  await t.test("get index range 2", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), {
      by: "age",
      range: KeyRange.bound(30, 40, true, true),
    });
    deepEqual(result, [
      { name: "Halina", age: 35 },
      { name: "Halina", age: 35 },
    ]);
    await tx.done;
  });

  await t.test("filter by indexes", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), {
      by: undefined,
      where: [
        ["name", "eq", "Halina"],
        ["age", "eq", 35],
      ],
    });
    deepEqual(result, [
      { name: "Halina", age: 35 },
      { name: "Halina", age: 35 },
    ]);
    await tx.done;
  });

  // await t.test("get range and filter by indexes", async () => {
  //   const tx = db.tx("items", "readonly");
  //   const result = await query(tx.store("items"), {
  //     by: undefined,
  //     where: [
  //       ["name", "eq", "Halina"],
  //       ["age", "eq", 35],
  //     ],
  //     range: KeyRange.upperBound(10),
  //   });
  //   deepEqual(result, [{ name: "Halina", age: 35 }]);
  //   await tx.done;
  // });

  await t.test("get composite index range", async () => {
    const tx = db.tx("items", "readonly");
    const result = await query(tx.store("items"), {
      by: ["name", "age"],
      range: KeyRange.bound(["I", 30], ["Y", 40], true, true),
    });
    deepEqual(result, [{ name: "Kazik", age: 30 }]);
    await tx.done;
  });

  db.close();
});
