import { openDB, schema, type DBSchemaOf, type QueryOptions } from "idbts";
import { equal, rejects } from "node:assert/strict";
import { after, afterEach, beforeEach, suite, test } from "node:test";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { useDBQuery } from "../src/useDBQuery.ts";

await suite("useDBQuery", async () => {
  const db = await openDB("use-db-query", 1, {
    users: {
      keyPath: "id",
      value: schema<{
        id: number;
        name: string;
      }>(),
      indexes: {
        byName: { keyPath: "name" },
      },
    },
  });
  after(() => {
    db.idb.close();
  });

  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  function UserList(props: QueryOptions<DBSchemaOf<typeof db>["users"]>) {
    const users = useDBQuery(db, "users", props);
    return users.length > 0
      ? h(
          "ul",
          { id: "userlist" },
          users.map((user) => h("li", { key: user.id }, user.name)),
        )
      : h("p", { id: "userlist" }, "No users");
  }

  async function waitForText(expected: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        equal(container.innerText, expected);
        return;
      } catch (err) {
        if (attempt >= 50) {
          throw err;
        }
      }
      await act(async () => new Promise((resolve) => void setTimeout(resolve, 1)));
    }
  }

  await test("query by primary key", async () => {
    await act(async () => root.render(h(UserList, { where: { id: 1 } })));
    await waitForText("No users");
    await rejects(async () => waitForText("Some user"));
    await act(async () => db.insert("users", { id: 1, name: "Alice" }));
    // DB: 1 Alice
    await waitForText("Alice");
    await act(async () => db.update("users", 1, (entry) => ({ ...entry!, name: "Alice Updated" })));
    // DB: 1 Alice Updated
    await waitForText("Alice Updated");
    await act(async () => root.render(h(UserList, { where: { id: 2 } })));
    await waitForText("No users");
    await act(async () => db.insert("users", { id: 2, name: "Bob" }));
    // DB: 1 Alice Updated, 2 Bob
    await waitForText("Bob");
    await act(async () => db.delete("users", 1));
    // DB: 2 Bob
    await waitForText("Bob");
    await act(async () => db.delete("users", 2));
    // DB: (empty)
    await waitForText("No users");
  });

  await test("query all", async () => {
    await act(async () => root.render(h(UserList, {})));
    await waitForText("No users");
    await act(async () => db.insert("users", { id: 1, name: "Bob" }));
    // DB: 1 Bob
    await waitForText("Bob");
    await act(async () => db.update("users", 1, (entry) => ({ ...entry!, name: "Bob Updated" })));
    // DB: 1 Bob Updated
    await waitForText("Bob Updated");
    await act(async () => db.insert("users", { id: 2, name: "Charlie" }));
    // DB: 1 Bob Updated, 2 Charlie
    await waitForText("Bob UpdatedCharlie");
    await act(async () => root.render(h(UserList, { direction: "prev" })));
    await waitForText("CharlieBob Updated");
    await act(async () => db.delete("users", [1, 2]));
    // DB: (empty)
    await waitForText("No users");
  });

  await test("query by field range", async () => {
    await act(async () =>
      root.render(
        h(UserList, {
          where: { name: { lower: "B", upper: "K\uFFFF" } },
          orderBy: "name", // TODO: should be not needed.
        }),
      ),
    );
    await waitForText("No users");
    await act(async () => db.insert("users", { id: 1, name: "Charlie" }));
    // DB: 1 Charlie
    await waitForText("Charlie");
    await act(async () => db.insert("users", { id: 2, name: "Bob" }));
    // DB: 1 Charlie, 2 Bob
    await waitForText("BobCharlie");
    await act(async () => db.insert("users", { id: 3, name: "Alice" }));
    // DB: 1 Charlie, 2 Bob, 3 Alice
    await waitForText("BobCharlie");
    await act(async () =>
      root.render(
        h(UserList, {
          where: { name: { lower: "B", upper: "B\uFFFF" } },
          orderBy: "name",
        }),
      ),
    );
    await waitForText("Bob");
    await act(async () => db.delete("users", [1, 2]));
    // DB: 3 Alice
    await waitForText("No users");
  });

  await test("query with limit", async () => {
    await act(async () => root.render(h(UserList, { limit: 2 })));
    // DB: 3 Alice
    await act(async () =>
      db.insert("users", [
        { id: 1, name: "Adam" },
        { id: 2, name: "Beth" },
      ]),
    );
    // DB: 1 Adam, 2 Beth, 3 Alice
    await waitForText("AdamBeth");
    await act(async () => db.insert("users", { id: 0, name: "Aaron" }));
    // DB: 0 Aaron, 1 Adam, 2 Beth, 3 Alice
    await waitForText("AaronAdam");
    await act(async () => db.delete("users", 0));
    // DB: 1 Adam, 2 Beth, 3 Alice
    await waitForText("AdamBeth");
    await act(async () => root.render(h(UserList, { limit: 3 })));
    await waitForText("AdamBethAlice");
    await act(async () => db.insert("users", { id: 4, name: "David" }));
    // DB: 1 Adam, 2 Beth, 3 Alice, 4 David
    await waitForText("AdamBethAlice");
    await act(async () => db.delete("users", [3, 4]));
    // DB: 1 Adam, 2 Beth
    await waitForText("AdamBeth");
  });

  await test("query ordered", async () => {
    await act(async () => root.render(h(UserList, { orderBy: "name" })));
    // DB: 1 Adam, 2 Beth
    await waitForText("AdamBeth");
    await act(async () =>
      db.insert("users", [
        { id: 5, name: "Bob" },
        { id: 3, name: "Alice" },
        { id: 0, name: "Zoe" },
      ]),
    );
    // DB: 0 Zoe, 1 Adam, 2 Beth, 3 Alice, 5 Bob
    await waitForText("AdamAliceBethBobZoe");
    await act(async () => db.update("users", 3, (entry) => ({ ...entry!, name: "Cara" })));
    // DB: 0 Zoe, 1 Adam, 2 Beth, 3 Cara, 5 Bob
    await waitForText("AdamBethBobCaraZoe");
    await act(async () => root.render(h(UserList, { orderBy: "id" })));
    await waitForText("ZoeAdamBethCaraBob");
  });
});
