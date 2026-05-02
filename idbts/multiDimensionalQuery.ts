import { advanceCursorByRanges } from "./advanceCursorByRanges.ts";
import type { DBIndex } from "./DBIndex.ts";
import { type KeyRange, type ValidKey } from "./KeyRange.ts";
import type { QueryOptions } from "./query.ts";

export async function* multiDimensionalQuery(
  index: DBIndex<any, any>,
  keyRanges: readonly (KeyRange<ValidKey> | undefined)[],
  primaryKeyRange: KeyRange<ValidKey> | undefined,
  options: Pick<QueryOptions<any>, "direction" | "limit">,
): AsyncGenerator<any, undefined, undefined> {
  const { direction, limit = Infinity } = options;
  let cursor = await index.openCursor(null, direction);
  let itemIdx = 0;
  while (true) {
    cursor = await advanceCursorByRanges(cursor, [], keyRanges, primaryKeyRange, direction === "prev");
    if (!cursor) break;
    yield cursor.value;
    itemIdx++;
    if (itemIdx >= limit) break;
    cursor = await cursor.continue();
  }
}
