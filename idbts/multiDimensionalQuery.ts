import { advanceIndexRanges } from "./advanceCursorByRanges.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import { type KeyRange, type ValidKey } from "./KeyRange.ts";
import type { QueryOptions } from "./query.ts";

export async function* multiDimensionalQuery<T>(
  index: IDBObjectStore | IDBIndex,
  keyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  primaryKeyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(index.openCursor(null, direction));
  let i = 0;
  while (i < limit) {
    cursor = await advanceIndexRanges(cursor, keyRanges, primaryKeyRanges, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}

export async function* multiDimensionalIndexQuery<T>(
  index: IDBIndex,
  keyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  primaryKeyRanges: ReadonlyArray<KeyRange<ValidKey> | undefined>,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(index.openCursor(null, direction));
  let i = 0;
  while (i < limit) {
    cursor = await advanceIndexRanges(cursor, keyRanges, primaryKeyRanges, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}
