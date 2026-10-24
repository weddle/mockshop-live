import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import createWorldSettings from "./handlers-world-settings.mjs";

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "base"));
  fs.writeFileSync(path.join(dir, "base", "00-core.yaml"), "GET /other: {}\n");
  const settings = path.join(dir, "base", "10-settings.yaml");
  fs.writeFileSync(settings, "GET /settings:\n  tier: community\n  ee_features_enabled: false\n  gpu_enabled: false\n");
  const core = { plugin: { fixturesDir: dir }, parseYaml: (f) => YAML.parse(fs.readFileSync(f, "utf8")) };
  return { settings, transform: createWorldSettings(core).transform };
}

test("sparse /settings values overlay the single base object", (t) => {
  const { transform } = setup(t);
  assert.deepEqual(transform["GET /settings"]({ tier: "enterprise", ee_features_enabled: true }), { tier: "enterprise", ee_features_enabled: true, gpu_enabled: false });
});

test("a complete world copy resolves to itself, and a non-success status passes through untouched", (t) => {
  const { transform } = setup(t);
  const full = { tier: "community", ee_features_enabled: false, gpu_enabled: false };
  assert.deepEqual(transform["GET /settings"](full), full);
  const denied = { __status: 401, __body: { detail: "no" } };
  assert.equal(transform["GET /settings"](denied), denied);
});

test("editing the base settings file is picked up without a restart (fixtures hot-reload)", (t) => {
  const { settings, transform } = setup(t);
  assert.equal(transform["GET /settings"]({}).gpu_enabled, false);
  fs.writeFileSync(settings, "GET /settings:\n  tier: community\n  gpu_enabled: true\n");
  fs.utimesSync(settings, new Date(), new Date(Date.now() + 5000));
  assert.equal(transform["GET /settings"]({}).gpu_enabled, true);
});
