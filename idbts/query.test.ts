import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { after, suite, test } from "node:test";
import type { DatabaseSchemaOf } from "./Database.ts";
import { KeyRange } from "./KeyRange.ts";
import { openDB } from "./openDB.ts";
import { query } from "./query.ts";
import { schema } from "./StandardSchema.ts";

type QueryOptions<Where, OrderBy> = {
  where?: Where | undefined;
  orderBy?: OrderBy | readonly OrderBy[] | undefined;
  limit?: number | undefined;
  direction?: "next" | "prev" | undefined;
};

suite("query", { concurrency: true }, async () => {
  type Person = {
    id: number;
    name: { first: string; last: string };
    age: number;
    points: number;
    level?: number;
  };

  const db = await openDB("query-simple", 1, {
    people: {
      value: schema<Person>(),
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
        byIdAndFirstName: { keyPath: ["id", "name.first"] },
        byIdAndLastName: { keyPath: ["id", "name.last"] },
      },
    },
  });

  const data = [
    /*  0 */ { id: 1, name: { first: "Alicja", last: "Nowak" }, age: 30, points: 1420 },
    /*  1 */ { id: 3, name: { first: "Wojciech", last: "Kowalski" }, age: 40, points: 1312 },
    /*  2 */ { id: 5, name: { first: "Maciej", last: "Nowak" }, age: 55, points: 1210 },
    /*  3 */ { id: 7, name: { first: "Ewa", last: "Wieczorek" }, age: 28, points: 850 },
    /*  4 */ { id: 9, name: { first: "Anna", last: "Sobczak" }, age: 31, points: 980 },
    /*  5 */ { id: 11, name: { first: "Nadzieja", last: "Dudek" }, age: 22, points: 1312 },
    /*  6 */ { id: 13, name: { first: "Piotr", last: "Dudek" }, age: 25, points: 1515 },
    /*  7 */ { id: 15, name: { first: "Bożena", last: "Majewska" }, age: 45, points: 1002 },
    /*  8 */ { id: 17, name: { first: "Piotr", last: "Nowak" }, age: 15, points: 1500 },
    /*  9 */ { id: 19, name: { first: "Sławomir", last: "Kowalski" }, age: 29, points: 900 },
    /* 10 */ { id: 21, name: { first: "Radosław", last: "Wieczorek" }, age: 31, points: 1010 },
    /* 11 */ { id: 23, name: { first: "Anna", last: "Majewska" }, age: 42, points: 1440 },
    /* 12 */ { id: 25, name: { first: "Maciej", last: "Nowak" }, age: 35, points: 810 },
    /* 13 */ { id: 27, name: { first: "Paweł", last: "Sobczak" }, age: 27, points: 1100 },
    /* 14 */ { id: 29, name: { first: "Paweł", last: "Nowak" }, age: 38, points: 1210 },
  ] as const satisfies ReadonlyArray<Person>;

  await db.insert("people", data);

  expectTypeOf(query<DatabaseSchemaOf<typeof db>, "people">)
    .parameter(2)
    .toEqualTypeOf<
      QueryOptions<
        {
          readonly id?: KeyRange<number>;
          readonly "name.first"?: KeyRange<string>;
          readonly "name.last"?: KeyRange<string>;
          readonly age?: KeyRange<number>;
          readonly points?: KeyRange<number>;
        },
        "id" | "name.first" | "name.last" | "age" | "points"
      >
    >(undefined as any);

  test("get all", async () => {
    deepEqual(await query(db, "people", {}), data);
  });

  test("get all reversed", async () => {
    deepEqual(await query(db, "people", { direction: "prev" }), [...data].reverse());
  });

  test("get all with limit", async () => {
    deepEqual(await query(db, "people", { limit: 5 }), data.slice(0, 5));
  });

  test("get all with limit reversed", async () => {
    deepEqual(
      await query(db, "people", { limit: 5, direction: "prev" }),
      data.toReversed().slice(0, 5),
    );
  });

  test("get all ordered", async () => {
    deepEqual(
      await query(db, "people", { orderBy: "name.first" }),
      data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)),
    );
  });

  test("get all ordered reversed", async () => {
    deepEqual(
      await query(db, "people", { orderBy: "name.first", direction: "prev" }),
      data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).reverse(),
    );
  });

  test("get all ordered with limit", async () => {
    deepEqual(
      await query(db, "people", { orderBy: "name.first", limit: 5 }),
      data.toSorted((a, b) => a.name.first.localeCompare(b.name.first)).slice(0, 5),
    );
  });

  test("get all ordered with limit reversed", async () => {
    deepEqual(
      await query(db, "people", { orderBy: "name.first", limit: 5, direction: "prev" }),
      data
        .toSorted((a, b) => a.name.first.localeCompare(b.name.first))
        .reverse()
        .slice(0, 5),
    );
  });

  test("get all ordered with invalid order", async () => {
    await rejects(
      () =>
        query(db, "people", {
          orderBy: "age",
        }),
      { message: "Missing index on age." },
    );
  });

  test("get by key equality", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(1) },
      }),
      [data[0]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(15) },
      }),
      [data[7]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(10) },
      }),
      [],
    );
  });

  test("get by key equality reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(1) },
        direction: "prev",
      }),
      [data[0]],
    );
  });

  test("get by key equality with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(3) },
        limit: 1,
      }),
      [data[1]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(5) },
        limit: 0,
      }),
      [],
    );
  });

  test("get by key equality with order", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(7) },
        orderBy: "points",
      }),
      [data[3]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.only(9) },
        orderBy: "name.first",
        direction: "prev",
      }),
      [data[4]],
    );
  });

  test("get by key equality and field equality", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          id: KeyRange.only(1),
          "name.first": KeyRange.only("Alicja"),
        },
      }),
      [data[0]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          id: KeyRange.only(1),
          "name.first": KeyRange.only("Nobody"),
        },
      }),
      [],
    );
  });

  test("get by key range", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.bound(9, 13) },
      }),
      [data[4], data[5], data[6]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.upperBound(5) },
      }),
      [data[0], data[1], data[2]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.lowerBound(25, true) },
      }),
      [data[13], data[14]],
    );
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.lowerBound(999) },
      }),
      [],
    );
  });

  test("get by key range reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.bound(13, 17) },
        direction: "prev",
      }),
      [data[8], data[7], data[6]],
    );
  });

  test("get by key range with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.bound(3, 12) },
        limit: 3,
      }),
      [data[1], data[2], data[3]],
    );
  });

  test("get by key range with limit reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.bound(4, 16) },
        limit: 2,
        direction: "prev",
      }),
      [data[7], data[6]],
    );
  });

  test("get by key range ordered", async () => {
    deepEqual(
      await query(db, "people", {
        where: { id: KeyRange.bound(3, 12) },
        orderBy: "name.first",
      }),
      [data[4], data[3], data[2], data[5], data[1]],
    );
  });

  test("get by key range and field range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          id: KeyRange.bound(3, 12),
          "name.first": KeyRange.bound("A", "M"),
        },
      }),
      [data[4], data[3]],
    );
  });

  test("get by field equality", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.only("Piotr") },
      }),
      [data[6], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.only("Nowak") },
      }),
      [data[0], data[2], data[8], data[12], data[14]],
    );
  });

  test("get by field equality reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.only("Piotr") },
        direction: "prev",
      }),
      [data[8], data[6]],
    );
  });

  test("get by field equality with matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.only("Piotr") },
        orderBy: "name.first",
      }),
      [data[6], data[8]],
    );
  });

  test("get by field equality with non-matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.only("Nowak") },
        orderBy: "name.first",
      }),
      [data[0], data[2], data[12], data[14], data[8]],
    );
  });

  test("get by field equality with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.only("Nowak") },
        limit: 3,
      }),
      [data[0], data[2], data[8]],
    );
  });

  test("get by invalid field equality", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: { level: KeyRange.only(5) } as any,
        }),
      { message: "Missing index on level." },
    );
  });

  test("get by field equality with invalid order", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: { age: KeyRange.only(30) },
          orderBy: "points",
        }),
      { message: "Missing index on age+points." },
    );
  });

  test("get by field equality with non-exact index", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: { age: KeyRange.only(31) },
        }),
      { message: "Missing index on age." },
    );
  });

  test("get by field range", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.bound("P", "S\uffff") },
      }),
      [data[13], data[14], data[6], data[8], data[10], data[9]],
    );
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.lowerBound("P", true) },
      }),
      [data[4], data[13], data[3], data[10]],
    );
  });

  test("get by field range reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.bound("P", "S\uffff") },
        direction: "prev",
      }),
      [data[9], data[10], data[8], data[6], data[14], data[13]],
    );
  });

  test("get by field range with matching order ", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.upperBound("B\uffff") },
        orderBy: "name.first",
      }),
      [data[0], data[4], data[11], data[7]],
    );
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.bound("P", "S\uffff") },
        orderBy: "name.first",
        direction: "prev",
      }),
      [data[9], data[10], data[8], data[6], data[14], data[13]],
    );
  });

  test("get by field range with non-matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.bound("A", "M\uffff") },
        orderBy: "name.first",
      }),
      [data[11], data[7], data[5], data[6], data[9], data[1]],
    );
  });

  test("get by field range with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.bound("A", "M\uffff") },
        orderBy: "name.first",
        limit: 2,
      }),
      [data[0], data[4]],
    );
  });

  test("get by field range with limit reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: { "name.last": KeyRange.bound("A", "M\uffff") },
        limit: 2,
        direction: "prev",
      }),
      [data[11], data[7]],
    );
    deepEqual(
      await query(db, "people", {
        where: { "name.first": KeyRange.bound("A", "M\uffff") },
        orderBy: "name.first",
        direction: "prev",
        limit: 2,
      }),
      [data[12], data[2]],
    );
  });

  test("get by invalid field range", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: { level: KeyRange.lowerBound(3, true) } as any,
        }),
      { message: "Missing index on level." },
    );
  });

  test("get by field range with invalid order", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: { age: KeyRange.bound(30, 40) },
          orderBy: "points",
        }),
      { message: "Missing index on points+age." },
    );
  });

  test("get by multi field equality", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
        },
      }),
      [data[2], data[12]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.only(810),
        },
      }),
      [data[12]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Piotr"),
          "name.last": KeyRange.only("Kowalski"),
        },
      }),
      [],
    );
  });

  test("get by multi field equality reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
        },
        direction: "prev",
      }),
      [data[12], data[2]],
    );
  });

  test("get by multi field equality with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
        },
        limit: 1,
      }),
      [data[2]],
    );
  });

  test("get by invalid multi field equality", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            level: KeyRange.only(1),
          } as any,
        }),
      { message: "Missing index on level." },
    );
  });

  test("get by multi field equality with non-exact index", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            age: KeyRange.only(35),
          },
        }),
      { message: "Missing index on age." },
    );
  });

  test("get by multi field equality with order", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
        },
        orderBy: "points",
      }),
      [data[12], data[2]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
        },
        orderBy: "name.last",
      }),
      [data[2], data[12]],
    );
  });

  test("get by multi field equality with order reversed", async () => {
    deepEqual(
      await query(db, "people", {
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

  test("get by multi field equality with invalid order", async () => {
    rejects(
      () =>
        query(db, "people", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
          },
          orderBy: "level" as any,
        }),
      { message: "Missing index on name.first+level, name.last+level." },
    );
  });

  test("get by field equality and range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.bound(1000, 1450),
        },
      }),
      [data[2], data[14], data[0]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Piotr"),
          points: KeyRange.bound(1500, 1515, true),
        },
      }),
      [data[6]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.lowerBound(1000),
        },
      }),
      [data[2], data[14], data[0], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.upperBound(1450),
        },
      }),
      [data[12], data[2], data[14], data[0]],
    );
  });

  test("get by multi field equality and range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.lowerBound(500),
        },
      }),
      [data[12], data[2]],
    );
  });

  test("get by field equality and range reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.bound(1000, 1450),
        },
        direction: "prev",
      }),
      [data[0], data[14], data[2]],
    );
  });

  test("get by multi field equality and range reversed", async () => {
    deepEqual(
      await query(db, "people", {
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

  test("get by field equality and range with limit", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.bound(1000, 1450),
        },
        limit: 2,
      }),
      [data[2], data[14]],
    );
  });

  test("get by multi field equality and range with limit reversed", async () => {
    deepEqual(
      await query(db, "people", {
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

  test("get by field equality and multi range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Piotr"),
          "name.last": KeyRange.bound("B", "Y\uffff"),
          age: KeyRange.bound(10, 30),
        },
      }),
      [data[6], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Piotr"),
          "name.last": KeyRange.bound("B", "Y\uffff"),
          age: KeyRange.bound(10, 20),
        },
      }),
      [data[8]],
    );
  });

  test("get by invalid field equality and range", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            level: KeyRange.bound(0, 100),
          } as any,
        }),
      { message: "Missing index on name.last+level." },
    );
    await rejects(
      () =>
        query(db, "people", {
          where: {
            level: KeyRange.only(1),
            age: KeyRange.bound(0, 100),
          } as any,
        }),
      { message: "Missing index on level+age." },
    );
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.last": KeyRange.only("Nowak"),
            points: KeyRange.bound(1000, 1450),
          },
          orderBy: "age",
        }),
      { message: "Missing index on name.last+age+points." },
    );
  });

  test("get by invalid multi field equality and range", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.first": KeyRange.only("Maciej"),
            "name.last": KeyRange.only("Nowak"),
            level: KeyRange.lowerBound(0),
          } as any,
        }),
      { message: "Missing index on name.first+level, name.last+level." },
    );
  });

  test("get by field equality and range with matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.only("Nowak"),
          points: KeyRange.upperBound(1450),
        },
        orderBy: "points",
      }),
      [data[12], data[2], data[14], data[0]],
    );
  });

  test("get by multi field equality and range with matching order", async () => {
    deepEqual(
      await query(db, "people", {
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

  test("get by field equality and range with non-matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          age: KeyRange.bound(35, 55),
        },
        orderBy: "name.last",
      }),
      [data[12], data[2]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          age: KeyRange.upperBound(55, true),
        },
        orderBy: "name.last",
      }),
      [data[12]],
    );
  });

  test("get by multi field range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
      }),
      [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
      }),
      [data[2], data[12], data[14], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          age: KeyRange.bound(35, 38),
        },
      }),
      [data[12], data[14]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          age: KeyRange.bound(35, 38, true),
        },
      }),
      [data[14]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          age: KeyRange.bound(35, 38, false, true),
        },
      }),
      [data[12]],
    );
  });

  test("get by multi field range reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
        direction: "prev",
      }),
      [data[8], data[14], data[12], data[2], data[7], data[11], data[0]],
    );
    deepEqual(
      await query(db, "people", {
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

  test("get by multi field range with matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
        orderBy: ["name.first", "name.last"],
      }),
      [data[0], data[11], data[7], data[2], data[12], data[14], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
        orderBy: ["name.last", "name.first"],
      }),
      [data[11], data[7], data[0], data[2], data[12], data[14], data[8]],
    );
    deepEqual(
      await query(db, "people", {
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
      await query(db, "people", {
        where: {
          "name.last": KeyRange.bound("E", "R\uffff"),
          age: KeyRange.bound(30, 40, true),
        },
        orderBy: ["name.first", "name.last", "age"],
      }),
      [data[12], data[14], data[1]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
        },
        orderBy: ["name.first", "name.last", "age"],
      }),
      [data[12], data[2], data[14], data[8]],
    );
  });

  test("get by multi field range with non-matching order", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.bound("E", "R\uffff"),
          age: KeyRange.bound(30, 40, true, false),
        },
        orderBy: ["name.first", "name.last"],
      }),
      [data[12], data[14], data[1]],
    );
  });

  test("get by invalid multi field range", async () => {
    rejects(
      () =>
        query(db, "people", {
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
        query(db, "people", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            points: KeyRange.bound(1000, 2000),
          },
        }),
      { message: "Missing index on name.first+name.last+points." },
    );
  });

  test("get by multi field range and key range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.bound(5, 25, false, true),
        },
      }),
      [data[11], data[7], data[2], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.upperBound(25),
        },
      }),
      [data[2], data[12], data[8]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.lowerBound(25, true),
        },
      }),
      [data[14]],
    );
  });

  test("get by multi field range and key range reversed", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.upperBound("P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.bound(5, 25, false, true),
        },
        direction: "prev",
      }),
      [data[8], data[2], data[7], data[11]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.upperBound(25),
        },
        direction: "prev",
      }),
      [data[8], data[12], data[2]],
    );
  });

  test("get by multi field equality and key range", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          id: KeyRange.bound(0, 10),
        },
      }),
      [data[2]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          id: KeyRange.bound(0, 100),
        },
      }),
      [data[2], data[12]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.only("Maciej"),
          "name.last": KeyRange.only("Nowak"),
          id: KeyRange.bound(0, 100),
        },
        direction: "prev",
      }),
      [data[12], data[2]],
    );
  });

  test("get by field range with invalid order by key", async () => {
    await rejects(
      () =>
        query(db, "people", {
          where: {
            "name.first": KeyRange.bound("D", "P\uffff"),
            "name.last": KeyRange.bound("E", "R\uffff"),
            id: KeyRange.bound(5, 25, false, true),
          },
          orderBy: ["id"],
        }),
      { message: "Missing index on id+name.first+name.last." },
    );
  });

  test("get by field range with order by key", async () => {
    deepEqual(
      await query(db, "people", {
        where: {
          "name.first": KeyRange.bound("D", "P\uffff"),
          id: KeyRange.upperBound(25),
        },
        orderBy: ["id"],
      }),
      [data[2], data[3], data[5], data[6], data[8], data[12]],
    );
    deepEqual(
      await query(db, "people", {
        where: {
          "name.last": KeyRange.bound("E", "R\uffff"),
          id: KeyRange.lowerBound(25, true),
        },
        orderBy: ["id"],
      }),
      [data[14]],
    );
  });

  after(() => {
    db.idb.close();
  });
});

