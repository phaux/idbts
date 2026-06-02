import { use, useEffect, useReducer, useRef, useState } from "react";

export interface Subscribable<T> {
  subscribe(observer: SubscribableObserver<T>, options: { signal?: AbortSignal }): void;
}

export interface SubscribableObserver<T> {
  next?: (value: T) => void;
  error?: (err: Error) => void;
  complete?: () => void;
}

const observableCache = new Map<React.DependencyList, Subscribable<unknown>>();
const promiseCache = new WeakMap<Subscribable<unknown>, Promise<unknown>>();
const valueCache = new WeakMap<Subscribable<unknown>, unknown>();

const CLEANUP_DELAY = 3000; // Time to wait before cleaning up unused observables

/**
 * Subscribes to an observable and returns the latest value.
 * Suspends until the first value is received.
 *
 * Calls with the same cache key will reuse the same observable.
 * Cache key must be globally unique.
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
    const observers = new Set<SubscribableObserver<T>>();
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
                // Clone observers in case the list changes during emission
                for (const obs of new Set(observers)) obs.next?.(val);
              },
              error: (err) => {
                const lastObservers = new Set(observers);
                handleFinalize();
                for (const obs of lastObservers) obs.error?.(err);
              },
              complete: () => {
                const lastObservers = new Set(observers);
                handleFinalize();
                for (const obs of lastObservers) obs.complete?.();
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
        if (options.signal?.aborted) unsubscribe();
        else options.signal?.addEventListener("abort", unsubscribe);
        function unsubscribe() {
          if (!observers.has(observer)) return;
          observers.delete(observer);
          // If this was the last subscriber, schedule cleanup
          if (observers.size === 0) scheduleCleanup();
        }

        function handleFinalize() {
          // Reset this observable to the initial state
          controller = undefined;
          observers.clear();
          valueCache.delete(newObservable);
          promiseCache.delete(newObservable);
          // Schedule cleanup in case nobody subscribes again
          scheduleCleanup();
        }

        function scheduleCleanup() {
          if (timeout != null) return; // Cleanup already scheduled
          timeout = setTimeout(() => {
            // Unsubscribe source if any
            controller?.abort();
            controller = undefined;
            // Remove this observable from cache
            for (const [key, value] of observableCache) {
              if (value === newObservable) {
                observableCache.delete(key);
                break;
              }
            }
          }, CLEANUP_DELAY);
        }
      },
    };
    observable = newObservable;
    observableCache.set(cacheKey, newObservable);
  }

  // Get or initialize promise for first value
  let promise = promiseCache.get(observable) as Promise<T> | undefined;
  if (!promise) {
    promise = new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      observable.subscribe(
        {
          next: (val) => {
            resolve(val);
            controller.abort();
          },
          error: (err) => reject(err),
        },
        { signal: controller.signal },
      );
    });
    promiseCache.set(observable, promise);
  }

  const initialValue = use(promise);

  const value = useRef<T>(initialValue);
  const [error, setError] = useState<Error>();
  const rerender = useReducer((x) => x + 1, 0)[1];

  // Set the value immediately on every render.
  // This avoids waiting for effect to run.
  value.current = valueCache.has(observable) ? (valueCache.get(observable) as T) : initialValue;

  // Subscribe to live updates until the source observable changes.
  useEffect(() => {
    const controller = new AbortController();
    observable.subscribe(
      {
        next: (val) => {
          if (!Object.is(val, value.current)) {
            value.current = val;
            rerender();
          }
        },
        error: (err) => setError(err),
      },
      { signal: controller.signal },
    );
    return () => {
      controller.abort();
    };
  }, [observable]);

  if (error) throw error;
  return value.current;
}
