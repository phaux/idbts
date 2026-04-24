import type { DBIndex } from "./DBIndex.ts";
import { getMaxKey, minKey, type KeyRange, type ValidKey } from "./KeyRange.ts";
import type { QueryOptions } from "./query.ts";

export async function* multiDimensionalQuery(
  index: DBIndex<any, any>,
  ranges: readonly (KeyRange<ValidKey> | null | undefined)[],
  options: Pick<QueryOptions<any>, "direction" | "limit"> & { keyRange?: KeyRange<ValidKey> | undefined },
): AsyncGenerator<any, undefined, undefined> {
  const { direction, limit = Infinity, keyRange } = options;
  const reverse = direction === "prev";
  let cursor = await index.openCursor(null, direction);
  let itemIdx = 0;
  items: while (cursor != null) {
    const key = cursor.key as readonly any[];
    // console.log("Cursor key:", key);
    for (let keyIdx = 0; keyIdx < ranges.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (range == null) continue;
      let order = indexedDB.cmp(
        key[keyIdx],
        direction === "prev" ? (range.upper ?? getMaxKey()) : (range.lower ?? minKey),
      );
      if (direction === "prev") order = -order;
      const isBefore = (direction === "prev" ? range.upperOpen : range.lowerOpen) ? order <= 0 : order < 0;
      if (isBefore) {
        const nextKey = key.map((k, idx) =>
          idx < keyIdx ? k : direction === "prev" ? (range.upper ?? getMaxKey()) : (range.lower ?? minKey),
        );
        // console.log("From before skip to", nextKey);
        cursor = await cursor.continue(indexedDB.cmp(nextKey, key) > 0 ? nextKey : undefined);
        continue items;
      }
    }
    if (keyRange) {
      const start = reverse ? keyRange.upper : keyRange.lower;
      if (start != null) {
        let order = indexedDB.cmp(cursor.primaryKey, start);
        if (reverse) order = -order;
        const open = reverse ? keyRange.upperOpen : keyRange.lowerOpen;
        if (open) order -= 1;
        if (order < 0) {
          cursor = await cursor.continuePrimaryKey(cursor.key, start);
          continue items;
        }
      }
    }
    for (let keyIdx = 0; keyIdx < ranges.length; keyIdx++) {
      const range = ranges[keyIdx];
      if (range == null) continue;
      let order = indexedDB.cmp(
        key[keyIdx],
        direction === "prev" ? (range.lower ?? minKey) : (range.upper ?? getMaxKey()),
      );
      if (direction === "prev") order = -order;
      const isAfter = (direction === "prev" ? range.lowerOpen : range.upperOpen) ? order >= 0 : order > 0;
      if (isAfter) {
        const nextKey = key.map((k, idx) => (idx < keyIdx ? k : direction === "prev" ? minKey : getMaxKey()));
        // console.log("From after skip to", nextKey);
        cursor = await cursor.continue(nextKey);
        continue items;
      }
    }
    if (keyRange) {
      const end = reverse ? keyRange.lower : keyRange.upper;
      if (end != null) {
        let order = indexedDB.cmp(cursor.primaryKey, end);
        if (reverse) order = -order;
        const open = reverse ? keyRange.lowerOpen : keyRange.upperOpen;
        if (open) order += 1;
        if (order > 0) {
          cursor = await cursor.continuePrimaryKey(cursor.key, getMaxKey());
          continue items;
        }
      }
    }
    // console.log("Yielding key:", key);
    yield cursor.value;
    itemIdx++;
    if (itemIdx >= limit) break;
    cursor = await cursor.continue();
  }
  // console.log("Done with multi-dimensional query");
}
