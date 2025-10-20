import "fake-indexeddb/auto";

import { expectTypeOf } from "expect-type";
import fc from "fast-check";
import { deepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { openDB, schema } from "./index.ts";
import { zigZagJoin } from "./zigZagJoin.ts";

test("zigZagJoin", async (t) => {
  await t.test("case 1", async () => {
    const storeSchema = {
      value: schema<{ x: number; y: number }>(),
      autoIncrement: true,
      indexes: {
        byX: { keyPath: "x" },
        byY: { keyPath: "y" },
      },
    } as const;
    const db = await openDB("zigzag-1", 1, {
      points: storeSchema,
    });
    {
      const tx = db.tx("points", "readwrite");
      const store = tx.store("points");
      await Promise.all([
        store.add({ x: 0, y: 0 }),
        store.add({ x: 1, y: 0 }),
        store.add({ x: 0, y: 1 }),
        store.add({ x: 1, y: 1 }),
        store.add({ x: 0, y: 1 }),
        store.add({ x: 1, y: 0 }),
        store.add({ x: 2, y: 2 }),
        tx.done,
      ]);
    }
    {
      const tx = db.tx("points", "readonly");
      expectTypeOf(zigZagJoin<typeof storeSchema>)
        .parameter(1)
        .toEqualTypeOf<ReadonlyArray<readonly ["byX", number] | readonly ["byY", number]>>();
      const results = await Array.fromAsync(
        zigZagJoin(tx.store("points"), [
          ["byX", 1],
          ["byY", 1],
        ]),
      );
      deepEqual(results, [{ x: 1, y: 1 }]);
    }
  });

  await t.test("properties", async () => {
    let runId = 0;
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(
            fc.record({
              name: fc
                .string({ minLength: 1, unit: "grapheme-ascii" })
                .filter((s) => s.match(/^[a-z_][a-z_0-9]*$/i) != null),
              multiEntry: fc.boolean(),
            }),
            { minLength: 1 },
          )
          .chain((indexes) =>
            fc.record({
              indexes: fc.constant(indexes),
              items: fc.array(
                fc.record(
                  Object.fromEntries(
                    indexes.map((index) => [
                      index.name,
                      index.multiEntry ? fc.array(fc.integer({ min: -1, max: 3 })) : fc.integer({ min: -1, max: 3 }),
                    ]),
                  ),
                ),
              ),
              filters: fc.array(
                fc.tuple(fc.constantFrom(...indexes.map((index) => index.name)), fc.integer({ min: -2, max: 4 })),
                {
                  maxLength: indexes.length,
                },
              ),
            }),
          ),
        async ({ indexes, items, filters }) => {
          const db = await openDB(`zigzag-test-${runId++}`, 1, {
            items: {
              value: schema<any>(),
              autoIncrement: true,
              indexes: Object.fromEntries(
                indexes.map((index) => [index.name, { keyPath: index.name, multiEntry: index.multiEntry }]),
              ),
            },
          });
          {
            const tx = db.tx("items", "readwrite");
            const store = tx.store();
            for (const item of items) {
              store.add(item);
            }
            await tx.done;
          }

          const tx = db.tx("items", "readonly");
          const results = await Array.fromAsync(zigZagJoin(tx.store("items"), filters));

          ok(results.length <= items.length, "result count is at most the number of items");
          ok(
            results.every((result) =>
              filters.every(([indexName, value]) =>
                Array.isArray(result[indexName]) ? result[indexName].includes(value) : result[indexName] === value,
              ),
            ),
            "all results match filters",
          );
          ok(
            results.every((result) => items.some((item) => JSON.stringify(item) === JSON.stringify(result))),
            "all results are in items",
          );

          db.close();
        },
      ),
      {
        numRuns: 1_000,
      },
    );
  });
});
