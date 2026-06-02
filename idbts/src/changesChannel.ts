export function sendDBChanges<T>(
  dbName: string,
  storeName: string,
  changes: readonly DBChange<T>[],
): void {
  const chan = getDBChangesChannel(dbName, storeName);
  chan.postMessage(changes);
  chan.close();
}

export function getDBChangesChannel<T>(
  dbName: string,
  storeName: string,
): TypedBroadcastChannel<readonly DBChange<T>[]> {
  return new BroadcastChannel(`idbts:${dbName}:${storeName}`);
}

export interface DBChange<T> {
  newValue?: T | undefined;
  oldValue?: T | undefined;
}

export type TypedBroadcastChannel<T> = Omit<
  BroadcastChannel,
  "postMessage" | "addEventListener"
> & {
  postMessage(message: T): void;
  addEventListener(
    type: "message",
    listener: (this: BroadcastChannel, ev: MessageEvent<T>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
};
