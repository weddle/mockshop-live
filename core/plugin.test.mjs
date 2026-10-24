import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPlugin, resolvePorts } from "./plugin.mjs";

const declared = { web: 3300, mock: 8800 };

test("MOCKSHOP_PORT_OFFSET shifts every declared port", () => {
  assert.deepEqual(resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: "100" }), { web: 3400, mock: 8900 });
  assert.deepEqual(resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: "-50" }), { web: 3250, mock: 8750 });
});

test("no or empty offset leaves ports unchanged", () => {
  assert.deepEqual(resolvePorts(declared, "onyx", {}), declared);
  assert.deepEqual(resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: "" }), declared);
  assert.deepEqual(resolvePorts(undefined, "onyx", { MOCKSHOP_PORT_OFFSET: "5" }), {});
});

test("an explicit per-port env override is absolute, not offset", () => {
  assert.deepEqual(resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: "100", MOCKSHOP_ONYX_WEB_PORT: "4000" }), { web: 4000, mock: 8900 });
});

test("non-integer offsets and out-of-range results are rejected", () => {
  for (const bad of ["abc", "1.5", "10x"]) assert.throws(() => resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: bad }), /must be an integer/);
  assert.throws(() => resolvePorts(declared, "onyx", { MOCKSHOP_PORT_OFFSET: "60000" }), /outside 1-65535/);
});

test("loadPlugin applies the offset to ports and to {{ports.*}} templating in start.env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-ports-"));
  const name = "portsprobe";
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "plugin.yaml"), `name: ${name}\nports: { web: 3300, mock: 8800 }\nstart:\n  command: x\n  env: { PORT: "{{ports.web}}", INTERNAL_URL: "http://127.0.0.1:{{ports.mock}}" }\n`);
  const saved = { path: process.env.MOCKSHOP_PLUGIN_PATH, offset: process.env.MOCKSHOP_PORT_OFFSET };
  process.env.MOCKSHOP_PLUGIN_PATH = dir;
  process.env.MOCKSHOP_PORT_OFFSET = "20";
  try {
    const m = loadPlugin(name);
    assert.deepEqual(m.ports, { web: 3320, mock: 8820 });
    assert.deepEqual(m.start.env, { PORT: "3320", INTERNAL_URL: "http://127.0.0.1:8820" });
  } finally {
    for (const [k, v] of [["MOCKSHOP_PLUGIN_PATH", saved.path], ["MOCKSHOP_PORT_OFFSET", saved.offset]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
