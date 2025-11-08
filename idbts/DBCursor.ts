import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { ValidKey } from "./KeyRange.ts";

/**
 * A wrapper for {@link IDBCursor} with more strict types.
 */
export class DBCursor<Value, Key extends ValidKey, PrimaryKey extends ValidKey = Key> {
  #cursor: IDBCursorWithValue;

  constructor(cursor: IDBCursorWithValue) {
    this.#cursor = cursor;
  }

  get value(): Value {
    return this.#cursor.value;
  }

  get key(): Key {
    return this.#cursor.key as Key;
  }

  get primaryKey(): PrimaryKey {
    return this.#cursor.primaryKey as PrimaryKey;
  }

  get raw(): IDBCursor {
    return this.#cursor;
  }

  /**
   * Advances the cursor by the specified number of records.
   *
   * Resolves with the current cursor after advancing, or null if the end was reached.
   *
   * @see {@link IDBCursor.advance}
   */
  async advance(count: number): Promise<DBCursor<Value, Key, PrimaryKey> | null> {
    this.#cursor.advance(count);
    const cursor = await idbReqToPromise(this.#cursor.request);
    if (cursor == null) return null;
    return this;
  }

  /**
   * Advances the cursor to the next record.
   *
   * If a key is specified, the cursor is advanced to the next record with at least the specified key.
   *
   * Resolves with the current cursor after advancing, or null if the end was reached.
   *
   * @see {@link IDBCursor.continue}
   */
  async continue(key?: Key): Promise<DBCursor<Value, Key, PrimaryKey> | null> {
    this.#cursor.continue(key as IDBValidKey);
    const cursor = await idbReqToPromise(this.#cursor.request);
    if (cursor == null) return null;
    return this;
  }

  /**
   * Advances the cursor to the next record with the specified key and primary key.
   *
   * Resolves with the current cursor after advancing, or null if the end was reached.
   *
   * @see {@link IDBCursor.continuePrimaryKey}
   */
  async continuePrimaryKey(key: Key, primaryKey: PrimaryKey): Promise<DBCursor<Value, Key, PrimaryKey> | null> {
    this.#cursor.continuePrimaryKey(key as IDBValidKey, primaryKey as IDBValidKey);
    const cursor = await idbReqToPromise(this.#cursor.request);
    if (cursor == null) return null;
    return this;
  }

  /**
   * Updates the value of the current record.
   *
   * Resolves with the primary key of the updated record.
   *
   * @see {@link IDBCursor.update}
   */
  async update(value: Value): Promise<PrimaryKey> {
    const key = await idbReqToPromise(this.#cursor.update(value));
    this.#notify();
    return key as PrimaryKey;
  }

  /**
   * Deletes the current record.
   *
   * Resolves when the record is deleted.
   *
   * @see {@link IDBCursor.delete}
   */
  async delete(): Promise<void> {
    await idbReqToPromise(this.#cursor.delete());
    this.#notify();
  }

  #notify() {
    const source = this.#cursor.source;
    const store = source instanceof IDBIndex ? source.objectStore : source;
    const chan = new BroadcastChannel(`${store.transaction.db.name}-${store.name}`);
    chan.postMessage(this.#cursor.primaryKey);
    chan.close();
  }
}
