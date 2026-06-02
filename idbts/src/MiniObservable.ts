export class MiniObservable<T> {
  #cb: (subscriber: MiniSubscriber<T>) => void;

  constructor(cb: (subscriber: MiniSubscriber<T>) => void) {
    this.#cb = cb;
  }

  subscribe(
    { next, error }: MiniObserver<T>,
    { signal }: { signal?: AbortSignal | undefined },
  ): Promise<void> {
    return new Promise((resolve) => {
      this.#cb({ next, error, signal });
      if (signal?.aborted) resolve();
      else signal?.addEventListener("abort", () => resolve());
    });
  }
}

export interface MiniObserver<T> {
  next?: ((value: T) => void) | undefined;
  error?: ((error: Error) => void) | undefined;
}

export interface MiniSubscriber<T> extends MiniObserver<T> {
  signal?: AbortSignal | undefined;
}
