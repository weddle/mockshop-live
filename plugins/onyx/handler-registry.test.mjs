import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attach, discoverModules, instantiate } from "./handler-registry.mjs";

function dirWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-registry-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
  return dir;
}
const mod = (id, { order, routes = true, transform = "" } = {}) => `${order === undefined ? "" : `export const order = ${order};`}
export default () => ({ ${routes ? `routes: [{ method: "GET", path: "/${id}", handle() {} }],` : ""}
  transform: { "GET /t": (v) => [...v, "${id}"] }, reset: (b) => { b.calls.push("${id}"); } });`;

test("only handlers-*.mjs files outside the composed list are loaded, ordered by order then name", async (t) => {
  const dir = dirWith(t, {
    "handlers-b.mjs": mod("b"), "handlers-a.mjs": mod("a"), "handlers-early.mjs": mod("early", { order: -5 }),
    "handlers-composed.mjs": "throw new Error('must not be imported')", "helper.mjs": "throw new Error('not a handler module')",
    "handlers.mjs": "throw new Error('the core composition is not a registered module')",
    "handlers-a.test.mjs": "throw new Error('tests are not registered modules')",
  });
  const modules = await discoverModules(dir, { composed: ["handlers-composed.mjs"] });
  assert.deepEqual(modules.map((m) => m.file), ["handlers-early.mjs", "handlers-a.mjs", "handlers-b.mjs"]);
});

test("a handlers-*.mjs without a default create function is rejected by name", async (t) => {
  const dir = dirWith(t, { "handlers-bad.mjs": "export const order = 1;" });
  await assert.rejects(discoverModules(dir), /handlers-bad\.mjs: a registered handler module must default-export create/);
});

test("negative-order modules wrap the core composition; others follow it, for routes, transforms and resets", async (t) => {
  const dir = dirWith(t, { "handlers-late.mjs": mod("late"), "handlers-early.mjs": mod("early", { order: -1 }), "handlers-mid.mjs": mod("mid", { order: 50 }) });
  const handlers = attach(
    { routes: [{ method: "GET", path: "/core", handle() {} }], transform: { "GET /t": (v) => [...v, "core"] }, reset: (b) => b.calls.push("core") },
    instantiate({}, await discoverModules(dir)),
  );
  assert.deepEqual(handlers.routes.map((r) => r.path), ["/early", "/core", "/mid", "/late"]);
  assert.deepEqual(handlers.transform["GET /t"]([]), ["early", "core", "mid", "late"]);
  const body = { calls: [] };
  assert.equal(handlers.reset(body), undefined, "reset stays synchronous when every link is");
  assert.deepEqual(body.calls, ["core", "early", "mid", "late"]);
});

test("a 401 produced early in a transform chain is not passed to later links", async (t) => {
  const dir = dirWith(t, { "handlers-gate.mjs": `export const order = -1;\nexport default () => ({ transform: { "GET /me": () => ({ __status: 401 }) } });` });
  const seen = [];
  const handlers = attach({ routes: [], transform: { "GET /me": (v) => { seen.push(v); return v; } } }, instantiate({}, await discoverModules(dir)));
  assert.deepEqual(handlers.transform["GET /me"]({}), { __status: 401 });
  assert.deepEqual(seen, []);
});