suite("query with compound key", { concurrency: true }, async () => {
  type Point = {
    x: number;
    y: number;
    z: number;
    n?: string;
    t: string;
  };

  const db = await openDB("query-comp-key", 1, {
    points: {
      value: schema<Point>(),
      keyPath: ["x", "y", "z"],
      indexes: {
        byName: { keyPath: ["n"] },
        byType: { keyPath: ["t"] },
      },
    },
  });

  await db.insert(
    "points",
    [1, 2, 3].flatMap((y) =>
      [1, 2, 3].flatMap((x) => [1, 2, 3].map((z) => ({ x, y, z, t: "cube" }))),
    ),
  );
  await db.update("points", [[2, 2, 2]], (p) => ({ ...p!, n: "center" }));

  await db.insert(
    "points",
    [-1, -2, -3].map((y) => ({ x: 0, y, z: 0, t: "line" })),
  );
  await db.update("points", [[0, -2, 0]], (p) => ({ ...p!, n: "center" }));

  await db.insert("points", { x: 0, y: 0, z: 0, t: "dot", n: "origin" });

  expectTypeOf(query<DatabaseSchemaOf<typeof db>, "points">)
    .parameter(2)
    .toEqualTypeOf<
      QueryOptions<
        {
          readonly x?: KeyRange<number>;
          readonly y?: KeyRange<number>;
          readonly z?: KeyRange<number>;
          readonly n?: KeyRange<string>;
          readonly t?: KeyRange<string>;
        },
        "x" | "y" | "z" | "n" | "t"
      >
    >(undefined as any);

  test("get by all primary fields", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(1),
          y: KeyRange.only(2),
          z: KeyRange.only(3),
        },
      }),
      [{ x: 1, y: 2, z: 3, t: "cube" }],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(2),
          y: KeyRange.only(2),
          z: KeyRange.only(2),
        },
      }),
      [{ x: 2, y: 2, z: 2, t: "cube", n: "center" }],
    );
  });

  test("get by some primary fields", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(2),
          y: KeyRange.only(2),
        },
      }),
      [
        { x: 2, y: 2, z: 1, t: "cube" },
        { x: 2, y: 2, z: 2, t: "cube", n: "center" },
        { x: 2, y: 2, z: 3, t: "cube" },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(2),
          y: KeyRange.only(2),
        },
        direction: "prev",
      }),
      [
        { x: 2, y: 2, z: 3, t: "cube" },
        { x: 2, y: 2, z: 2, t: "cube", n: "center" },
        { x: 2, y: 2, z: 1, t: "cube" },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(0),
          y: KeyRange.only(0),
        },
      }),
      [{ x: 0, y: 0, z: 0, t: "dot", n: "origin" }],
    );
  });

  test("get by some primary fields ordered", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          y: KeyRange.only(2),
          z: KeyRange.only(3),
        },
        orderBy: ["x"],
      }),
      [1, 2, 3].flatMap((x) => ({ x, y: 2, z: 3, t: "cube" })),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          y: KeyRange.only(2),
          z: KeyRange.only(3),
        },
        orderBy: ["x"],
        direction: "prev",
      }),
      [3, 2, 1].flatMap((x) => ({ x, y: 2, z: 3, t: "cube" })),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(2),
          y: KeyRange.only(2),
        },
        orderBy: ["x", "y"],
        direction: "prev",
      }),
      [
        { x: 2, y: 2, z: 3, t: "cube" },
        { x: 2, y: 2, z: 2, t: "cube", n: "center" },
        { x: 2, y: 2, z: 1, t: "cube" },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(0),
          y: KeyRange.only(0),
        },
        orderBy: ["x", "y", "z"],
      }),
      [{ x: 0, y: 0, z: 0, t: "dot", n: "origin" }],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(0),
          y: KeyRange.only(0),
        },
        orderBy: ["z"],
      }),
      [{ x: 0, y: 0, z: 0, t: "dot", n: "origin" }],
    );
  });

  test("get by single primary field", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(1),
        },
      }),
      [1, 2, 3].flatMap((y) => [1, 2, 3].map((z) => ({ x: 1, y, z, t: "cube" }))),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          y: KeyRange.only(2),
        },
      }),
      [1, 2, 3].flatMap((x) =>
        [1, 2, 3].map((z) => ({
          x,
          y: 2,
          z,
          t: "cube",
          ...(x === 2 && z === 2 ? { n: "center" } : null),
        })),
      ),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          z: KeyRange.only(3),
        },
      }),
      [1, 2, 3].flatMap((x) => [1, 2, 3].map((y) => ({ x, y, z: 3, t: "cube" }))),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          z: KeyRange.only(0),
        },
      }),
      [
        { x: 0, y: -3, z: 0, t: "line" },
        { x: 0, y: -2, z: 0, t: "line", n: "center" },
        { x: 0, y: -1, z: 0, t: "line" },
        { x: 0, y: 0, z: 0, t: "dot", n: "origin" },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          z: KeyRange.only(-1),
        },
      }),
      [],
    );
  });

  test("get by primary field range", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.bound(1, 3, true, true),
          y: KeyRange.bound(1, 3, true, true),
        },
      }),
      [1, 2, 3].map((z) => ({
        x: 2,
        y: 2,
        z,
        ...(z === 2 ? { n: "center" } : null),
        t: "cube",
      })),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.bound(1, 3, true, true),
          y: KeyRange.bound(1, 3, true, true),
        },
        direction: "prev",
      }),
      [3, 2, 1].map((z) => ({
        x: 2,
        y: 2,
        z,
        ...(z === 2 ? { n: "center" } : null),
        t: "cube",
      })),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.bound(1, 3, true, false),
          y: KeyRange.bound(1, 3, false, true),
          z: KeyRange.bound(1, 3, true, true),
        },
      }),
      [2, 3].flatMap((x) =>
        [1, 2].flatMap((y) => ({
          x,
          y,
          z: 2,
          ...(x === 2 && y === 2 ? { n: "center" } : null),
          t: "cube",
        })),
      ),
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.upperBound(0),
          y: KeyRange.upperBound(0),
          z: KeyRange.upperBound(0),
        },
      }),
      [
        { t: "line", x: 0, y: -3, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { t: "line", x: 0, y: -1, z: 0 },
        { n: "origin", t: "dot", x: 0, y: 0, z: 0 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.upperBound(0),
          y: KeyRange.upperBound(0),
          z: KeyRange.upperBound(0),
        },
        direction: "prev",
      }),
      [
        { n: "origin", t: "dot", x: 0, y: 0, z: 0 },
        { t: "line", x: 0, y: -1, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { t: "line", x: 0, y: -3, z: 0 },
      ],
    );
  });

  test("get by primary fields with order on field", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(1),
          y: KeyRange.only(2),
          z: KeyRange.only(3),
        },
        orderBy: ["t"],
      }),
      [{ x: 1, y: 2, z: 3, t: "cube" }],
    );
  });

  test("get by primary field ranges with order on field", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(0),
          y: KeyRange.lowerBound(-2),
          z: KeyRange.only(0),
        },
        orderBy: ["t"],
      }),
      [
        { n: "origin", t: "dot", x: 0, y: 0, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { t: "line", x: 0, y: -1, z: 0 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          x: KeyRange.only(0),
          y: KeyRange.lowerBound(-2),
          z: KeyRange.only(0),
        },
        orderBy: ["n"],
      }),
      [
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { n: "origin", t: "dot", x: 0, y: 0, z: 0 },
      ],
    );
  });

  test("get by primary field ranges and field range", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          y: KeyRange.upperBound(-1, true),
          t: KeyRange.lowerBound("l"),
        },
      }),
      [
        { t: "line", x: 0, y: -3, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
      ],
    );
  });

  test("get by field equality", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          n: KeyRange.only("center"),
        },
      }),
      [
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { n: "center", t: "cube", x: 2, y: 2, z: 2 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          t: KeyRange.only("line"),
        },
      }),
      [
        { t: "line", x: 0, y: -3, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { t: "line", x: 0, y: -1, z: 0 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          n: KeyRange.only("center"),
          t: KeyRange.only("cube"),
        },
      }),
      [{ n: "center", t: "cube", x: 2, y: 2, z: 2 }],
    );
  });

  test("get by field equality ordered", async () => {
    deepEqual(
      await query(db, "points", {
        where: {
          n: KeyRange.only("center"),
        },
        orderBy: "x",
      }),
      [
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { n: "center", t: "cube", x: 2, y: 2, z: 2 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          t: KeyRange.only("line"),
        },
        orderBy: "x",
      }),
      [
        { t: "line", x: 0, y: -3, z: 0 },
        { n: "center", t: "line", x: 0, y: -2, z: 0 },
        { t: "line", x: 0, y: -1, z: 0 },
      ],
    );
    deepEqual(
      await query(db, "points", {
        where: {
          n: KeyRange.only("center"),
          t: KeyRange.only("cube"),
        },
        orderBy: ["x", "y", "z"],
      }),
      [{ n: "center", t: "cube", x: 2, y: 2, z: 2 }],
    );
  });

  test("get by field equality with invalid order", async () => {
    await rejects(
      () =>
        query(db, "points", {
          where: {
            n: KeyRange.only("center"),
          },
          orderBy: "t",
        }),
      { message: "Missing index on n+t." },
    );
    await rejects(
      () =>
        query(db, "points", {
          where: {
            t: KeyRange.only("line"),
          },
          orderBy: "y",
        }),
      { message: "Missing index on t+y." },
    );
    await rejects(
      () =>
        query(db, "points", {
          where: {
            n: KeyRange.only("center"),
            t: KeyRange.only("cube"),
          },
          orderBy: ["z", "y", "x"],
        }),
      { message: "Missing index on n+z+y+x, t+z+y+x." },
    );
  });

  after(() => {
    db.idb.close();
  });
});

