import "fake-indexeddb/auto";

import { expectTypeOf } from "expect-type";
import { ok } from "node:assert/strict";
import { test } from "node:test";
import { minKey, maxKey, TIDBKeyRange } from "./TIDBKeyRange.ts";

test("primitive values", async (t) => {
  await t.test("only", () => {
    expectTypeOf(TIDBKeyRange.only<string>).parameters.toEqualTypeOf<[string]>();
    const r: TIDBKeyRange<string> = TIDBKeyRange.only("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(!r.includes("n"));
  });

  await t.test("bound", () => {
    expectTypeOf(TIDBKeyRange.bound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, string | typeof maxKey | typeof minKey, boolean?, boolean?]
    >();
    const r: TIDBKeyRange<string> = TIDBKeyRange.bound("m", "n");
    expectTypeOf(r.lower).toEqualTypeOf<string | typeof minKey | typeof maxKey>();
    expectTypeOf(r.upper).toEqualTypeOf<string | typeof minKey | typeof maxKey>();
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("lowerBound", () => {
    expectTypeOf(TIDBKeyRange.lowerBound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, boolean?]
    >();
    const r: TIDBKeyRange<string> = TIDBKeyRange.lowerBound("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(r.includes("o"));
  });

  await t.test("upperBound", () => {
    expectTypeOf(TIDBKeyRange.upperBound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, boolean?]
    >();
    const r: TIDBKeyRange<string> = TIDBKeyRange.upperBound("n");
    ok(r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("bound to maxKey", () => {
    const r: TIDBKeyRange<string> = TIDBKeyRange.bound("m", maxKey);
    ok(!r.includes("aaa"));
    ok(r.includes("zzz"));
  });

  await t.test("bound from minKey", () => {
    const r: TIDBKeyRange<string> = TIDBKeyRange.bound(minKey, "n");
    ok(r.includes("aaa"));
    ok(!r.includes("zzz"));
  });
});

test("array values", async (t) => {
  await t.test("only", () => {
    expectTypeOf(TIDBKeyRange.only<[string, number]>).parameters.toEqualTypeOf<[[string, number]]>();
    const r: TIDBKeyRange<[string, number]> = TIDBKeyRange.only(["m", 1]);
    ok(!r.includes(["l", 1]));
    ok(r.includes(["m", 1]));
    ok(!r.includes(["n", 1]));
  });

  await t.test("bound", () => {
    expectTypeOf(TIDBKeyRange.bound<[string, number]>).parameters.toEqualTypeOf<
      [
        (
          | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
          | readonly [string | typeof maxKey | typeof minKey]
        ),
        (
          | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
          | readonly [string | typeof maxKey | typeof minKey]
        ),
        boolean?,
        boolean?,
      ]
    >();
    const r: TIDBKeyRange<[string, number]> = TIDBKeyRange.bound(["m", 1], ["n", 2]);
    ok(!r.includes(["m", 0]));
    ok(r.includes(["m", 1]));
    ok(r.includes(["n", 2]));
    ok(!r.includes(["n", 3]));
  });
});

test("3 elem array", () => {
  expectTypeOf(TIDBKeyRange.bound<[string, number, number]>).parameters.toEqualTypeOf<
    [
      (
        | readonly [
            string | typeof maxKey | typeof minKey,
            number | typeof maxKey | typeof minKey,
            number | typeof maxKey | typeof minKey,
          ]
        | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
        | readonly [string | typeof maxKey | typeof minKey]
      ),
      (
        | readonly [
            string | typeof maxKey | typeof minKey,
            number | typeof maxKey | typeof minKey,
            number | typeof maxKey | typeof minKey,
          ]
        | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
        | readonly [string | typeof maxKey | typeof minKey]
      ),
      boolean?,
      boolean?,
    ]
  >();
});
