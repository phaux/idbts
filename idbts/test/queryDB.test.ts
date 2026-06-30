import "./test.env.ts";

import { expectTypeOf } from "expect-type";
import { deepEqual, rejects } from "node:assert/strict";
import { after, suite, test } from "node:test";
import type { AnyDatabaseSchema } from "../src/Database.ts";
import { openDB } from "../src/openDB.ts";
import { queryDB } from "../src/queryDB.ts";
import { schema } from "../src/schema.ts";

await suite("queryDB", { concurrency: true }, async () => {
  interface Person {
    id: number;
    name: { first: string; last: string };
    age: number;
    points: number;
    level?: number;
  }

  const dbSchema = {
    people: {
      itemSchema: schema<Person>(),
      primaryKeyPath: "id",
      indexedKeyPaths: {
        "name.first": {},
        "name.last": { sortable: true },
        age: {},
        points: { sortable: true },
      },
    },
  } as const satisfies AnyDatabaseSchema;

  const db = await openDB("query-simple", 1, dbSchema);

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
  ] as const satisfies readonly Person[];

  await db.insert("people", data);

  expectTypeOf(queryDB<typeof dbSchema, "people">)
    .parameter(2)
    .toEqualTypeOf<{
      readonly where?:
        | {
            readonly id?: number;
            readonly "name.first"?: string;
            readonly "name.last"?: string;
            readonly age?: number;
            readonly points?: number;
          }
        | undefined;
      readonly orderBy?: "id" | "name.last" | "points" | undefined;
      readonly limit?: number | undefined;
      readonly lower?: number | string | undefined;
      readonly upper?: number | string | undefined;
      readonly lowerOpen?: boolean | undefined;
      readonly upperOpen?: boolean | undefined;
      readonly reverse?: boolean | undefined;
    }>(undefined as never);

  await test("get all", async () => {
    deepEqual(await queryDB(db, "people", {}), data);
  });

  await test("get all reversed", async () => {
    deepEqual(await queryDB(db, "people", { reverse: true }), [...data].reverse());
  });

  await test("get all with limit", async () => {
    deepEqual(await queryDB(db, "people", { limit: 5 }), data.slice(0, 5));
  });

  await test("get all with limit reversed", async () => {
    deepEqual(
      await queryDB(db, "people", { limit: 5, reverse: true }),
      data.toReversed().slice(0, 5),
    );
  });

  await test("get all ordered", async () => {
    deepEqual(
      await queryDB(db, "people", { orderBy: "name.last" }),
      data.toSorted((a, b) => a.name.last.localeCompare(b.name.last)),
    );
  });

  await test("get all ordered reversed", async () => {
    deepEqual(
      await queryDB(db, "people", { orderBy: "points", reverse: true }),
      data.toSorted((a, b) => a.points - b.points).reverse(),
    );
  });

  await test("get all ordered with limit", async () => {
    deepEqual(
      await queryDB(db, "people", { orderBy: "name.last", limit: 5 }),
      data.toSorted((a, b) => a.name.last.localeCompare(b.name.last)).slice(0, 5),
    );
  });

  await test("get all ordered with limit reversed", async () => {
    deepEqual(
      await queryDB(db, "people", { orderBy: "points", limit: 5, reverse: true }),
      data
        .toSorted((a, b) => a.points - b.points)
        .reverse()
        .slice(0, 5),
    );
  });

  await test("get all ordered with invalid order", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          // @ts-expect-error -- non-existent field
          orderBy: "level",
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by key equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 1 },
      }),
      [data[0]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 15 },
      }),
      [data[7]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 10 },
      }),
      [],
    );
  });

  await test("get by key equality reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 1 },
        reverse: true,
      }),
      [data[0]],
    );
  });

  await test("get by key equality with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 3 },
        limit: 1,
      }),
      [data[1]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 5 },
        limit: 0,
      }),
      [],
    );
  });

  await test("get by key equality with order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 7 },
        orderBy: "points",
      }),
      [data[3]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 9 },
        orderBy: "name.last",
        reverse: true,
      }),
      [data[4]],
    );
  });

  await test("get by key equality and field range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 7 },
        orderBy: "points",
        upper: 1000,
      }),
      [data[3]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 9 },
        orderBy: "name.last",
        reverse: true,
        lower: "Z",
      }),
      [],
    );
  });

  await test("get by key equality and field equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          id: 1,
          "name.first": "Alicja",
        },
      }),
      [data[0]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          id: 1,
          "name.first": "Nobody",
        },
      }),
      [],
    );
  });

  await test("get by key equality and key range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 5 },
        orderBy: "id",
        lower: 3,
        upper: 7,
      }),
      [data[2]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { id: 9 },
        lower: 3,
        upper: 7,
      }),
      [],
    );
  });

  await test("get by key range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "id",
        lower: 9,
        upper: 13,
      }),
      [data[4], data[5], data[6]],
    );
    deepEqual(
      await queryDB(db, "people", {
        upper: 5,
      }),
      [data[0], data[1], data[2]],
    );
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "id",
        lower: 25,
        lowerOpen: true,
      }),
      [data[13], data[14]],
    );
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "id",
        lower: 999,
      }),
      [],
    );
  });

  await test("get by key range reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "id",
        lower: 13,
        upper: 17,
        reverse: true,
      }),
      [data[8], data[7], data[6]],
    );
  });

  await test("get by key range with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "id",
        lower: 3,
        upper: 12,
        limit: 3,
      }),
      [data[1], data[2], data[3]],
    );
  });

  await test("get by key range with limit reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        lower: 4,
        upper: 16,
        limit: 2,
        reverse: true,
      }),
      [data[7], data[6]],
    );
  });

  await test("get by key range and field equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.first": "Piotr" },
        orderBy: "id",
        upper: 15,
      }),
      [data[6]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        orderBy: "id",
        lower: 17,
        lowerOpen: true,
      }),
      [data[12], data[14]],
    );
  });

  await test("get by key range and multi field equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        upper: 1000,
      }),
      [data[12]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 1000,
      }),
      [data[2]],
    );
  });

  await test("get by field equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.first": "Piotr" },
      }),
      [data[6], data[8]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
      }),
      [data[0], data[2], data[8], data[12], data[14]],
    );
  });

  await test("get by field equality reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.first": "Piotr" },
        reverse: true,
      }),
      [data[8], data[6]],
    );
  });

  await test("get by field equality with matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        orderBy: "name.last",
      }),
      [data[0], data[2], data[8], data[12], data[14]],
    );
  });

  await test("get by field equality with non-matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        orderBy: "points",
      }),
      [data[12], data[2], data[14], data[0], data[8]],
    );
  });

  await test("get by field equality with matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        orderBy: "name.last",
        lower: "Z",
      }),
      [],
    );
  });

  await test("get by field equality with non-matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        orderBy: "points",
        upper: 1000,
        upperOpen: true,
      }),
      [data[12]],
    );
  });

  await test("get by field equality with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: { "name.last": "Nowak" },
        limit: 3,
      }),
      [data[0], data[2], data[8]],
    );
  });

  await test("get by invalid field equality", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          // @ts-expect-error -- non-existent field
          where: { level: 5 },
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by field equality with invalid order", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: { age: 30 },
          // @ts-expect-error -- non sortable field
          orderBy: "name.first",
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by field range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "P",
        upper: "S\uffff",
      }),
      [data[4], data[13]],
    );
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "P",
        lowerOpen: true,
      }),
      [data[4], data[13], data[3], data[10]],
    );
  });

  await test("get by field range and key", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "P",
        upper: "S\uffff",
        where: { id: 9 },
      }),
      [data[4]],
    );
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "P",
        lowerOpen: true,
        where: { id: 0 },
      }),
      [],
    );
  });

  await test("get by undefined field", async () => {
    deepEqual(
      await queryDB(db, "people", {
        // @ts-expect-error -- undefined is not allowed
        where: { "name.first": undefined },
      }),
      data, // undefined is ignored
    );
    deepEqual(
      await queryDB(db, "people", {
        // @ts-expect-error -- undefined is not allowed
        where: { "name.last": undefined },
      }),
      data,
    );
  });

  await test("get by field range reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "P",
        upper: "S\uffff",
        reverse: true,
      }),
      [data[13], data[4]],
    );
  });

  await test("get by field range with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "A",
        upper: "M\uffff",
        limit: 2,
      }),
      [data[5], data[6]],
    );
  });

  await test("get by field range with limit reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        orderBy: "name.last",
        lower: "A",
        upper: "M\uffff",
        limit: 2,
        reverse: true,
      }),
      [data[11], data[7]],
    );
  });

  await test("get by invalid field range", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          // @ts-expect-error -- non-existent field
          orderBy: "level",
          lower: 3,
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by invalid undefined field", async () => {
    deepEqual(
      await queryDB(db, "people", {
        // @ts-expect-error -- undefined is not allowed + non-existent field
        where: { level: undefined },
      }),
      data,
    );
  });

  await test("get by multi field equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
      }),
      [data[2], data[12]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          points: 810,
        },
      }),
      [data[12]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Piotr",
          "name.last": "Kowalski",
        },
      }),
      [],
    );
  });

  await test("get by field and key equality", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          id: 5,
        },
      }),
      [data[2]],
    );
  });

  await test("get by multi field and key equality, ", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
      }),
      [data[12]],
    );
  });

  await test("get by multi field equality reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        reverse: true,
      }),
      [data[12], data[2]],
    );
  });

  await test("get by multi field equality with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        limit: 1,
      }),
      [data[2]],
    );
  });

  await test("get by invalid multi field equality", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: {
            "name.first": "Maciej",
            // @ts-expect-error -- non-existent field
            level: 1,
          },
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by multi field equality with non-matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
      }),
      [data[12], data[2]],
    );
  });

  await test("get by multi field equality with matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "name.last",
      }),
      [data[2], data[12]],
    );
  });

  await test("get by multi field equality with order reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        reverse: true,
      }),
      [data[2], data[12]],
    );
  });

  await test("get by multi field equality with invalid order", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: {
            "name.first": "Maciej",
            "name.last": "Nowak",
          },
          // @ts-expect-error -- non-existent field
          orderBy: "level",
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by field and key equality with non-matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          id: 5,
        },
        orderBy: "points",
      }),
      [data[2]],
    );
  });

  await test("get by multi field and key equality with non-matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "points",
      }),
      [data[12]],
    );
  });

  await test("get by field and key equality with matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          id: 5,
        },
        orderBy: "name.last",
      }),
      [data[2]],
    );
  });

  await test("get by multi field and key equality with matching order", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "name.last",
      }),
      [data[12]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Nikt",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "name.last",
      }),
      [],
    );
  });

  await test("get by field equality and range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 1000,
        upper: 1450,
      }),
      [data[2], data[14], data[0]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Piotr",
        },
        orderBy: "points",
        lower: 1500,
        upper: 1515,
        lowerOpen: true,
      }),
      [data[6]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 1000,
      }),
      [data[2], data[14], data[0], data[8]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
        },
        orderBy: "points",
        upper: 1450,
      }),
      [data[12], data[2], data[14], data[0]],
    );
  });

  await test("get by multi field equality and range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 500,
      }),
      [data[12], data[2]],
    );
  });

  await test("get by field equality and range reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 1000,
        upper: 1450,
        reverse: true,
      }),
      [data[0], data[14], data[2]],
    );
  });

  await test("get by multi field equality and range reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 500,
        reverse: true,
      }),
      [data[2], data[12]],
    );
  });

  await test("get by field equality and range with limit", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 1000,
        upper: 1450,
        limit: 2,
      }),
      [data[2], data[14]],
    );
  });

  await test("get by multi field equality and range with limit reversed", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
        },
        orderBy: "points",
        lower: 500,
        reverse: true,
        limit: 1,
      }),
      [data[2]],
    );
  });

  await test("get by invalid field equality and range", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: {
            "name.last": "Nowak",
          },
          // @ts-expect-error -- non-existent field
          orderBy: "level",
          lower: 0,
          upper: 100,
        }),
      { name: "NotFoundError" },
    );
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: {
            // @ts-expect-error -- non-existent field
            level: 1,
          },
          orderBy: "points",
          lower: 0,
          upper: 1000,
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by invalid multi field equality and range", async () => {
    await rejects(
      async () =>
        queryDB(db, "people", {
          where: {
            "name.first": "Maciej",
            "name.last": "Nowak",
          },
          // @ts-expect-error -- non-existent field
          orderBy: "level",
          lower: 0,
        }),
      { name: "NotFoundError" },
    );
  });

  await test("get by field and key equality and non-matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          id: 5,
        },
        orderBy: "points",
        lower: 1000,
      }),
      [data[2]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          id: 5,
        },
        orderBy: "points",
        upper: 1000,
      }),
      [],
    );
  });

  await test("get by multi field and key equality and non-matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "points",
        upper: 1000,
      }),
      [data[12]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "points",
        lower: 1000,
      }),
      [],
    );
  });

  await test("get by field and key equality and matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
          id: 5,
        },
        orderBy: "name.last",
        lower: "F",
      }),
      [data[2]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.last": "Nowak",
          id: 5,
        },
        orderBy: "name.last",
        lower: "X",
      }),
      [],
    );
  });

  await test("get by multi field and key equality and matching range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "name.last",
        lower: "X",
      }),
      [],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "name.last",
        upper: "X",
      }),
      [data[12]],
    );
  });

  await test("get by field and key equality and key range", async () => {
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 5,
        },
        orderBy: "id",
        lower: 5,
      }),
      [data[2]],
    );
    deepEqual(
      await queryDB(db, "people", {
        where: {
          "name.first": "Maciej",
          "name.last": "Nowak",
          id: 25,
        },
        orderBy: "id",
        upper: 5,
      }),
      [],
    );
  });

  after(() => {
    db.idb.close();
  });
});

