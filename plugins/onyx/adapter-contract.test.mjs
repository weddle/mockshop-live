import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { compile } from "./adapter.mjs";

const pluginDir = path.dirname(new URL(import.meta.url).pathname);
const content = (onyx) => ({ company: { name: "Acme", domain: "acme.example" }, people: { sam: { name: "Sam Adeyemi" } }, apps: { onyx } });
function compileWith(t, onyx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, edition: "community" };
  return compile(content(onyx), { m, script: { name: "t", steps: [], _resolved: { source: path.join(dir, "script.yaml") } }, outputDir: path.join(fixturesDir, ".built", "t") });
}

// Every section the schema declares for an area before its derivation exists must fail loudly rather than be dropped.
for (const [section, value] of Object.entries({
  connectors: { runbooks: { name: "Runbooks" } },
  plugins: { search: { name: "Search", kind: "mcp" } },
  craft: { tasks: {} },
  billing: { case: "trialing" },
  tier: "business",
})) {
  test(`apps.onyx.${section} is accepted by the schema but rejected until the adapter derives it`, (t) => {
    assert.throws(() => compileWith(t, { [section]: value }), new RegExp(`apps\\.onyx\\.${section}: this world section is declared in world.schema.json but the adapter does not derive it yet`));
  });
}

test("declared sections are still schema-checked before the underived guard", (t) => {
  assert.throws(() => compileWith(t, { tier: "gold" }), /apps\.onyx\.tier/);
  assert.throws(() => compileWith(t, { cc_pairs: { runbooks: { access_type: "secret" } } }), /apps\.onyx\.cc_pairs/);
  assert.throws(() => compileWith(t, { llm_providers: { main: {} } }), /apps\.onyx\.llm_providers/);
});

const SOURCES = { wiki: { name: "Wiki", vendor: "confluence" }, chat: { name: "Chat", vendor: "slack" } };
function compileWorld(t, world, steps = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, edition: "community" };
  const outputDir = path.join(fixturesDir, ".built", "t");
  const compiled = compile(world, { m, script: { name: "t", steps, _resolved: { source: path.join(dir, "script.yaml") } }, outputDir });
  const routes = (overlay) => YAML.parse(fs.readFileSync(path.join(fixturesDir, overlay, "00-world.yaml"), "utf8"));
  return { compiled, routes };
}

test("apps.onyx.cc_pairs and index_runs derive the status row, queue position, runs and stage metrics with the backend's rules", (t) => {
  const runs = (wikiStages) => ({
    wiki: [{ status: "in_progress", started: "40m", new_docs: 400, batches: 10, stages: wikiStages }],
    chat: [{ status: "not_started", created: "5m" }, { status: "success", started: "3h", finished: "2h50m", new_docs: 10, total_docs: 30 }],
  });
  const world = (wikiStages) => ({ ...content({ cc_pairs: { wiki: { status: "INITIAL_INDEXING", created: "50m" } }, index_runs: runs(wikiStages) }), sources: SOURCES });
  const { compiled, routes } = compileWorld(t, world({ CONNECTOR_FETCH: 5, CHUNKING: 2, EMBEDDING: 10 }));
  const built = routes(compiled.overlays[0]);
  const rows = built["GET /manage/admin/index-monitoring/connectors"].items;
  const wiki = rows.find((row) => row.source === "confluence"), chat = rows.find((row) => row.source === "slack");
  assert.deepEqual([wiki.status, wiki.cc_pair_status, wiki.docs_indexed, wiki.latest_index_attempt.status], ["indexing", "INITIAL_INDEXING", 400, "in_progress"]);
  assert.deepEqual([chat.status, chat.queue_position, chat.last_success], ["scheduled", 1, "{{ago:10200s}}"]);
  assert.deepEqual(built["GET /manage/admin/index-monitoring/connectors"].status_counts, { indexing: 1, failed: 0, paused: 0, scheduled: 1, indexed: 0 });
  assert.deepEqual(built[`GET /manage/admin/cc-pair/${chat.cc_pair_id}/runs`].status_counts, { running: 1, succeeded: 1, failed: 0, canceled: 0 });
  const stages = built[`GET /manage/admin/index-attempt/${wiki.latest_index_attempt.id}/stage-metrics`].stages;
  assert.deepEqual(stages.map((row) => row.stage), ["CONNECTOR_FETCH", "CHUNKING", "EMBEDDING", "BATCH_TOTAL", "BATCH_UNACCOUNTED"]);
  assert.equal(stages.find((row) => row.stage === "BATCH_TOTAL").total_duration_ms, 120000);
  // 10 batches of 300s cannot fit in a run that started 40 minutes ago.
  assert.throws(() => compileWorld(t, world({ EMBEDDING: 300 })), /docprocessing stages add up to 3000s/);
});

test("state.viewer compiles the same world signed in as another person", (t) => {
  const world = { ...content({ viewer: "sam" }), people: { sam: { name: "Sam Adeyemi" }, lee: { name: "Lee Park" } } };
  const { compiled, routes } = compileWorld(t, world, [{ id: "as-lee", state: { viewer: "lee" } }, { id: "back", state: { viewer: "sam" } }]);
  const [toLee, toSam] = compiled.steps;
  assert.match(toLee.state.overlays[0], /\/world-[0-9a-f]{16}$/);
  assert.equal(routes(toLee.state.overlays[0])["GET /me"].email, "lee@acme.example");
  assert.deepEqual(toSam.state.overlays, compiled.overlays);
  assert.throws(() => compileWorld(t, world, [{ id: "x", state: { viewer: "nobody" } }]), /state\.viewer: unknown person nobody/);
});

test("a sparse Enterprise /settings overlay and sparse apps.onyx.settings are completed from the single base object; the version stays a plugin.ref token", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  fs.cpSync(path.join(pluginDir, "fixtures/edition-enterprise"), path.join(fixturesDir, "edition-enterprise"), { recursive: true });
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, edition: "enterprise", editions: { enterprise: { fixtures: "edition-enterprise" } } };
  const outputDir = path.join(fixturesDir, ".built", "t");
  compile(content({ settings: { hooks_enabled: true } }), { m, script: { name: "t", steps: [], _resolved: { source: path.join(dir, "script.yaml") } }, outputDir });
  const base = YAML.parse(fs.readFileSync(path.join(fixturesDir, "base", "10-settings.yaml"), "utf8"))["GET /settings"];
  const settings = YAML.parse(fs.readFileSync(path.join(outputDir, "00-world.yaml"), "utf8"))["GET /settings"];
  assert.equal(settings.tier, "enterprise");
  assert.equal(settings.ee_features_enabled, true);
  assert.equal(settings.hooks_enabled, true);
  assert.equal(settings.company_name, "Acme");
  for (const key of Object.keys(base)) assert.ok(key in settings, `base key ${key} survives the sparse overlay`);
  assert.equal(settings.version, "{{plugin.ref}}", "no literal version label; core/fixtures.mjs resolves the token from plugin.yaml upstream.ref");
});
