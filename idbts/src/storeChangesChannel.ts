import type { AnyDatabaseSchema, AnyStoreSchema, Database, StoreEntry } from "./Database.ts";

/**
 * Broadcasts a batch of store changes over a {@link BroadcastChannel}
 * so that other tabs or workers observing the same store can react to the mutations.
 *
 * Use this after making changes to a store using raw IDB methods
 * to notify other contexts of the updates.
 *
 * The channel is opened, the message is posted,
 * and then the channel is immediately closed.
 */
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

/**
 * Returns a BroadcastChannel used to exchange store-change notifications
 * for a specific store in a specific database.
 *
 * The channel name follows the pattern `idbts:<dbName>:<storeName>`,
 * making it unique per (database, store) pair across all browser contexts.
 * Callers are responsible for closing the channel when they are done with it.
 */
export function getStoreChangesChannel<
  Schema extends AnyDatabaseSchema,
  StoreName extends keyof Schema & string,
>(
  db: Database<Schema>,
  storeName: StoreName,
): TypedBroadcastChannel<readonly StoreChange<Schema[StoreName]>[]> {
  return new BroadcastChannel(`idbts:${db.idb.name}:${storeName}`);
}

/**
 * Describes a single record mutation in an object store.
 *
 * - Insert: only `newValue` is present.
 * - Update: both `newValue` and `oldValue` are present.
 * - Delete: only `oldValue` is present.
 */
export interface StoreChange<StoreSchema extends AnyStoreSchema> {
  /**
   * The new value of the record after the mutation,
   * or `undefined` for deletions.
   */
  newValue?: StoreEntry<StoreSchema> | undefined;
  /**
   * The previous value of the record before the mutation,
   * or `undefined` for insertions.
   */
  oldValue?: StoreEntry<StoreSchema> | undefined;
}

/**
 * A type-safe alias for the standard {@link BroadcastChannel}
 * that constrains the payload type of `postMessage` and `addEventListener`
 * to a specific message type `T`.
 *
 * @template T - The type of messages exchanged on this channel.
 */
export type TypedBroadcastChannel<T> = Omit<
  BroadcastChannel,
  "postMessage" | "addEventListener"
> & {
  postMessage: (message: T) => void;
  addEventListener: (
    type: "message",
    listener: (this: BroadcastChannel, ev: MessageEvent<T>) => void,
    options?: boolean | AddEventListenerOptions,
  ) => void;
};