await suite("queryDB with optional fields", { concurrency: true }, async () => {
  interface Item {
    email: string;
    name?: string;
    age?: number;
  }

  const dbSchema = {
    items: {
      itemSchema: schema<Item>(),
      primaryKeyPath: "email",
      indexedKeyPaths: {
        name: { sortable: true },
        age: {},
      },
    },
  } as const satisfies AnyDatabaseSchema;

  const db = await openDB("query-opt", 1, dbSchema);

  const data: Item[] = [
    { email: "a@example.com", name: "Alice" },
    { email: "b@example.com", name: "Bob", age: 45 },
    { email: "c@example.com", age: 15 },
  ];
  await db.insert("items", data);

  expectTypeOf(queryDB<typeof dbSchema, "items">)
    .parameter(2)
    .toEqualTypeOf<{
      readonly where?:
        | {
            readonly email?: string;
            readonly name?: string;
            readonly age?: number;
          }
        | undefined;
      readonly orderBy?: "email" | "name" | undefined;
      readonly lower?: string | undefined;
      readonly upper?: string | undefined;
      readonly lowerOpen?: boolean | undefined;
      readonly upperOpen?: boolean | undefined;
      readonly reverse?: boolean | undefined;
      readonly limit?: number | undefined;
    }>(undefined as never);

  await test("order by email", async () => {
    deepEqual(
      await queryDB(db, "items", {
        orderBy: "email",
      }),
      data,
    );
  });

  await test("order by name", async () => {
    deepEqual(
      await queryDB(db, "items", {
        orderBy: "name",
      }),
      [data[0], data[1]],
    );
  });

  await test("order by age", async () => {
    deepEqual(
      await queryDB(db, "items", {
        // @ts-expect-error -- age is not sortable
        orderBy: "age",
      }),
      [data[2], data[1]],
    );
  });
});

