// Office files in chat (xlsx/docx with an authored ?parsed=true preview), MCP connection_status, and the Index Settings
// Apply & Re-index -> secondary settings -> reindex-progress -> Cancel sequence, all seeded through apps.onyx.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { compile } from "./adapter.mjs";
import createHandlers from "./handlers.mjs";
import { CHAT_FILES_DIR, chatFileHeaders, findChatFile } from "./chat-files.mjs";
import { FixtureTable, layerDirs, parseYaml, substitute } from "../../core/fixtures.mjs";

const pluginDir = path.dirname(new URL(import.meta.url).pathname);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SHEETS = { sheets: [{ name: "Pipeline", csv: "Account,Amount\nNorthwind,120000\nContoso,80000\n", truncated: false }, { name: "Notes", csv: "a\n1\n" }] };
const CURRENT = {
  model_name: "nomic-ai/nomic-embed-text-v1", model_dim: 768, normalize: true, query_prefix: "search_query: ", passage_prefix: "search_document: ",
  provider_type: null, api_key: null, api_url: null, index_name: "acme_chunks_v5", multipass_indexing: false, enable_contextual_rag: false,
  contextual_rag_model_configuration_id: null, multilingual_expansion: [], disable_rerank_for_streaming: false, num_rerank: 0, reduced_dimension: null,
  vector_quantization: "none", rerank_model_name: null, rerank_provider_type: null, rerank_api_key: null, rerank_api_url: null, use_port_flow: true,
};
const PROGRESS_IDLE = { total: 0, waiting: 0, in_progress: 0, completed: 0, failed: 0, paused: 0, reembeds: true };

function build(t, onyx, steps = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-office-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  fs.writeFileSync(path.join(dir, "model.xlsx"), Buffer.from("PK\x03\x04 stand-in workbook bytes", "binary"));
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, upstream: { ref: "v0.0.0-test" }, edition: "community", editions: {} };
  const outputDir = path.join(fixturesDir, ".built", "script");
  const world = {
    company: { name: "Acme", domain: "acme.example" }, people: { sam: { name: "Sam Adeyemi", email: "sam@acme.example" } },
    sources: { wiki: { name: "Wiki", vendor: "confluence" }, chat: { name: "Chat", vendor: "slack" } },
    documents: { rollback: { source: "wiki", title: "Relay rollback", body: "Sam coordinated the rollback.", owners: ["sam"] } },
    apps: { onyx },
  };
  const script = { name: "test", steps, _resolved: { source: path.join(dir, "script.yaml") } };
  const compiled = compile(world, { m, script, outputDir });
  return { m, outputDir, compiled, routes: YAML.parse(fs.readFileSync(path.join(outputDir, "00-world.yaml"), "utf8")) };
}
const askWith = (files) => [{ id: "ask", send: { text: "Make the model", reply: { text: "Done: [model.xlsx](model.xlsx)", code: { source: "print(1)", files } } } }];
const turnOf = (outputDir) => {
  const dir = path.join(outputDir, "chat");
  return parseYaml(path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith("turn-"))));
};

function runtime(built) {
  const { m, compiled } = built;
  const table = new FixtureTable(m.fixturesDir); table.reload(compiled.overlays);
  const core = {
    state: {}, plugin: m, parseYaml, demoNow: () => Date.parse("2026-10-09T12:00:00Z"), log() {}, data: () => ({}),
    layerDirs: (sub) => layerDirs(m.fixturesDir, table.overlays, sub),
    fixture(method, url) { const found = table.find(method, url); return found ? substitute(found.route.val, found.params) : undefined; },
    async streamNdjson() {},
  };
  const handlers = createHandlers(core);
  handlers.reset({ overlays: compiled.overlays, resetChats: true });
  const call = async (method, routePath, body = {}, params = {}, query = {}) => {
    let status, value, headers;
    const matching = handlers.routes.filter((r) => r.method === method && r.path === routePath);
    assert.ok(matching.length, `route ${method} ${routePath}`);
    const res = { destroyed: false, writeHead(code, h) { status = code; headers = h; }, end(bytes) { value = bytes; } };
    // Like the server, a handler that returns false passes the request to the next route registered for the path.
    for (const route of matching) {
      const handled = await route.handle({ body: async () => body, params, query, req: { url: routePath }, res, send(code, data, h) { status = code; value = data; headers = h; } });
      if (handled !== false) break;
    }
    return { status, value, headers };
  };
  const read = async (key, ctx = {}) => handlers.transform[key](core.fixture("GET", key.slice(4)), ctx);
  return { core, handlers, call, read };
}