suite("query optional fields", { concurrency: true }, async () => {
  type Item = {
    email: string;
    name?: string;
    age?: number;
  };

  const db = await openDB("query-opt", 1, {
    items: {
      value: schema<Item>(),
      keyPath: "email",
      indexes: {
        byName: { keyPath: "name" },
        byNameAndAge: { keyPath: ["name", "age"] },
      },
    },
  });

  const data: Item[] = [
    { email: "a@example.com", name: "Alice" },
    { email: "b@example.com", name: "Bob", age: 45 },
    { email: "c@example.com", age: 15 },
  ];
  await db.insert("items", data);

  expectTypeOf(query<DatabaseSchemaOf<typeof db>, "items">)
    .parameter(2)
    .toEqualTypeOf<
      QueryOptions<
        {
          readonly email?: KeyRange<string>;
          readonly name?: KeyRange<string>;
          readonly age?: KeyRange<number>;
        },
        "email" | "name" | "age"
      >
    >(undefined as any);

  test("order by email", async () => {
    deepEqual(
      await query(db, "items", {
        orderBy: "email",
      }),
      data,
    );
  });

  test("order by name", async () => {
    deepEqual(
      await query(db, "items", {
        orderBy: "name",
      }),
      [data[0], data[1]],
    );
  });

  test("order by age", async () => {
    await rejects(
      () =>
        query(db, "items", {
          orderBy: "age",
        }),
      { message: "Missing index on age." },
    );
    await rejects(
      () =>
        query(db, "items", {
          where: {
            age: KeyRange.bound(10, 50),
          },
        }),
      { message: "Missing index on age." },
    );
  });
});

