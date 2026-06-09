import type { MiniObserver } from "idbts";
import { use, useEffect, useReducer, useRef } from "react";

/**
 * Minimal observable interface compatible with any modern observable library.
 */
export interface Subscribable<T> {
  subscribe(observer: MiniObserver<T>, options?: { signal?: AbortSignal }): void;
}

/**
 * Module-level caches shared across all hook invocations.
 * Maps a dependency list (cache key) to its multicast wrapper.
 */
const observableCache = new Map<React.DependencyList, Subscribable<unknown>>();
/**
 * Holds the pending/resolved promise used for React Suspense.
 */
const promiseCache = new WeakMap<Subscribable<unknown>, Promise<void>>();
/**
 * Stores the most recently emitted value so new subscribers get it immediately.
 */
const valueCache = new WeakMap<Subscribable<unknown>, unknown>();
/**
 * Stores the most recently emitted error so new subscribers get it immediately.
 */
const errorCache = new WeakMap<Subscribable<unknown>, Error>();

/** How long (ms) to keep an unsubscribed observable in the cache before tearing it down. */
const CLEANUP_DELAY = 1000;

/**
 * Low-level hook that subscribes to a {@link Subscribable}
 * and returns the latest emitted value.
 *
 * **Suspense integration** — the hook throws a `Promise` (i.e. suspends)
 * until the observable emits its first value,
 * then resolves synchronously on every subsequent render.
 *
 * **Deduplication / multicasting** — observables are keyed by `cacheKey`.
 * If another component calls this hook with an identical key
 * the same underlying subscription is reused.
 * The source observable is kept alive for few seconds
 * after the last subscriber unsubscribes
 * so that brief unmount/remount cycles (e.g. StrictMode double-invocation)
 * do not open redundant connections.
 */
export function useSubscribable<T>(
  getObservable: () => Subscribable<T>,
  cacheKey: React.DependencyList,
): T {
  let observable: Subscribable<T> | undefined;

  // Try to find an existing observable for this cache key
  for (const [key, value] of observableCache) {
    if (key.length === cacheKey.length && key.every((k, i) => Object.is(k, cacheKey[i]))) {
      observable = value;
      break;
    }
  }

  // If no observable was found, create a new one
  if (!observable) {
    // Create a multicast observable which subscribes to source at most once.
    const source = getObservable();
    let controller: AbortController | undefined;
    const observers = new Set<MiniObserver<T>>();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const newObservable: Subscribable<T> = {
      subscribe: (observer, options) => {
        observers.add(observer);

        // Cancel the cleanup timer if it's running
        if (timeout != null) {
          clearTimeout(timeout);
          timeout = undefined;
        }

        // If this is the first subscriber, subscribe to the source observable
        if (!controller) {
          controller = new AbortController();
          source.subscribe(
            {
              next: (val) => {
                valueCache.set(newObservable, val);
                for (const obs of Array.from(observers)) obs.next?.(val);
              },
              error: (err) => {
                errorCache.set(newObservable, err);
                for (const obs of Array.from(observers)) obs.error?.(err);
              },
            },
            { signal: controller.signal },
          );
        }
        // Otherwise, emit the current value to the new subscriber if any
        else if (valueCache.has(newObservable)) {
          observer.next?.(valueCache.get(newObservable) as T);
        }

        // Register the unsubscriber
        if (options?.signal?.aborted) unsubscribe();
        else options?.signal?.addEventListener("abort", unsubscribe);
        function unsubscribe() {
          observers.delete(observer);
          // If this was the last subscriber, schedule cleanup
          if (observers.size === 0) {
            timeout = setTimeout(() => {
              // Unsubscribe source
              controller!.abort();
              // Remove this observable from cache
              valueCache.delete(newObservable);
              errorCache.delete(newObservable);
              promiseCache.delete(newObservable);
              for (const [key, value] of observableCache) {
                if (value === newObservable) {
                  observableCache.delete(key);
                  break;
                }
              }
            }, CLEANUP_DELAY);
          }
        }
      },
    };
    observable = newObservable;
    observableCache.set(cacheKey, newObservable);
  }

  // Get or initialize promise for first value
  let promise = promiseCache.get(observable);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const controller = new AbortController();
      observable.subscribe(
        {
          next: () => {
            resolve();
            controller.abort();
          },
          error: (err) => {
            reject(err);
            controller.abort();
          },
        },
        { signal: controller.signal },
      );
    });
    promiseCache.set(observable, promise);
  }

  use(promise);

  const value = useRef<T>(undefined!); // Will be assigned in next step
  const error = useRef<Error>(undefined);
  const rerender = useReducer((x) => x + 1, 0)[1];

  // Set the value immediately on every render.
  // This avoids waiting for effect to run.
  value.current = valueCache.get(observable) as T;
  error.current = errorCache.get(observable);

  // Subscribe to live updates until the source observable changes.
  useEffect(() => {
    const controller = new AbortController();
    observable.subscribe(
      {
        next: () => {
          // `value.current` will be reassigned in next render
          rerender();
        },
        error: () => {
          rerender();
        },
      },
      { signal: controller.signal },
    );
    return () => {
      controller.abort();
    };
  }, [observable]);

  if (error.current) {
    throw error.current;
  }
  return value.current;
}
