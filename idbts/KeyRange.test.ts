import { expectTypeOf } from "expect-type";
import { ok } from "node:assert/strict";
import { test } from "node:test";
import { KeyRange } from "./KeyRange.ts";

test("KeyRange", async (t) => {
  await t.test("primitive key ranges", async (t) => {
    await t.test("only", () => {
      expectTypeOf(KeyRange.only<string>).parameters.toEqualTypeOf<[string]>();
      const r: KeyRange<string> = KeyRange.only("m");
      ok(!r.includes("l"));
      ok(r.includes("m"));
      ok(!r.includes("n"));
    });

    await t.test("bound", () => {
      const type = expectTypeOf(KeyRange.bound<string>);
      type.parameter(0).toEqualTypeOf<string>();
      type.parameter(1).toEqualTypeOf<string>();
      type.parameter(2).toEqualTypeOf<boolean | undefined>();
      type.parameter(3).toEqualTypeOf<boolean | undefined>();
      const r: KeyRange<string> = KeyRange.bound("m", "n");
      expectTypeOf(r.lower).toEqualTypeOf<string | undefined>();
      expectTypeOf(r.upper).toEqualTypeOf<string | undefined>();
      ok(!r.includes("l"));
      ok(r.includes("m"));
      ok(r.includes("n"));
      ok(!r.includes("o"));
    });

    await t.test("lowerBound", () => {
      const type = expectTypeOf(KeyRange.lowerBound<string>);
      type.parameter(0).toEqualTypeOf<string>();
      type.parameter(1).toEqualTypeOf<boolean | undefined>();
      const r: KeyRange<string> = KeyRange.lowerBound("m");
      ok(!r.includes("l"));
      ok(r.includes("m"));
      ok(r.includes("n"));
      ok(r.includes("o"));
    });

    await t.test("upperBound", () => {
      const type = expectTypeOf(KeyRange.upperBound<string>);
      type.parameter(0).toEqualTypeOf<string>();
      type.parameter(1).toEqualTypeOf<boolean | undefined>();
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

  await t.test("array key ranges", async (t) => {
    await t.test("only", () => {
      expectTypeOf(KeyRange.only<readonly [string, number]>)
        .parameter(0)
        .toEqualTypeOf<readonly [string, number]>();
      const r: KeyRange<readonly [string, number]> = KeyRange.only(["m", 1]);
      ok(!r.includes(["l", 1]));
      ok(r.includes(["m", 1]));
      ok(!r.includes(["n", 1]));
    });

    await t.test("bound", () => {
      const type = expectTypeOf(KeyRange.bound<readonly [string, number]>);
      type.parameter(0).toEqualTypeOf<readonly [string, number]>();
      type.parameter(1).toEqualTypeOf<readonly [string, number]>();
      const r: KeyRange<readonly [string, number]> = KeyRange.bound(["m", 1], ["n", 2]);
      ok(!r.includes(["m", 0]));
      ok(r.includes(["m", 1]));
      ok(r.includes(["n", 2]));
      ok(!r.includes(["n", 3]));
    });
  });
});
