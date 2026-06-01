import { openDB, schema } from "idbts";
import { equal } from "node:assert/strict";
import { suite, test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useDBQuery } from "./index.ts";

const dbSchema = {
  users: {
    keyPath: "id",
    value: schema<{
      id: number;
      name: string;
      email: string;
    }>(),
    indexes: {
      email: { keyPath: "email", unique: true },
    },
  },
} as const;

suite("useDBQuery", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);

  test("query by primary key", async () => {
    const db = await openDB("use-query-by-key", 1, dbSchema);

    function Component() {
      const user = useDBQuery(db, "users", { where: { id: 1 } })[0];
      return createElement("h1", null, user?.name ?? "No user");
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Component));
    });

    equal(container.querySelector("h1")!.textContent, "No user");

    await act(async () => {
      await db.insert("users", { id: 1, name: "Alice", email: "alice@example.com" });
    });

    equal(container.querySelector("h1")!.textContent, "Alice");

    await act(async () => {
      await db.update("users", 1, (entry) => ({ ...entry!, name: "Alice Updated" }));
    });

    equal(container.querySelector("h1")!.textContent, "Alice Updated");

    await act(async () => {
      await db.delete("users", 1);
    });

    equal(container.querySelector("h1")!.textContent, "No user");

    await act(async () => {
      root.unmount();
    });

    db.idb.close();
  });

  test("query all", async () => {
    const db = await openDB("use-query-all", 1, dbSchema);

    function Component() {
      const users = useDBQuery(db, "users", {});
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
    });

    equal(container.querySelector("#userlist")!.textContent, "No users");

    await act(async () => {
      await db.insert("users", { id: 1, name: "Bob", email: "bob@example.com" });
    });

    equal(container.querySelector("#userlist")!.textContent, "Bob");

    await act(async () => {
      await db.update("users", 1, (entry) => ({ ...entry!, name: "Bob Updated" }));
    });

    equal(container.querySelector("#userlist")!.textContent, "Bob Updated");

    await act(async () => {
      await db.insert("users", { id: 2, name: "Charlie", email: "charlie@example.com" });
    });

    equal(container.querySelector("#userlist")!.textContent, "Bob UpdatedCharlie");

    await act(async () => {
      await db.delete("users", 1);
      await db.delete("users", 2);
    });

    equal(container.querySelector("#userlist")!.textContent, "No users");

    await act(async () => {
      root.unmount();
    });

    db.idb.close();
  });

  test("query by field", async () => {
    const db = await openDB("use-query-by-field", 1, dbSchema);

    function Component() {
      const users = useDBQuery(db, "users", {
        where: { email: { lower: "b", upper: "k\uFFFF" } },
        orderBy: "email",
      });
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
    });

    equal(container.querySelector("#userlist")!.textContent, "No users");

    await act(async () => {
      await db.insert("users", { id: 1, name: "Charlie", email: "charlie@example.com" });
    });

    equal(container.querySelector("#userlist")!.textContent, "Charlie");

    await act(async () => {
      await db.insert("users", { id: 2, name: "Bob", email: "bob@example.com" });
    });

    equal(container.querySelector("#userlist")!.textContent, "BobCharlie");

    await act(async () => {
      await db.insert("users", { id: 3, name: "Alice", email: "alice@example.com" });
    });

    equal(container.querySelector("#userlist")!.textContent, "BobCharlie");

    await act(async () => {
      await db.delete("users", 1);
      await db.delete("users", 2);
    });

    equal(container.querySelector("#userlist")!.textContent, "No users");

    await act(async () => {
      root.unmount();
    });

    db.idb.close();
  });
});