await suite("queryDB with multi entry index", { concurrency: true }, async () => {
  interface Post {
    id: number;
    path: string[];
    tags: string[];
  }

  const dbSchema = {
    posts: {
      itemSchema: schema<Post>(),
      primaryKeyPath: "id",
      indexedKeyPaths: {
        path: { sortable: true },
        tags: { multiEntry: true },
      },
    },
  } as const satisfies AnyDatabaseSchema;

  const db = await openDB("query-multi", 1, dbSchema);

  const data: Post[] = [
    { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
    { id: 2, path: ["b", "b"], tags: ["bar", "baz"] },
    { id: 3, path: ["b"], tags: ["baz"] },
    { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
    { id: 5, path: ["q"], tags: ["qux"] },
    { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
  ];
  await db.insert("posts", data);

  expectTypeOf(queryDB<typeof dbSchema, "posts">)
    .parameter(2)
    .toEqualTypeOf<{
      readonly where?:
        | {
            readonly id?: number;
            readonly path?: string[];
            readonly tags?: string[];
          }
        | undefined;
      readonly orderBy?: "id" | "path" | undefined;
      readonly lower?: number | string[] | undefined;
      readonly upper?: number | string[] | undefined;
      readonly lowerOpen?: boolean | undefined;
      readonly upperOpen?: boolean | undefined;
      readonly limit?: number | undefined;
      readonly reverse?: boolean | undefined;
    }>(undefined as never);

  await test("order by path", async () => {
    deepEqual(
      await queryDB(db, "posts", {
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

  await test("get by path", async () => {
    deepEqual(
      await queryDB(db, "posts", {
        where: {
          path: ["b", "q"],
        },
      }),
      [{ id: 4, path: ["b", "q"], tags: ["baz", "qux"] }],
    );
    deepEqual(
      await queryDB(db, "posts", {
        where: {
          path: ["b"],
        },
      }),
      [{ id: 3, path: ["b"], tags: ["baz"] }],
    );
  });

  await test("get by tag", async () => {
    deepEqual(
      await queryDB(db, "posts", {
        where: {
          // @ts-expect-error: multi entry feilds aren't typed correctly
          tags: "foo",
        },
      }),
      [
        { id: 1, path: ["f", "b"], tags: ["foo", "bar"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
    deepEqual(
      await queryDB(db, "posts", {
        where: {
          // @ts-expect-error: multi entry feilds aren't typed correctly
          tags: "qux",
        },
      }),
      [
        { id: 4, path: ["b", "q"], tags: ["baz", "qux"] },
        { id: 5, path: ["q"], tags: ["qux"] },
        { id: 6, path: ["q", "f"], tags: ["qux", "foo"] },
      ],
    );
  });

  // TODO: get by multiple tags
});