test("xlsx and docx are known chat file types served as attachments", () => {
  assert.equal(chatFileHeaders("model.xlsx")["content-type"], "application/octet-stream");
  assert.match(chatFileHeaders("model.xlsx")["content-disposition"], /^attachment; filename="model.xlsx"/);
  assert.match(chatFileHeaders("brief.docx")["content-disposition"], /^attachment; filename="brief.docx"/);
});

test("a generated xlsx carries parsed_preview into its stored metadata with truncated normalised to a boolean", (t) => {
  const { outputDir, routes } = build(t, {}, askWith([{ name: "model.xlsx", path: "model.xlsx", parsed_preview: SHEETS }, { name: "brief.docx", path: "model.xlsx" }]));
  assert.ok(routes);
  const turn = turnOf(outputDir);
  const [xlsx, docx] = turn.code.files.map((f) => findChatFile([path.join(outputDir, CHAT_FILES_DIR)], f.id));
  assert.deepEqual(xlsx.parsed_preview.sheets.map((s) => [s.name, s.truncated]), [["Pipeline", false], ["Notes", false]]);
  assert.equal(xlsx.parsed_preview.sheets[0].csv, SHEETS.sheets[0].csv);
  assert.equal(docx.parsed_preview, undefined);
  assert.deepEqual(turn.code.files.map((f) => Object.keys(f).sort()), [["id", "name"], ["id", "name"]]);
});

test("invalid parsed_preview fails with fields", (t) => {
  const bad = (preview, name = "model.xlsx") => () => build(t, {}, askWith([{ name, path: "model.xlsx", parsed_preview: preview }]));
  assert.throws(bad(SHEETS, "brief.docx"), /parsed_preview: parsed_preview applies to \.xlsx files only/);
  assert.throws(bad({ sheets: [] }), /parsed_preview\.sheets: expected a non-empty list/);
  assert.throws(bad({ sheets: [{ name: "A" }] }), /parsed_preview\.sheets\.0: expected \{name, csv/);
  assert.throws(bad({ sheets: [{ name: "A", csv: "a", truncated: "no" }] }), /sheets\.0\.truncated: expected true or false/);
  assert.throws(bad({ sheets: [{ name: "A", csv: "a" }], extra: 1 }), /parsed_preview/);
});

test("GET /chat/file/:id?parsed=true returns the preview JSON, anything else serves the bytes", async (t) => {
  const built = build(t, {}, askWith([{ name: "model.xlsx", path: "model.xlsx", parsed_preview: SHEETS }]));
  const { call } = runtime(built);
  const id = turnOf(built.outputDir).code.files[0].id;
  const parsed = await call("GET", "/chat/file/:id", {}, { id }, { parsed: "true" });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers["content-type"], "application/json");
  assert.deepEqual(parsed.value.sheets.map((s) => s.name), ["Pipeline", "Notes"]);
  const raw = await call("GET", "/chat/file/:id", {}, { id });
  assert.equal(raw.headers["content-type"], "application/octet-stream");
  assert.match(raw.value.toString("binary"), /^PK/);
});

test("MCP servers default to connection_status connected and accept an override", (t) => {
  const { routes } = build(t, { mcp_servers: { crm: { name: "CRM", url: "https://crm.acme.example/mcp" }, wiki: { name: "Wiki", connection_status: "not_connected" } } });
  assert.deepEqual(routes["GET /mcp/servers"].mcp_servers.map((s) => [s.name, s.connection_status]), [["CRM", "connected"], ["Wiki", "not_connected"]]);
  assert.deepEqual(routes["GET /admin/mcp/servers"].mcp_servers.map((s) => s.connection_status), ["connected", "not_connected"]);
  assert.throws(() => build(t, { mcp_servers: { crm: { name: "CRM", connection_status: "bogus" } } }), /connection_status/);
});

