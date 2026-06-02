import type { AnyDatabaseSchema, AnyStoreSchema, Database, StoreValue } from "./Database.ts";

export function sendStoreChanges<
  Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
  changes: readonly StoreChange<Schema[StoreName]>[],
): void {
  const chan = getStoreChangesChannel(db, storeName);
  chan.postMessage(changes);
  chan.close();
}

export function getStoreChangesChannel<
  Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
): TypedBroadcastChannel<readonly StoreChange<Schema[StoreName]>[]> {
  return new BroadcastChannel(`idbts:${db.idb.name}:${storeName}`);
}

export interface StoreChange<StoreSchema extends AnyStoreSchema> {
  newValue?: StoreValue<StoreSchema> | undefined;
  oldValue?: StoreValue<StoreSchema> | undefined;
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
