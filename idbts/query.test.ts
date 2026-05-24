import "fake-indexeddb/auto";
import "observable-polyfill";

import { deepEqual, rejects } from "node:assert/strict";
import { after, suite, test } from "node:test";
import { KeyRange, openDB, schema } from "./index.ts";
import { primaryKey, query } from "./query.ts";

suite("query", { concurrency: true }, async () => {
  type Item = {
    id: number;
    name: { first: string; last: string };
    age: number;
    points: number;
    level?: number;
  };

  const db = await openDB("query-simple", 1, {
    items: {
      value: schema<Item>(),
      keyPath: "id",
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
    /*  0 */ { id: 1, name: { first: "Alicja", last: "Nowak" }, age: 30, points: 1420, level: 10 },
    /*  1 */ { id: 3, name: { first: "Wojciech", last: "Kowalski" }, age: 40, points: 1312 },
    /*  2 */ { id: 5, name: { first: "Maciej", last: "Nowak" }, age: 55, points: 1210 },
    /*  3 */ { id: 7, name: { first: "Ewa", last: "Wieczorek" }, age: 28, points: 850 },
    /*  4 */ { id: 9, name: { first: "Anna", last: "Sobczak" }, age: 31, points: 980 },
    /*  5 */ { id: 11, name: { first: "Nadzieja", last: "Dudek" }, age: 22, points: 1312 },
    /*  6 */ { id: 13, name: { first: "Piotr", last: "Dudek" }, age: 25, points: 1515 },
    /*  7 */ { id: 15, name: { first: "Bożena", last: "Majewska" }, age: 45, points: 1002 },
    /*  8 */ { id: 17, name: { first: "Piotr", last: "Nowak" }, age: 15, points: 1500 },
    /*  9 */ { id: 19, name: { first: "Sławomir", last: "Kowalski" }, age: 29, points: 900, level: 5 },
    /* 10 */ { id: 21, name: { first: "Radosław", last: "Wieczorek" }, age: 31, points: 1010 },
    /* 11 */ { id: 23, name: { first: "Anna", last: "Majewska" }, age: 42, points: 1440 },
    /* 12 */ { id: 25, name: { first: "Maciej", last: "Nowak" }, age: 35, points: 810, level: 2 },
    /* 13 */ { id: 27, name: { first: "Paweł", last: "Sobczak" }, age: 27, points: 1100 },
    /* 14 */ { id: 29, name: { first: "Paweł", last: "Nowak" }, age: 38, points: 1210 },
  ] as const satisfies ReadonlyArray<Item>;

  await db.insert("items", data);

  test("get all", async (t) => {
    await t.test("basic", async () => {
      deepEqual(await query(db, "items", {}), data);
    });

    await t.test("reversed", async () => {
      deepEqual(await query(db, "items", { direction: "prev" }), [...data].reverse());
    });

    await t.test("with limit", async () => {
      deepEqual(await query(db, "items", { limit: 5 }), data.slice(0, 5));
    });

    await t.test("with limit reversed", async () => {
      deepEqual(await query(db, "items", { limit: 5, direction: "prev" }), data.toReversed().slice(0, 5));
    });
  });

  test("get all ordered", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", { orderBy: "name.first" }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)),
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", { orderBy: "name.first", direction: "prev" }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).reverse(),
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", { orderBy: "name.first", limit: 5 }),
        data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).slice(0, 5),
      );
    });

    await t.test("with limit reversed", async () => {
      deepEqual(
        await query(db, "items", { orderBy: "name.first", limit: 5, direction: "prev" }),
        data
          .toSorted((a, b) => a.name.first.localeCompare(b.name.first))
          .reverse()
          .slice(0, 5),
      );
    });

    await t.test("with missing index for order field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            orderBy: "age",
          }),
        { message: "Missing index on age." },
      );
    });
  });

  test("get by key equality", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(1) },
        }),
        [data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(15) },
        }),
        [data[7]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(10) },
        }),
        [],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(1) },
          direction: "prev",
        }),
        [data[0]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(3) },
          limit: 1,
        }),
        [data[1]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(5) },
          limit: 0,
        }),
        [],
      );
    });

    await t.test("with order", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(7) },
          orderBy: "points",
        }),
        [data[3]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.only(9) },
          orderBy: "name.first",
          direction: "prev",
        }),
        [data[4]],
      );
    });

    await t.test("with other filters", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            [primaryKey]: KeyRange.only(1),
            "name.first": KeyRange.only("Alicja"),
          },
        }),
        [data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            [primaryKey]: KeyRange.only(1),
            "name.first": KeyRange.only("Nobody"),
          },
        }),
        [],
      );
    });
  });

  test("get by key range", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.bound(9, 13) },
        }),
        [data[4], data[5], data[6]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.upperBound(5) },
        }),
        [data[0], data[1], data[2]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.lowerBound(25, true) },
        }),
        [data[13], data[14]],
      );
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.lowerBound(999) },
        }),
        [],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.bound(13, 17) },
          direction: "prev",
        }),
        [data[8], data[7], data[6]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.bound(3, 12) },
          limit: 3,
        }),
        [data[1], data[2], data[3]],
      );
    });

    await t.test("with limit reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.bound(4, 16) },
          limit: 2,
          direction: "prev",
        }),
        [data[7], data[6]],
      );
    });

    await t.test("with order", async () => {
      deepEqual(
        await query(db, "items", {
          where: { [primaryKey]: KeyRange.bound(3, 12) },
          orderBy: "name.first",
        }),
        [data[4], data[3], data[2], data[5], data[1]],
      );
    });

    await t.test("with field range filter", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            [primaryKey]: KeyRange.bound(3, 12),
            "name.first": KeyRange.bound("A", "M"),
          },
        }),
        [data[4], data[3]],
      );
    });
  });

  test("get by field equality", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.only("Piotr") },
        }),
        [data[6], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.only("Nowak") },
        }),
        [data[0], data[2], data[8], data[12], data[14]],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.only("Piotr") },
          direction: "prev",
        }),
        [data[8], data[6]],
      );
    });

    await t.test("with matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.only("Piotr") },
          orderBy: "name.first",
        }),
        [data[6], data[8]],
      );
    });

    await t.test("with non-matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.only("Nowak") },
          orderBy: "name.first",
        }),
        [data[0], data[2], data[12], data[14], data[8]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.only("Nowak") },
          limit: 3,
        }),
        [data[0], data[2], data[8]],
      );
    });

    await t.test("with missing index for filter field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: { level: KeyRange.only(5) },
          }),
        { message: "Missing index on level." },
      );
    });

    await t.test("with missing index for order field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: { age: KeyRange.only(30) },
            orderBy: "points",
          }),
        { message: "Missing index on age+points." },
      );
    });

    await t.test("will use index with extra fields", async () => {
      deepEqual(
        await query(db, "items", {
          where: { age: KeyRange.only(31) },
        }),
        [data[4], data[10]],
      );
    });
  });

  test("get by field range", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
        }),
        [data[13], data[14], data[6], data[8], data[10], data[9]],
      );
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.lowerBound("P", true) },
        }),
        [data[4], data[13], data[3], data[10]],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
          direction: "prev",
        }),
        [data[9], data[10], data[8], data[6], data[14], data[13]],
      );
    });

    await t.test("with matching order ", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.upperBound("B\uffff") },
          orderBy: "name.first",
        }),
        [data[0], data[4], data[11], data[7]],
      );
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.bound("P", "S\uffff") },
          orderBy: "name.first",
          direction: "prev",
        }),
        [data[9], data[10], data[8], data[6], data[14], data[13]],
      );
    });

    await t.test("with non-matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.bound("A", "M\uffff") },
          orderBy: "name.first",
        }),
        [data[11], data[7], data[5], data[6], data[9], data[1]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.bound("A", "M\uffff") },
          orderBy: "name.first",
          limit: 2,
        }),
        [data[0], data[4]],
      );
    });

    await t.test("with limit reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: { "name.last": KeyRange.bound("A", "M\uffff") },
          limit: 2,
          direction: "prev",
        }),
        [data[11], data[7]],
      );
      deepEqual(
        await query(db, "items", {
          where: { "name.first": KeyRange.bound("A", "M\uffff") },
          orderBy: "name.first",
          direction: "prev",
          limit: 2,
        }),
        [data[12], data[2]],
      );
    });

    await t.test("with missing index for filter field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: { level: KeyRange.lowerBound(3, true) },
          }),
        { message: "Missing index on level." },
      );
    });

    await t.test("with missing index for order field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: { age: KeyRange.bound(30, 40) },
            orderBy: "points",
          }),
        { message: "Missing index on points+age." },
      );
    });
  });

  test("get by multi field equality", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
        }),
        [data[2], data[12]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.only(810),
          },
        }),
        [data[12]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Piotr"),
            "name.last": KeyRange.only("Kowalski"),
          },
        }),
        [],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          direction: "prev",
        }),
        [data[12], data[2]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          limit: 1,
        }),
        [data[2]],
      );
    });

    await t.test("with missing index for filter field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: {
              "name.first": KeyRange.only("Maciej"),
              level: KeyRange.only(1),
            },
          }),
        { message: "Missing index on level." },
      );
    });

    await t.test("will use index with extra fields", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            age: KeyRange.only(35),
          },
        }),
        [data[12]],
      );
    });

    await t.test("with order", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "points",
        }),
        [data[12], data[2]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "name.last",
        }),
        [data[2], data[12]],
      );
    });

    await t.test("with order reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "points",
          direction: "prev",
        }),
        [data[2], data[12]],
      );
    });

    await t.test("with missing index for order field throws", async () => {
      rejects(
        () =>
          query(db, "items", {
            where: {
              "name.first": KeyRange.only("Maciej"),
              "name.last": KeyRange.only("Nowak"),
            },
            orderBy: "level",
          }),
        { message: "Missing indices on name.first+level, name.last+level." },
      );
    });
  });

  test("get by multi field equality and range", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
        }),
        [data[2], data[14], data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Piotr"),
            points: KeyRange.bound(1500, 1515, true),
          },
        }),
        [data[6]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(1000),
          },
        }),
        [data[2], data[14], data[0], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.upperBound(1450),
          },
        }),
        [data[12], data[2], data[14], data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
        }),
        [data[12], data[2]],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
          direction: "prev",
        }),
        [data[0], data[14], data[2]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
          direction: "prev",
        }),
        [data[2], data[12]],
      );
    });

    await t.test("with limit", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
          limit: 2,
        }),
        [data[2], data[14]],
      );
      deepEqual(
        await query(db, "items", {
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
    });

    await t.test("with multiple ranges", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Piotr"),
            "name.last": KeyRange.bound("B", "Y\uffff"),
            age: KeyRange.bound(10, 30),
          },
        }),
        [data[6], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Piotr"),
            "name.last": KeyRange.bound("B", "Y\uffff"),
            age: KeyRange.bound(10, 20),
          },
        }),
        [data[8]],
      );
    });

    await t.test("with missing index for filter field throws", async () => {
      await rejects(
        () =>
          query(db, "items", {
            where: {
              "name.last": KeyRange.only("Nowak"),
              level: KeyRange.bound(0, 100),
            },
          }),
        { message: "Missing index on name.last+level." },
      );
      await rejects(
        () =>
          query(db, "items", {
            where: {
              "name.first": KeyRange.only("Maciej"),
              "name.last": KeyRange.only("Nowak"),
              level: KeyRange.lowerBound(0),
            },
          }),
        { message: "Missing indices on name.first+level, name.last+level." },
      );
      await rejects(
        () =>
          query(db, "items", {
            where: {
              level: KeyRange.only(1),
              age: KeyRange.bound(0, 100),
            },
          }),
        { message: "Missing index on level+age." },
      );
      await rejects(
        () =>
          query(db, "items", {
            where: {
              "name.last": KeyRange.only("Nowak"),
              points: KeyRange.bound(1000, 1450),
            },
            orderBy: "age",
          }),
        { message: "Missing index on name.last+age+points." },
      );
    });

    await t.test("with matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.upperBound(1450),
          },
          orderBy: "points",
        }),
        [data[12], data[2], data[14], data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.lowerBound(500),
          },
          orderBy: "points",
          direction: "prev",
        }),
        [data[2], data[12]],
      );
    });

    await t.test("with non-matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            age: KeyRange.bound(35, 55),
          },
          orderBy: "name.last",
        }),
        [data[12], data[2]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            age: KeyRange.upperBound(55, true),
          },
          orderBy: "name.last",
        }),
        [data[12]],
      );
    });
  });

  test("get by multi field range", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
        }),
        [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
        }),
        [data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38),
          },
        }),
        [data[12], data[14]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38, true),
          },
        }),
        [data[14]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38, false, true),
          },
        }),
        [data[12]],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          direction: "prev",
        }),
        [data[8], data[14], data[12], data[2], data[7], data[11], data[0]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(35, 38),
          },
          direction: "prev",
        }),
        [data[14], data[12]],
      );
    });

    await t.test("with matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.first", "name.last"],
        }),
        [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.last", "name.first"],
        }),
        [data[11], data[7], data[0], data[2], data[12], data[14], data[8]],
      );
      deepEqual(
        await query(db, "items", {
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
        await query(db, "items", {
          where: {
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(30, 40, true),
          },
          orderBy: ["name.first", "name.last", "age"],
        }),
        [data[12], data[14], data[1]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
          },
          orderBy: ["name.first", "name.last", "age"],
        }),
        [data[12], data[2], data[14], data[8]],
      );
    });

    await t.test("with non-matching order", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.last": KeyRange.bound("E", "R\uffff"),
            age: KeyRange.bound(30, 40, true, false),
          },
          orderBy: ["name.first", "name.last"],
        }),
        [data[12], data[14], data[1]],
      );
    });

    await t.test("on missing index throws", async () => {
      rejects(
        () =>
          query(db, "items", {
            where: {
              "name.first": KeyRange.upperBound("P\uffff"),
              age: KeyRange.bound(0, 100),
            },
            orderBy: ["name.first", "age"],
          }),
        { message: "Missing index on name.first+age." },
      );
      rejects(
        () =>
          query(db, "items", {
            where: {
              "name.first": KeyRange.bound("D", "P\uffff"),
              "name.last": KeyRange.bound("E", "R\uffff"),
              points: KeyRange.bound(1000, 2000),
            },
          }),
        { message: "Missing index on name.first+name.last+points." },
      );
    });
  });

  test("get by multi field range and key range", async (t) => {
    await t.test("basic", async () => {
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.upperBound("P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.bound(5, 25, false, true),
          },
        }),
        [data[11], data[7], data[2], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.upperBound(25),
          },
        }),
        [data[2], data[12], data[8]],
      );
      deepEqual(
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.lowerBound(25, true),
          },
        }),
        [data[14]],
      );
    });

    await t.test("reversed", async () => {
      deepEqual(
        await query(db, "items", {
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
        await query(db, "items", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            [primaryKey]: KeyRange.upperBound(25),
          },
          direction: "prev",
        }),
        [data[8], data[12], data[2]],
      );
    });
  });

  test("get by multi field equality and key range", async () => {
    deepEqual(
      await query(db, "items", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          [primaryKey]: KeyRange.bound(0, 10),
        },
      }),
      [data[2]],
    );
    deepEqual(
      await query(db, "items", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          [primaryKey]: KeyRange.bound(0, 100),
        },
      }),
      [data[2], data[12]],
    );
    deepEqual(
      await query(db, "items", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          [primaryKey]: KeyRange.bound(0, 100),
        },
        direction: "prev",
      }),
      [data[12], data[2]],
    );
  });

  after(() => {
    db.idb.close();
  });
});
