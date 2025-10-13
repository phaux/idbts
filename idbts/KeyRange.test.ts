import { expectTypeOf } from "expect-type";
import { ok } from "node:assert/strict";
import { test } from "node:test";
import { minKey, maxKey, KeyRange } from "./KeyRange.ts";

test("primitive key ranges", async (t) => {
  await t.test("only", () => {
    expectTypeOf(KeyRange.only<string>).parameters.toEqualTypeOf<[string]>();
    const r: KeyRange<string> = KeyRange.only("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(!r.includes("n"));
  });

  await t.test("bound", () => {
    expectTypeOf(KeyRange.bound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, string | typeof maxKey | typeof minKey, boolean?, boolean?]
    >();
    const r: KeyRange<string> = KeyRange.bound("m", "n");
    expectTypeOf(r.lower).toEqualTypeOf<string | typeof minKey | typeof maxKey>();
    expectTypeOf(r.upper).toEqualTypeOf<string | typeof minKey | typeof maxKey>();
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("lowerBound", () => {
    expectTypeOf(KeyRange.lowerBound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, boolean?]
    >();
    const r: KeyRange<string> = KeyRange.lowerBound("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(r.includes("o"));
  });

  await t.test("upperBound", () => {
    expectTypeOf(KeyRange.upperBound<string>).parameters.toEqualTypeOf<
      [string | typeof maxKey | typeof minKey, boolean?]
    >();
    const r: KeyRange<string> = KeyRange.upperBound("n");
    ok(r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("bound to maxKey", () => {
    const r: KeyRange<string> = KeyRange.bound("m", maxKey);
    ok(!r.includes("aaa"));
    ok(r.includes("zzz"));
  });

  await t.test("bound from minKey", () => {
    const r: KeyRange<string> = KeyRange.bound(minKey, "n");
    ok(r.includes("aaa"));
    ok(!r.includes("zzz"));
  });
});

test("array key ranges", async (t) => {
  await t.test("only", () => {
    expectTypeOf(KeyRange.only<[string, number]>).parameters.toEqualTypeOf<[[string, number]]>();
    const r: KeyRange<[string, number]> = KeyRange.only(["m", 1]);
    ok(!r.includes(["l", 1]));
    ok(r.includes(["m", 1]));
    ok(!r.includes(["n", 1]));
  });

  await t.test("bound", () => {
    expectTypeOf(KeyRange.bound<[string, number]>)
      .parameter<0 | 1>(0)
      .toEqualTypeOf<
        | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
        | readonly [string | typeof maxKey | typeof minKey]
      >();
    const r: KeyRange<[string, number]> = KeyRange.bound(["m", 1], ["n", 2]);
    ok(!r.includes(["m", 0]));
    ok(r.includes(["m", 1]));
    ok(r.includes(["n", 2]));
    ok(!r.includes(["n", 3]));
  });
});

test("3 elem array", () => {
  expectTypeOf(KeyRange.bound<[string, number, number]>)
    .parameter<0 | 1>(0)
    .toEqualTypeOf<
      | readonly [
          string | typeof maxKey | typeof minKey,
          number | typeof maxKey | typeof minKey,
          number | typeof maxKey | typeof minKey,
        ]
      | readonly [string | typeof maxKey | typeof minKey, number | typeof maxKey | typeof minKey]
      | readonly [string | typeof maxKey | typeof minKey]
    >();
});
