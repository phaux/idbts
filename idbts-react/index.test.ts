import "./test.env.ts";

import { equal } from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { openDB, schema, useDBQuery, useDBQueryAll, useDBQueryAllBy } from "./index.ts";

const dbSchema = {
  users: {
    keyPath: "id",
    autoIncrement: true,
    value: schema<{
      id?: number;
      name: string;
      email: string;
    }>(),
    indexes: {
      email: { keyPath: "email", unique: true },
    },
  },
} as const;

test("useDBQuery", async () => {
  const db = await openDB("test-db", 1, dbSchema);

  const container = document.createElement("div");
  document.body.appendChild(container);

  function Component() {
    const user = useDBQuery(db, "users", 1);
    return createElement("h1", null, user?.name ?? "No user");
  }

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Component));
    await delay(100);
  });

  equal(container.querySelector("h1")!.textContent, "No user");

  let id = 0;
  await act(async () => {
    id = await db.add("users", { name: "Alice", email: "alice@example.com" });
    await delay(100);
  });

  equal(container.querySelector("h1")!.textContent, "Alice");

  await act(async () => {
    await db.put("users", { id, name: "Alice Updated", email: "alice@example.com" });
    await delay(100);
  });

  equal(container.querySelector("h1")!.textContent, "Alice Updated");

  await act(async () => {
    await db.tx("users", "readwrite").store().delete(id);
    await delay(100);
  });

  equal(container.querySelector("h1")!.textContent, "No user");

  await act(async () => {
    root.unmount();
  });

  container.remove();
  db.close();
});

test("useDBQueryAll", async () => {
  const db = await openDB("test-db", 1, dbSchema);

  const container = document.createElement("div");
  document.body.appendChild(container);

  function Component() {
    const users = useDBQueryAll(db, "users");
    return users.length > 0
      ? createElement(
          "ul",
          { id: "userlist" },
          users.map((user) => createElement("li", { key: user.id }, user.name)),
        )
      : createElement("p", { id: "userlist" }, "No users");
  }

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Component));
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "No users");

  let id = 0;
  await act(async () => {
    id = await db.add("users", { name: "Bob", email: "bob@example.com" });
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "Bob");

  await act(async () => {
    await db.put("users", { id, name: "Bob Updated", email: "bob@example.com" });
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "Bob Updated");

  await act(async () => {
    await db.add("users", { name: "Charlie", email: "charlie@example.com" });
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "Bob UpdatedCharlie");

  await act(async () => {
    await db.tx("users", "readwrite").store().clear();
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "No users");

  await act(async () => {
    root.unmount();
  });

  container.remove();
  db.close();
});

test("useDBQueryAllBy", async () => {
  const db = await openDB("test-db", 1, dbSchema);

  const container = document.createElement("div");
  document.body.appendChild(container);

  function Component() {
    const users = useDBQueryAllBy(db, "users", "email");
    return users.length > 0
      ? createElement(
          "ul",
          { id: "userlist" },
          users.map((user) => createElement("li", { key: user.id }, user.name)),
        )
      : createElement("p", { id: "userlist" }, "No users");
  }

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Component));
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "No users");

  await act(async () => {
    await db.add("users", { name: "Charlie", email: "charlie@example.com" });
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "Charlie");

  await act(async () => {
    await db.add("users", { name: "Bob", email: "bob@example.com" });
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "BobCharlie");

  await act(async () => {
    await db.tx("users", "readwrite").store().clear();
    await delay(100);
  });

  equal(container.querySelector("#userlist")!.textContent, "No users");

  await act(async () => {
    root.unmount();
  });

  container.remove();
  db.close();
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
