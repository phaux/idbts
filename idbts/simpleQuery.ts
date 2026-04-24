import type { DBIndex } from "./DBIndex.ts";
import type { ReadonlyDBStore } from "./DBStore.ts";
import type { KeyRange, ValidKey } from "./KeyRange.ts";
import type { QueryOptions } from "./query.ts";

export async function* simpleQuery(
  store: ReadonlyDBStore<any> | DBIndex<any, any>,
  range: KeyRange<ValidKey> | null | undefined,
  options: Pick<QueryOptions<any>, "direction" | "offset" | "limit">,
): AsyncGenerator<any, undefined, undefined> {
  const { direction, offset = 0, limit = Infinity } = options;
  let cursor = await store.openCursor(range, direction);
  if (offset > 0 && cursor != null) cursor = await cursor.advance(offset);
  let i = 0;
  while (cursor != null) {
    yield cursor.value;
    i++;
    if (i >= limit) break;
    cursor = await cursor.continue();
  }
}
