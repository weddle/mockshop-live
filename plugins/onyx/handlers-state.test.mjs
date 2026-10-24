import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import YAML from "yaml";
import create, { STATE_COLLECTIONS } from "./handlers-state.mjs";

// A fake mock backend answering the public routes the readers use.
async function backend(t, routes) {
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url, "http://x").pathname];
    res.writeHead(body === undefined ? 404 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}
const handlers = (port, data) => create({ plugin: { ports: { mock: port } }, data: (name) => data[name] || {} });

test("plugin.yaml state_api.collections matches the readers the handler serves", () => {
  const manifest = YAML.parse(fs.readFileSync(new URL("./plugin.yaml", import.meta.url), "utf8"));
  assert.deepEqual([...manifest.state_api.collections].sort(), [...STATE_COLLECTIONS].sort());
});

test("collections answer through the mock's own routes; world keys map to IDs and rows carry _key", async (t) => {
  const port = await backend(t, {
    "/admin/persona": [{ id: 12, name: "Ops", is_listed: false }, { id: 13, name: "Analyst", is_listed: true }, { id: 90, name: "Created live" }],
    "/persona/12": { id: 12, name: "Ops", is_listed: false, system_prompt: "p" },
    "/skills": { builtins: [{ id: "b1", name: "built-in" }], customs: [{ id: "craft-skill-1", name: "mine" }] },
    "/admin/llm/provider": { providers: [{ id: 5, name: "OpenAI" }] },
  });
  const { state } = handlers(port, { entities: { agents: { ops: 12, analyst: 13 }, llm_providers: { main: 5 } } });
  assert.deepEqual((await state(["agents"])).map((r) => r._key), ["ops", "analyst", undefined], "unnamed live rows have no _key");
  assert.equal((await state(["agents", "ops"])).system_prompt, "p", "an item reader returns the full detail row");
  assert.equal((await state(["agents", "analyst"])).name, "Analyst", "no item route -> found in the list by ID");
  assert.equal(await state(["agents", "nobody"]), undefined);
  assert.equal((await state(["agents", "90"])).name, "Created live", "a key the world does not know is a raw ID");
  assert.deepEqual((await state(["skills"])).map((r) => r.name), ["built-in", "mine"]);
  assert.equal((await state(["skills", "craft-skill-1"])).name, "mine");
  assert.equal((await state(["llm_providers", "main"])).name, "OpenAI");
});

test("singletons, browser storage and bad paths", async (t) => {
  const port = await backend(t, { "/user/pinned-assistants": [0, 11], "/me": { id: "u", preferences: { auto_scroll: true } } });
  const { state } = handlers(port, { state: { browser: { local_storage: [{ key: "k", value: "v" }] } } });
  assert.deepEqual(await state(["user", "pinned_agents"]), [0, 11]);
  assert.deepEqual(await state(["user", "preferences"]), { auto_scroll: true });
  assert.deepEqual(await state(["browser"]), { local_storage: [{ key: "k", value: "v" }] });
  assert.deepEqual(await handlers(port, {}).state(["browser"]), {}, "no browser state declared -> empty");
  await assert.rejects(state(["nonsense"]), (e) => e.status === 400 && /unknown state collection "nonsense"/.test(e.message));
  await assert.rejects(state(["user", "nope"]), (e) => e.status === 400);
  await assert.rejects(state(["agents", "a", "b"]), (e) => e.status === 400 && /too deep/.test(e.message));
});
