import { MiniObservable } from "idbts";
import { equal } from "node:assert/strict";
import { afterEach, beforeEach, suite, test } from "node:test";
import { act, Component, createElement as h, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { useSubscribable } from "../src/useSubscribable.ts";

await suite("useSubscribable", async () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  function ObservableTester(props: { observable: MiniObservable<string> }) {
    const value = useSubscribable(() => props.observable, [props.observable]);
    return h("span", {}, "Result: " + value);
  }

  class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
      super(props);
      this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error) {
      return { error };
    }

    render() {
      if (this.state.error) {
        return h("span", {}, "Error: " + this.state.error.message);
      }
      return this.props.children;
    }
  }

  function TestWrapper(props: { children: React.ReactNode }) {
    return h(Suspense, { fallback: "Loading..." }, h(ErrorBoundary, null, props.children));
  }

  await test("single observable lifecycle", async () => {
    let next: (value: string) => void;
    let error: (err: Error) => void;
    const observable = new MiniObservable<string>((subscriber) => {
      next = subscriber.next!;
      error = subscriber.error!;
    });
    // Initial render
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(container.innerText, "Loading...", "Should show loading state initially");
    // First emit
    await act(async () => next("Hello"));
    equal(container.innerText, "Result: Hello", "Should display first value");
    // Second emit
    await act(async () => next("World"));
    equal(container.innerText, "Result: World", "Should display second value");
    // Error emit
    await act(async () => error(new Error("Test error")));
    equal(container.innerText, "Error: Test error", "Should display error message");
  });

  await test("failing observable", async () => {
    let error: (error: Error) => void;
    const observable = new MiniObservable<string>((subscriber) => {
      error = subscriber.error!;
    });
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(container.innerText, "Loading...", "Should show loading state initially");
    await act(async () => error(new Error("Test error")));
    equal(container.innerText, "Error: Test error", "Should display error message");
  });

  await test("immediately failing observable", async () => {
    const observable = new MiniObservable<string>((subscriber) => {
      subscriber.error?.(new Error("Test error"));
    });
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(container.innerText, "Error: Test error", "Should display error message");
  });

  await test("observable gets cleaned up after a delay", async (t) => {
    t.mock.timers.enable();
    let initCount = 0;
    const observable = new MiniObservable<string>((subscriber) => {
      initCount++;
      subscriber.next?.("Initial value");
      const timeout = setTimeout(() => {
        subscriber.next?.("Delayed value");
      }, 100);
      subscriber.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
      });
    });
    // Initial render
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(initCount, 1, "Observable should be initialized once");
    equal(container.innerText, "Result: Initial value", "Should display initial value");
    // Wait just before second value is emitted
    await act(async () => t.mock.timers.tick(50));
    equal(
      container.innerText,
      "Result: Initial value",
      "Should still show initial value before timeout",
    );
    // Wait after second value is emitted
    await act(async () => t.mock.timers.tick(100));
    equal(
      container.innerText,
      "Result: Delayed value",
      "Should display delayed value after timeout",
    );
    // Unmount component
    await act(async () => root.render(h(TestWrapper, null, h("span", null, "Removed"))));
    equal(container.innerText, "Removed", "Should show removed text after unmount");
    // Remount component before cleanup runs
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(initCount, 1, "Observable should not be reinitialized on remount before cleanup");
    equal(
      container.innerText,
      "Result: Delayed value",
      "Should get cached value immediately on remount",
    );
    // Unmount again and let cleanup run
    await act(async () => root.render(h(TestWrapper, null, h("span", null, "Removed"))));
    // Advance timers to trigger cleanup
    t.mock.timers.tick(10_000);
    equal(container.innerText, "Removed", "Should show removed text after second unmount");
    // Remount again after cleanup
    await act(async () => root.render(h(TestWrapper, null, h(ObservableTester, { observable }))));
    equal(
      container.innerText,
      "Result: Initial value",
      "Should reinitialize with initial value after cleanup",
    );
    equal(initCount, 2, "Observable should be reinitialized after cleanup");
  });

  await test("multiple mounted components share the same multicast observable", async (t) => {
    let initCount = 0;
    let next: (value: string) => void;
    const observable = new MiniObservable<string>((subscriber) => {
      initCount++;
      next = subscriber.next!;
    });
    // Mount both components at the same time
    await act(async () =>
      root.render(
        h(TestWrapper, null, [
          h(ObservableTester, { observable, key: "comp1" }),
          h(ObservableTester, { observable, key: "comp2" }),
        ]),
      ),
    );
    equal(initCount, 1, "Observable should be initialized only once");
    equal(container.innerText, "Loading...", "Should show loading state while waiting for value");
    t.mock.timers.enable();
    // Emit a value
    await act(async () => next("Update1"));
    equal(
      container.innerText,
      "Result: Update1Result: Update1",
      "Both components should receive the same update",
    );
    // Emit another value
    await act(async () => next("Update2"));
    equal(
      container.innerText,
      "Result: Update2Result: Update2",
      "Both components should receive the second update",
    );
    // Unmount one component
    await act(async () =>
      root.render(h(TestWrapper, null, [h(ObservableTester, { observable, key: "comp1" })])),
    );
    equal(container.innerText, "Result: Update2", "Unmounted component should disappear");
    // Wait for enough time for cleanup to run
    await act(async () => t.mock.timers.tick(10_000));
    equal(container.innerText, "Result: Update2", "One component should still be rendered");
    // Emit another value
    await act(async () => next("Update3"));
    equal(container.innerText, "Result: Update3", "One component should be updated");
    // Render second component again
    await act(async () =>
      root.render(
        h(TestWrapper, null, [
          h(ObservableTester, { observable, key: "comp1" }),
          h(ObservableTester, { observable, key: "comp2" }),
        ]),
      ),
    );
    equal(
      container.innerText,
      "Result: Update3Result: Update3",
      "Both components should be rendered immediately",
    );
    equal(initCount, 1, "Observable should be initialized only once");
  });
});
