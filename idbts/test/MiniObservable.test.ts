import { deepEqual, equal } from "node:assert/strict";
import { suite, test } from "node:test";
import { MiniObservable } from "../src/MiniObservable.ts";

await suite("MiniObservable", async () => {
  await test("emits values through next callback", () => {
    const observable = new MiniObservable<number>((subscriber) => {
      subscriber.next?.(1);
      subscriber.next?.(2);
    });

    const values: number[] = [];
    observable.subscribe({ next: (value) => values.push(value) });

    deepEqual(values, [1, 2]);
  });

  await test("forwards errors via error callback", () => {
    const observable = new MiniObservable<number>((subscriber) => {
      subscriber.error?.(new Error("boom"));
    });

    let receivedError: Error | undefined;
    observable.subscribe({
      error: (error) => {
        receivedError = error;
      },
    });

    equal(receivedError?.message, "boom");
  });

  await test("respects abort signal", async () => {
    const controller = new AbortController();
    let aborted = false;
    const observable = new MiniObservable<number>((subscriber) => {
      subscriber.signal?.addEventListener("abort", () => {
        aborted = true;
      });
    });

    observable.subscribe({}, { signal: controller.signal });
    equal(aborted, false);
    controller.abort();
    equal(aborted, true);
  });
});
