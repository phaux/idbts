import { advanceCursorByRanges } from "./advanceCursorByRanges.ts";
import { idbReqToPromise } from "./idbReqToPromise.ts";
import { type KeyRange, type ValidKey } from "./KeyRange.ts";
import type { QueryOptions } from "./query.ts";

export async function* multiDimensionalQuery<T>(
  index: IDBIndex,
  keyRanges: readonly (KeyRange<ValidKey> | undefined)[],
  primaryKeyRange: KeyRange<ValidKey> | undefined,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<T, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await idbReqToPromise(index.openCursor(null, direction));
  let i = 0;
  while (i < limit) {
    cursor = await advanceCursorByRanges(cursor, keyRanges, primaryKeyRange, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    i++;
    cursor.continue();
    cursor = await idbReqToPromise(cursor.request);
  }
}
