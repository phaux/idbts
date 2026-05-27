import { advanceCursorByPrimaryKeyRange } from "./advanceCursorByRanges.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import type { QueryOptions } from "./query.ts";

export async function* simpleQuery<T>(
  store: IDBObjectStore,
  keyRange: IDBKeyRange | undefined,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(store.openCursor(keyRange, direction));
  let i = 0;
  while (cursor && i < limit) {
    i++;
    yield cursor.value;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}

export async function* simpleQuery2<T>(
  index: IDBIndex,
  keyRange: IDBKeyRange | undefined,
  primaryKeyRange: IDBKeyRange | undefined,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(index.openCursor(keyRange, direction));
  let i = 0;
  while (cursor && i < limit) {
    if (primaryKeyRange) {
      const oldKey = cursor.primaryKey;
      const nextCursor = await advanceCursorByPrimaryKeyRange(
        cursor,
        primaryKeyRange,
        direction === "prev",
      );
      if (!nextCursor || indexedDB.cmp(nextCursor.primaryKey, oldKey) !== 0) {
        cursor = nextCursor;
        continue;
      }
    }
    i++;
    yield cursor.value;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}
