import "fake-indexeddb/auto";
import "observable-polyfill";

import { deepEqual, rejects } from "node:assert/strict";
import { test } from "node:test";
import { KeyRange, openDB, schema } from "./index.ts";
import { primaryKey, query } from "./query.ts";

test("simple store query", async (t) => {
  type Item = {
    name: { first: string; last: string };
    age: number;
    points: number;
  };

  const db = await openDB("query-simple", 1, {
    items: {
      value: schema<Item>(),
      key: schema<number>(),
      indexes: {
        byFirstName: { keyPath: "name.first" },
        byLastName: { keyPath: "name.last" },
        byName: { keyPath: ["name.first", "name.last"] },
        byName2: { keyPath: ["name.last", "name.first"] },
        byPoints: { keyPath: "points" },
        byFirstNameAndPoints: { keyPath: ["name.first", "points"] },
        byLastNameAndPoints: { keyPath: ["name.last", "points"] },
        byNameAndAge: { keyPath: ["name.first", "name.last", "age"] },
      },
    },
  });

  const data = [
    /*  0:  1 */ { name: { first: "Alicja", last: "Nowak" }, age: 30, points: 1420 },
    /*  1:  3 */ { name: { first: "Wojciech", last: "Kowalski" }, age: 40, points: 1312 },
    /*  2:  5 */ { name: { first: "Maciej", last: "Nowak" }, age: 55, points: 1210 },
    /*  3:  7 */ { name: { first: "Ewa", last: "Wieczorek" }, age: 28, points: 850 },
    /*  4:  9 */ { name: { first: "Anna", last: "Sobczak" }, age: 31, points: 980 },
    /*  5: 11 */ { name: { first: "Nadzieja", last: "Dudek" }, age: 22, points: 1312 },
    /*  6: 13 */ { name: { first: "Piotr", last: "Dudek" }, age: 25, points: 1515 },
    /*  7: 15 */ { name: { first: "Bożena", last: "Majewska" }, age: 45, points: 1002 },
    /*  8: 17 */ { name: { first: "Piotr", last: "Nowak" }, age: 15, points: 1500 },
    /*  9: 19 */ { name: { first: "Sławomir", last: "Kowalski" }, age: 29, points: 900 },
    /* 10: 21 */ { name: { first: "Radosław", last: "Wieczorek" }, age: 31, points: 1010 },
    /* 11: 23 */ { name: { first: "Anna", last: "Majewska" }, age: 42, points: 1440 },
    /* 12: 25 */ { name: { first: "Maciej", last: "Nowak" }, age: 35, points: 810 },
    /* 13: 27 */ { name: { first: "Paweł", last: "Sobczak" }, age: 27, points: 1100 },
    /* 14: 29 */ { name: { first: "Paweł", last: "Nowak" }, age: 38, points: 1210 },
  ] as const satisfies ReadonlyArray<Item>;

  {
    const tx = db.tx("items", "readwrite");
    const store = tx.store("items");
    for (const [index, value] of data.entries()) {
      // Keys are odd numbers starting from 1
      store.add(value, index * 2 + 1);
    }
    await tx.done;
  }

  await t.test("get all", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(await query(tx.store("items"), {}), data);
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(await query(tx.store("items"), { direction: "prev" }), [...data].reverse());
      await tx.done;
    });

    await t.test("with offset", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(await query(tx.store("items"), { offset: 5 }), data.slice(5));
      await tx.done;
    });

    await t.test("with limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(await query(tx.store("items"), { limit: 5 }), data.slice(0, 5));
      await tx.done;
    });

    await t.test("with offset and limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(await query(tx.store("items"), { offset: 3, limit: 5 }), data.slice(3, 8));
      await tx.done;
    });

    await t.test("with offset and limit reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), { offset: 3, limit: 5, direction: "prev" }),
        data.toReversed().slice(3, 8),
      );
      await tx.done;
    });
  });

  await t.test("get all ordered", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), { orderBy: "name.first" }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)),
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), { orderBy: "name.first", direction: "prev" }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).reverse(),
      );
      await tx.done;
    });

    await t.test("with offset and limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), { orderBy: "name.first", offset: 3, limit: 5 }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).slice(3, 8),
      );
      await tx.done;
    });

    await t.test("with offset and limit reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), { orderBy: "name.first", offset: 3, limit: 5, direction: "prev" }),
        data
          .toSorted((a, b) => a.name.first.localeCompare(b.name.first))
          .reverse()
          .slice(3, 8),
      );
      await tx.done;
    });

    await t.test("on missing index for order throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(() =>
        query(tx.store("items"), {
          orderBy: "age",
        }),
      );
      await tx.done;
    });
  });

  await t.test("get by key equality", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(1) },
        }),
        [data[0]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(15) },
        }),
        [data[7]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(10) },
        }),
        [],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(1) },
          direction: "prev",
        }),
        [data[0]],
      );
      await tx.done;
    });

    await t.test("with limit and offset", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(3) },
          offset: 0,
          limit: 1,
        }),
        [data[1]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(5) },
          offset: 1,
        }),
        [],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.only(5) },
          limit: 0,
        }),
        [],
      );
    });

    await t.test("with order throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: { [primaryKey]: KeyRange.only(7) },
            orderBy: "points",
          }),
        { message: "Primary key filter cannot use sorting." },
      );
      await rejects(
        () =>
          query(tx.store("items"), {
            where: { [primaryKey]: KeyRange.only(9) },
            orderBy: "name.first",
            direction: "prev",
          }),
        { message: "Primary key filter cannot use sorting." },
      );
      await tx.done;
    });

    await t.test("with other filters throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: {
              [primaryKey]: KeyRange.only(1),
              "name.first": KeyRange.only("Alicja"),
            },
          }),
        { message: "Primary key equality filter cannot be combined with other filters." },
      );
      await tx.done;
    });
  });

  await t.test("get by key range", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.bound(9, 13) },
        }),
        [data[4], data[5], data[6]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.upperBound(5) },
        }),
        [data[0], data[1], data[2]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.lowerBound(25, true) },
        }),
        [data[13], data[14]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.lowerBound(999) },
        }),
        [],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.bound(13, 17) },
          direction: "prev",
        }),
        [data[8], data[7], data[6]],
      );
      await tx.done;
    });

    await t.test("with offset and limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.bound(3, 12) },
          offset: 2,
          limit: 3,
        }),
        [data[3], data[4], data[5]],
      );
      await tx.done;
    });

    await t.test("with offset and limit reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { [primaryKey]: KeyRange.bound(4, 16) },
          offset: 2,
          limit: 2,
          direction: "prev",
        }),
        [data[5], data[4]],
      );
      await tx.done;
    });

    await t.test("with order throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: { [primaryKey]: KeyRange.bound(3, 12) },
            orderBy: "name.first",
          }),
        { message: "Primary key filter cannot use sorting." },
      );
      await tx.done;
    });

    await t.test("with field range filter throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: {
              [primaryKey]: KeyRange.bound(3, 12),
              "name.first": KeyRange.bound("A", "M"),
            },
          }),
        { message: "Primary key range filter cannot be combined with other range filters." },
      );
      await tx.done;
    });
  });

  await t.test("get by field equality", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.only("Piotr") },
        }),
        [data[6], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.last": KeyRange.only("Nowak") },
        }),
        [data[0], data[2], data[8], data[12], data[14]],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.only("Piotr") },
          direction: "prev",
        }),
        [data[8], data[6]],
      );
      await tx.done;
    });

    await t.test("with order", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.only("Piotr") },
          orderBy: "name.first",
        }),
        [data[6], data[8]],
      );
      await tx.done;
    });

    await t.test("with mismatched order throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        query(tx.store("items"), {
          where: { "name.last": KeyRange.only("Nowak") },
          orderBy: "name.first",
        }),
        { message: "Sorting field must match filter field." },
      );
      await tx.done;
    });

    await t.test("with offset", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.last": KeyRange.only("Nowak") },
          offset: 3,
        }),
        [data[12], data[14]],
      );
      await tx.done;
    });

    await t.test("with limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.last": KeyRange.only("Nowak") },
          limit: 3,
        }),
        [data[0], data[2], data[8]],
      );
      await tx.done;
    });

    await t.test("on missing index throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: { age: KeyRange.only(30) },
          }),
        { message: "Index for age not found." },
      );
      await tx.done;
    });
  });

  await t.test("get by field range", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
        }),
        [data[13], data[14], data[6], data[8], data[10], data[9]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.last": KeyRange.lowerBound("P", true) },
        }),
        [data[4], data[13], data[3], data[10]],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
          direction: "prev",
        }),
        [data[9], data[10], data[8], data[6], data[14], data[13]],
      );
      await tx.done;
    });

    await t.test("with order ", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.upperBound("B\uffff") },
          orderBy: "name.first",
        }),
        [data[0], data[4], data[11], data[7]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
          orderBy: "name.first",
          direction: "prev",
        }),
        [data[9], data[10], data[8], data[6], data[14], data[13]],
      );
      await tx.done;
    });

    await t.test("with mismatched order throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: { "name.last": KeyRange.bound("A", "M\uffff") },
            orderBy: "name.first",
          }),
        { message: "Sorting field must match filter field." },
      );
      await tx.done;
    });

    await t.test("with offset and limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.first": KeyRange.bound("A", "M\uffff") },
          orderBy: "name.first",
          offset: 2,
          limit: 2,
        }),
        [data[11], data[7]],
      );
      await tx.done;
    });

    await t.test("with offset and limit reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: { "name.last": KeyRange.bound("A", "M\uffff") },
          offset: 1,
          limit: 2,
          direction: "prev",
        }),
        [data[7], data[9]],
      );
      await tx.done;
    });

    await t.test("on missing index throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(() =>
        query(tx.store("items"), {
          where: { age: KeyRange.bound(30, 40) },
        }),
      );
      await tx.done;
    });
  });

  await t.test("get by multi field equality", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
        }),
        [data[2], data[12]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.only(810),
          },
        }),
        [data[12]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Piotr"),
            "name.last": KeyRange.only("Kowalski"),
          },
        }),
        [],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          direction: "prev",
        }),
        [data[12], data[2]],
      );
      await tx.done;
    });

    await t.test("with offset throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.only("Maciej"),
              "name.last": KeyRange.only("Nowak"),
            },
            offset: 1,
          }),
        { message: "Equality filters cannot use offset." },
      );
      await tx.done;
    });

    await t.test("with limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          limit: 1,
        }),
        [data[2]],
      );
      await tx.done;
    });

    await t.test("on missing index throws", async () => {
      const tx = db.tx("items", "readonly");
      await rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.only("Maciej"),
              age: KeyRange.only(35),
            },
          }),
        { message: "Index for age not found." },
      );
      await tx.done;
    });

    await t.test("with order", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "points",
        }),
        [data[12], data[2]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "name.last",
        }),
        [data[2], data[12]],
      );
      await tx.done;
    });

    await t.test("with order reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "points",
          direction: "prev",
        }),
        [data[2], data[12]],
      );
      await tx.done;
    });

    await t.test("on missing index for order throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.only("Maciej"),
              "name.last": KeyRange.only("Nowak"),
            },
            orderBy: "age",
          }),
        { message: "Index for name.first and age not found." },
      );
      await tx.done;
    });
  });

  await t.test("get by multi field equality and range", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
        }),
        [data[2], data[14], data[0]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Piotr"),
            points: KeyRange.bound(1500, 1515, true),
          },
        }),
        [data[6]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(1000),
          },
        }),
        [data[2], data[14], data[0], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.upperBound(1450),
          },
        }),
        [data[12], data[2], data[14], data[0]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
        }),
        [data[12], data[2]],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
          direction: "prev",
        }),
        [data[0], data[14], data[2]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
          direction: "prev",
        }),
        [data[2], data[12]],
      );
      await tx.done;
    });

    await t.test("with offset throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.last": KeyRange.only("Nowak"),
              points: KeyRange.bound(1000, 1450),
            },
            offset: 1,
          }),
        { message: "Equality filters cannot use offset." },
      );
      await tx.done;
    });

    await t.test("with limit", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
          limit: 2,
        }),
        [data[2], data[14]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
          limit: 1,
          direction: "prev",
        }),
        [data[2]],
      );
      await tx.done;
    });

    await t.test("with multiple ranges throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.only("Piotr"),
              "name.last": KeyRange.bound("B", "Y\uffff"),
              age: KeyRange.bound(10, 90),
            },
          }),
        { message: "Equality filters cannot be combined with multiple range filters." },
      );
      await tx.done;
    });

    await t.test("on missing index for range throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.last": KeyRange.only("Nowak"),
              age: KeyRange.bound(0, 100),
            },
          }),
        { message: "Index for name.last and age not found." },
      );
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.only("Maciej"),
              "name.last": KeyRange.only("Nowak"),
              age: KeyRange.lowerBound(0),
            },
          }),
        { message: "Index for name.first and age not found." },
      );
      await tx.done;
    });

    await t.test("with mismatched order throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.last": KeyRange.only("Nowak"),
              points: KeyRange.bound(1000, 1450),
            },
            orderBy: "age",
          }),
        { message: "Sorting field must match filter field." },
      );
      await tx.done;
    });
  });

  await t.test("get by multi field range", async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
        }),
        [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
        }),
        [data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38),
          },
        }),
        [data[12], data[14]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38, true),
          },
        }),
        [data[14]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38, false, true),
          },
        }),
        [data[12]],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          direction: "prev",
        }),
        [data[8], data[14], data[12], data[2], data[7], data[11], data[0]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38),
          },
          direction: "prev",
        }),
        [data[14], data[12]],
      );
      await tx.done;
    });

    await t.test("with order", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.first", "name.last"],
        }),
        [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.last", "name.first"],
        }),
        [data[11], data[7], data[0], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38),
          },
          orderBy: ["name.first", "name.last", "age"],
        }),
        [data[12], data[14]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(30, 40, true),
          },
          orderBy: ["name.first", "name.last", "age"],
        }),
        [data[12], data[14], data[1]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.first", "name.last", "age"],
        }),
        [data[12], data[2], data[14], data[8]],
      );
      await tx.done;
    });

    await t.test("with mismatched order throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.upperBound("P\uffff"),
              "name.last": KeyRange.bound("E", "R\uffff"),
            },
            orderBy: ["name.first", "age"],
          }),
        { message: "Compound field sorting can only filter by the sorted fields." },
      );
      await tx.done;
    });

    await t.test("on missing index throws", async () => {
      const tx = db.tx("items", "readonly");
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.upperBound("P\uffff"),
              age: KeyRange.bound(0, 100),
            },
            orderBy: ["name.first", "age"],
          }),
        { message: "Index for name.first and age not found." },
      );
      rejects(
        () =>
          query(tx.store("items"), {
            where: {
              "name.first": KeyRange.bound("D", "P\uffff"),
              "name.last": KeyRange.bound("E", "R\uffff"),
              points: KeyRange.bound(1000, 2000),
            },
          }),
        { message: "Index with name.first, name.last, and points not found." },
      );
      await tx.done;
    });
  });

  await t.test("get by multi field range and key range", { skip: true }, async (t) => {
    await t.test("basic", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.bound(5, 25, false, true),
          },
        }),
        [data[11], data[7], data[2], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.upperBound(25),
          },
        }),
        [data[2], data[12], data[8]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.lowerBound(25, true),
          },
        }),
        [data[14]],
      );
      await tx.done;
    });

    await t.test("reversed", async () => {
      const tx = db.tx("items", "readonly");
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.bound(5, 25, false, true),
          },
          direction: "prev",
        }),
        [data[8], data[2], data[7], data[11]],
      );
      deepEqual(
        await query(tx.store("items"), {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.upperBound(25),
          },
          direction: "prev",
        }),
        [data[8], data[12], data[2]],
      );
      await tx.done;
    });
  });

  await t.test("get by multi field equality and key range", { skip: true }, async () => {
    const tx = db.tx("items", "readonly");
    deepEqual(
      await query(tx.store("items"), {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          [primaryKey]: KeyRange.bound(0, 10),
        },
      }),
      [data[2]],
    );
    await tx.done;
  });

  db.close();
});