test("search settings, embedding providers and code interpreter are authorable through apps.onyx.fixtures", (t) => {
  const { routes } = build(t, { fixtures: {
    "GET /search-settings/get-current-search-settings": CURRENT,
    "GET /search-settings/get-secondary-search-settings": null,
    "GET /admin/embedding/embedding-provider": [{ provider_type: "cohere", api_key: "NOT-A-KEY", api_url: null, api_version: null, deployment_name: null }],
    "GET /admin/code-interpreter": { enabled: true },
    "GET /admin/code-interpreter/health": { connected: true },
  } });
  assert.equal(routes["GET /search-settings/get-current-search-settings"].model_name, CURRENT.model_name);
  assert.equal(routes["GET /search-settings/get-secondary-search-settings"], null);
  assert.equal(routes["GET /admin/embedding/embedding-provider"][0].provider_type, "cohere");
  assert.deepEqual(routes["GET /admin/code-interpreter"], { enabled: true });
  assert.deepEqual(routes["GET /admin/code-interpreter/health"], { connected: true });
});

test("Apply & Re-index stages secondary settings with a progress read-out until Cancel", async (t) => {
  const built = build(t, {
    cc_pairs: { wiki: { status: "ACTIVE" }, chat: { status: "ACTIVE" } },
    fixtures: {
      "GET /search-settings/get-current-search-settings": CURRENT,
      "GET /search-settings/get-secondary-search-settings": null,
      "GET /search-settings/reindex-progress": PROGRESS_IDLE,
    },
  });
  const { call, read } = runtime(built);
  const current = () => read("GET /search-settings/get-current-search-settings");
  const secondary = () => read("GET /search-settings/get-secondary-search-settings");
  const progress = () => read("GET /search-settings/reindex-progress");
  assert.equal(await secondary(), null);
  assert.deepEqual(await progress(), PROGRESS_IDLE);

  const request = { ...CURRENT, model_name: "intfloat/multilingual-e5-base", model_dim: 768, index_name: null, enable_contextual_rag: true,
    api_key: null, switchover_type: "reindex", acknowledged_wont_port_cc_pair_ids: [] };
  const applied = await call("POST", "/search-settings/set-new-search-settings", request);
  assert.equal(applied.status, 200);
  assert.equal((await current()).model_name, CURRENT.model_name);
  const next = await secondary();
  assert.equal(next.model_name, "intfloat/multilingual-e5-base");
  assert.equal(next.enable_contextual_rag, true);
  assert.equal(next.use_port_flow, true);
  assert.equal(next.index_name, "danswer_chunk_intfloat_multilingual_e5_base");
  assert.equal("acknowledged_wont_port_cc_pair_ids" in next, false);
  const pairs = (await read("GET /manage/admin/connector/status")).length;
  assert.ok(pairs > 0);
  assert.deepEqual(await progress(), { total: pairs, waiting: pairs, in_progress: 0, completed: 0, failed: 0, paused: 0, reembeds: true });

  assert.equal((await call("POST", "/search-settings/cancel-new-embedding")).status, 200);
  assert.equal(await secondary(), null);
  assert.deepEqual(await progress(), PROGRESS_IDLE);
  assert.equal((await current()).model_name, CURRENT.model_name);
});

test("an INSTANT switchover swaps current at once and keeps reporting the backfill without a secondary", async (t) => {
  const built = build(t, { cc_pairs: { wiki: { status: "ACTIVE" } }, fixtures: {
    "GET /search-settings/get-current-search-settings": CURRENT, "GET /search-settings/get-secondary-search-settings": null,
    "GET /search-settings/reindex-progress": PROGRESS_IDLE } });
  const { call, read } = runtime(built);
  await call("POST", "/search-settings/set-new-search-settings", { ...CURRENT, model_name: "intfloat/multilingual-e5-base", switchover_type: "instant" });
  assert.equal((await read("GET /search-settings/get-current-search-settings")).model_name, "intfloat/multilingual-e5-base");
  assert.equal(await read("GET /search-settings/get-secondary-search-settings"), null);
  const pairs = (await read("GET /manage/admin/connector/status")).length;
  assert.ok(pairs > 0);
  assert.equal((await read("GET /search-settings/reindex-progress")).total, pairs);
});
