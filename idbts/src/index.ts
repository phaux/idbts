export * from "./Database.ts";
export * from "./liveQueryDB.ts";
export * from "./MiniObservable.ts";
export * from "./openDB.ts";
export * from "./queryDB.ts";
export * from "./schema.ts";
export * from "./storeChangesChannel.ts";

declare global {
  interface IDBCursorWithValue {
    request: IDBRequest<IDBCursorWithValue | null>;
  }
}
