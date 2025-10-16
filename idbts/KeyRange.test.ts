import "fake-indexeddb/auto";
import "observable-polyfill";

import { expectTypeOf } from "expect-type";
import { ok } from "node:assert/strict";
import { test } from "node:test";
import { KeyRange } from "./KeyRange.ts";

test("primitive key ranges", async (t) => {
  await t.test("only", () => {
    expectTypeOf(KeyRange.only<string>).parameters.toEqualTypeOf<[string]>();
    const r: KeyRange<string> = KeyRange.only("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(!r.includes("n"));
  });

  await t.test("bound", () => {
    expectTypeOf(KeyRange.bound<string>).parameters.toEqualTypeOf<[string, string, boolean?, boolean?]>();
    const r: KeyRange<string> = KeyRange.bound("m", "n");
    expectTypeOf(r.lower).toEqualTypeOf<string>();
    expectTypeOf(r.upper).toEqualTypeOf<string>();
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("lowerBound", () => {
    expectTypeOf(KeyRange.lowerBound<string>).parameters.toEqualTypeOf<[string, boolean?]>();
    const r: KeyRange<string> = KeyRange.lowerBound("m");
    ok(!r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(r.includes("o"));
  });

  await t.test("upperBound", () => {
    expectTypeOf(KeyRange.upperBound<string>).parameters.toEqualTypeOf<[string, boolean?]>();
    const r: KeyRange<string> = KeyRange.upperBound("n");
    ok(r.includes("l"));
    ok(r.includes("m"));
    ok(r.includes("n"));
    ok(!r.includes("o"));
  });

  await t.test("bound to maxKey", () => {
    const r: KeyRange<string> = KeyRange.bound("m", "\uFFFF");
    ok(!r.includes("aaa"));
    ok(r.includes("zzz"));
  });

  await t.test("bound from minKey", () => {
    const r: KeyRange<string> = KeyRange.bound("", "n");
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
      .toEqualTypeOf<[string, number]>();
    const r: KeyRange<[string, number]> = KeyRange.bound(["m", 1], ["n", 2]);
    ok(!r.includes(["m", 0]));
    ok(r.includes(["m", 1]));
    ok(r.includes(["n", 2]));
    ok(!r.includes(["n", 3]));
  });
});
