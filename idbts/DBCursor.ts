import { idbReqToPromise } from "./idbReqToPromise.ts";

/**
 * A wrapper for {@link IDBCursor} with more strict types.
 */
export class DBCursor<Value, Key extends IDBValidKey, PrimaryKey extends IDBValidKey = Key> {
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

  get direction(): IDBCursorDirection {
    return this.#cursor.direction;
  }

  /**
   * Advances the cursor by the specified number of records.
   *
   * Resolves with the current cursor after advancing, or null if the end was reached.
   *
   * @see {@link IDBCursor.advance}
   */
  advance(count: number): Promise<DBCursor<Value, Key, PrimaryKey>> {
    this.#cursor.advance(count);
    return idbReqToPromise(this.#cursor.request);
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
  continue(key?: Key): Promise<DBCursor<Value, Key, PrimaryKey>> {
    this.#cursor.continue(key);
    return idbReqToPromise(this.#cursor.request);
  }

  /**
   * Advances the cursor to the next record with the specified key and primary key.
   *
   * Resolves with the current cursor after advancing, or null if the end was reached.
   *
   * @see {@link IDBCursor.continuePrimaryKey}
   */
  continuePrimaryKey(key: Key, primaryKey: PrimaryKey): Promise<DBCursor<Value, Key, PrimaryKey>> {
    this.#cursor.continuePrimaryKey(key, primaryKey);
    return idbReqToPromise(this.#cursor.request);
  }

  /**
   * Updates the value of the current record.
   *
   * Resolves with the primary key of the updated record.
   *
   * @see {@link IDBCursor.update}
   */
  async update(value: Value): Promise<PrimaryKey> {
    await idbReqToPromise(this.#cursor.update(value));
    this.#notify();
    return this.#cursor.primaryKey as PrimaryKey;
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
