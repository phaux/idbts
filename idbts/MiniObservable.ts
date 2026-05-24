export class MiniObservable<T> {
  #cb: (subscriber: MiniSubscriber<T>) => void;

  constructor(cb: (subscriber: MiniSubscriber<T>) => void) {
    this.#cb = cb;
  }

  subscribe({ next }: MiniObserver<T>, { signal }: SubscribeOptions): Promise<void> {
    return new Promise((resolve) => {
      this.#cb({ next, signal });
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve());
    });
  }
}

export interface MiniObserver<T> {
  next(value: T): void;
}

export interface SubscribeOptions {
  signal: AbortSignal;
}

export interface MiniSubscriber<T> extends MiniObserver<T>, SubscribeOptions {}
