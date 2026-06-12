/**
 * A minimal observable abstraction used internally by idbts.
 *
 * @template T - The type of values emitted by the observable.
 */
export class MiniObservable<T> {
  readonly #cb: (subscriber: MiniSubscriber<T>) => void;

  /**
   * Creates a new observable.
   *
   * @param cb - Producer callback invoked on each {@link subscribe} call.
   * Receives a subscriber through which it can push values and react to cancellation.
   */
  constructor(cb: (subscriber: MiniSubscriber<T>) => void) {
    this.#cb = cb;
  }

  /**
   * Subscribes to the observable using the given observer.
   *
   * Pass an abort signal to cancel the subscription in the future.
   * If no signal is supplied the observable never completes,
   * unless an error is encountered.
   */
  subscribe(
    { next, error }: MiniObserver<T>,
    { signal }: { readonly signal?: AbortSignal | undefined } = {},
  ): void {
    this.#cb({ next, error, signal });
  }
}

/**
 * Callbacks that a consumer supplies to receive values or errors from an observable.
 */
export interface MiniObserver<T> {
  /** Called with each value emitted by the producer. */
  readonly next?: ((value: T) => void) | undefined;
  /** Called when the producer encounters an unrecoverable error. */
  readonly error?: ((error: Error) => void) | undefined;
}

/**
 * Extends {@link MiniObserver} with an {@link AbortSignal}
 * that the producer can monitor to detect cancellation
 * and stop emitting values early.
 */
export interface MiniSubscriber<T> extends MiniObserver<T> {
  /**
   * When aborted, signals the producer that the consumer no longer needs values.
   */
  readonly signal?: AbortSignal | undefined;
}
