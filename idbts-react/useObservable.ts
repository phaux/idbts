import type { Observable } from "observable-polyfill/fn";
import { use, useEffect, useState } from "react";

/**
 * Subscribes to an observable and returns the latest value.
 * Suspends until the first value is received.
 */
export function useObservable<T>(getObservable: () => Observable<T>, deps: React.DependencyList): T {
  const key = stringify(deps);
  let observable = OBSERVABLE_CACHE.get(key);
  if (!observable) {
    observable = getObservable();
    OBSERVABLE_CACHE.set(key, observable);
  }
  const firstValue = usePromise(() => observable.first(), deps);
  const [value, setValue] = useState(firstValue);
  useEffect(() => {
    const ac = new AbortController();
    observable.subscribe({ next: (v) => setValue(v) }, { signal: ac.signal });
    return () => ac.abort();
  }, [observable]);
  return value;
}

/**
 * Returns the result of a promise.
 * Suspends until the promise is resolved.
 */
export function usePromise<T>(getPromise: () => Promise<T>, deps: React.DependencyList): T {
  const key = stringify(deps);
  let promise = PROMISE_CACHE.get(key);
  if (!promise) {
    promise = getPromise().finally(() => {
      setTimeout(() => {
        PROMISE_CACHE.delete(key);
      }, 1000);
    });
    PROMISE_CACHE.set(key, promise);
  }
  return use(promise);
}

const PROMISE_CACHE = new Map<string, Promise<any>>();

export const stringify = (value: readonly any[]) =>
  JSON.stringify(value, (_, value) => {
    if (value instanceof IDBKeyRange) {
      return {
        lower: value.lower,
        upper: value.upper,
        lowerOpen: value.lowerOpen,
        upperOpen: value.upperOpen,
      };
    }
    return value;
  });

const OBSERVABLE_CACHE = new Map<string, Observable<any>>();