suite("query with multi entry index", { concurrency: true }, async () => {
  type Post = {
    id: number;
    path: string[];
    tags: string[];
  };

  const db = await openDB("query-multi", 1, {
    posts: {
      value: schema<Post>(),
      keyPath: "id",
      indexes: {
        byPath: { keyPath: "path" },
        byTags: { keyPath: "tags", multiEntry: true },
      },
    },
  });

  const data: Post[] = [
    { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
    { id: 2, path: ["b", "b"], tags: ["bar", "baz"] },
    { id: 3, path: ["b"], tags: ["baz"] },
    { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
    { id: 5, path: ["q"], tags: ["qux"] },
    { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
  ];
  await db.insert("posts", data);

  expectTypeOf(query<DatabaseSchemaOf<typeof db>, "posts">)
    .parameter(2)
    .toEqualTypeOf<
      QueryOptions<
        {
          readonly id?: KeyRange<number>;
          readonly path?: KeyRange<string[]>;
          readonly tags?: KeyRange<string[]>;
        },
        "id" | "path" | "tags"
      >
    >(undefined as any);

  test("order by path", async () => {
    deepEqual(
      await query(db, "posts", {
        orderBy: "path",
      }),
      [
        { id: 3, path: ["b"], tags: ["baz"] },
        { id: 2, path: ["b", "b"], tags: ["bar", "baz"] },
        { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
        { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
        { id: 5, path: ["q"], tags: ["qux"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
  });

  test("order by tag", async () => {
    deepEqual(
      await query(db, "posts", {
        orderBy: "tags",
      }),
      [
        // TODO: deduplicate multi entry results
        { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
        { id: 2, path: ["b", "b"], tags: ["bar", "baz"] },
        { id: 2, path: ["b", "b"], tags: ["bar", "baz"] },
        { id: 3, path: ["b"], tags: ["baz"] },
        { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
        { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
        { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
        { id: 5, path: ["q"], tags: ["qux"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
  });

  test("get by path", async () => {
    deepEqual(
      await query(db, "posts", {
        where: {
          path: KeyRange.only(["b", "q"]),
        },
      }),
      [{ id: 4, path: ["b", "q"], tags: ["baz", "qux"] }],
    );
    deepEqual(
      await query(db, "posts", {
        where: {
          path: KeyRange.only(["b"]),
        },
      }),
      [{ id: 3, path: ["b"], tags: ["baz"] }],
    );
  });

  test("get by tag", async () => {
    deepEqual(
      await query(db, "posts", {
        where: {
          // TODO: multi entry feilds aren't typed correctly
          tags: KeyRange.only("foo" as any),
        },
      }),
      [
        { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
    deepEqual(
      await query(db, "posts", {
        where: {
          tags: KeyRange.only("qux" as any),
        },
      }),
      [
        { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
        { id: 5, path: ["q"], tags: ["qux"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
  });
});
