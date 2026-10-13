import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { compile } from "./adapter.mjs";
import createHandlers from "./handlers.mjs";
import { pickScript } from "./chat.mjs";
import { loadContent } from "../../core/content.mjs";
import { FixtureTable, layerDirs, parseYaml, substitute } from "../../core/fixtures.mjs";

const pluginDir = path.dirname(new URL(import.meta.url).pathname);
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-world-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  fs.cpSync(path.join(pluginDir, "fixtures/edition-enterprise"), path.join(fixturesDir, "edition-enterprise"), { recursive: true });
  return { dir, m: { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, edition: "community", editions: { enterprise: { fixtures: "edition-enterprise" } } } };
}
const minimal = () => ({
  company: { name: "Omzo", domain: "omzo.example" },
  people: { sam: { name: "Sam Adeyemi", email: "sam@omzo.example" } },
  sources: { runbooks: { name: "Engineering Runbooks", vendor: "confluence" } },
  documents: { rollback: { source: "runbooks", title: "Relay rollback", body: "Sam coordinated the rollback.", owners: ["sam"] } },
});
function build(t, content = minimal(), steps = []) {
  const { dir, m } = setup(t);
  const outputDir = path.join(m.fixturesDir, ".built", "script");
  const script = { name: "test", steps, _resolved: { source: path.join(dir, "script.yaml") } };
  const compiled = compile(content, { m, script, outputDir });
  const routes = YAML.parse(fs.readFileSync(path.join(outputDir, "00-world.yaml"), "utf8"));
  return { dir, m, outputDir, script, compiled, routes };
}
const send = (id, text) => ({ id, scene: "investigate", author_id: id, origin: { file: "story.yaml", line: 10, field: `steps.${id}` }, send: { text: "Who handled the rollback?", reply: { text, queries: [id], cites: ["rollback"] } } });

test("minimal shared content generates neutral complete Onyx DTOs", (t) => {
  const { routes, outputDir } = build(t);
  assert.equal(routes["GET /me"].personalization.name, "Sam Adeyemi");
  assert.equal(routes["GET /settings"].company_name, "Omzo");
  assert.deepEqual(routes["GET /chat/get-user-chat-sessions"].sessions, []);
  assert.equal(routes["GET /persona"].length, 1);
  assert.equal(routes["GET /persona"][0].name, "Assistant");
  assert.equal(routes["POST /manage/admin/connector/indexing-status"][0].source, "confluence");
  assert.equal(routes["GET /mockshop/user-search-seed"].documents.length, 1);
  assert.doesNotMatch(JSON.stringify(routes), /Seaside|Maya Chen|Learning Notes|Riverbend|Lakeshore/);
  assert.equal(fs.readdirSync(path.join(outputDir, "sources")).length, 1);
});

test("source vendor edits project connectors, citations, URLs and stable IDs together", (t) => {
  const first = build(t, minimal(), [send("answer", "Sam handled it. [1]")]);
  const changed = minimal(); changed.sources.runbooks.vendor = "notion"; changed.people.sam.name = "Sam Okafor";
  const next = build(t, changed, [send("answer", "Sam handled it. [1]")]);
  const before = first.routes["POST /manage/admin/connector/indexing-status"][0].indexing_statuses[0];
  const after = next.routes["POST /manage/admin/connector/indexing-status"][0].indexing_statuses[0];
  assert.equal(before.cc_pair_id, after.cc_pair_id);
  assert.equal(after.name, "Notion – Engineering Runbooks");
  const scripts = fs.readdirSync(path.join(next.outputDir, "chat")).map(f => parseYaml(path.join(next.outputDir, "chat", f)));
  assert.equal(scripts[0].documents[0].source, "notion");
  assert.match(scripts[0].documents[0].link, /notion\.omzo\.example/);
  assert.equal(first.routes["GET /me"].id, next.routes["GET /me"].id);
});

test("unsupported requested vendors and incompatible explicit URLs fail with fields", (t) => {
  const content = minimal(); content.sources.runbooks.vendor = "unmapped_vendor";
  assert.throws(() => build(t, content, [send("answer", "Sam handled it. [1]")]), /steps.answer.send.reply.cites.*unsupported/);
  const changed = minimal(); changed.sources.runbooks.vendor = "notion"; changed.documents.rollback.url = "https://omzo.example/wiki/spaces/RUN/pages/1";
  assert.throws(() => build(t, changed), /documents.rollback.url.*confluence.*notion/);
  const unrelated = { apps: { another: { whatever: true } }, sources: { unused: { name: "Other app data", vendor: "unmapped_vendor" } } };
  assert.doesNotThrow(() => build(t, unrelated));
  const locator = minimal(); locator.sources.runbooks.vendor = "notion";
  locator.apps = { onyx: { sources: { runbooks: { id: 42 } } } };
  assert.throws(() => build(t, locator, [{ id: "source", goto: "/admin/connector/confluence/42" }]), /explicit connector locator.*now uses notion/);
  assert.throws(() => build(t, locator, [{ id: "source", click: { text: "Confluence – Engineering Runbooks" } }]), /explicit Confluence label.*conflicts with notion/);
});

test("identical questions are distinct one-shot turns, never manual regex fallbacks", (t) => {
  const { outputDir, compiled } = build(t, minimal(), [send("first", "First answer. [1]"), send("second", "Second answer. [1]")]);
  const files = fs.readdirSync(path.join(outputDir, "chat"));
  const scripts = files.map(f => parseYaml(path.join(outputDir, "chat", f)));
  assert.deepEqual(new Set(scripts.map(s => s.turn)), new Set(["first", "second"]));
  assert.deepEqual(new Set(scripts.map(s => s.answer)), new Set(["First answer. [1]", "Second answer. [1]"]));
  assert.deepEqual(compiled.steps.filter(s => s.state).map(s => s.state), [
    { keep: true, resetChats: false, turn: "first" }, { keep: true, resetChats: false, turn: "second" },
  ]);
  assert.ok(compiled.steps.every(s => s.scene === "investigate" && s.origin.file === "story.yaml"));
  assert.match(pickScript([path.join(outputDir, "chat")], "Who handled the rollback?", parseYaml).answer, /No prepared answer/);
});

function runtime(built) {
  const { m, compiled } = built;
  const table = new FixtureTable(m.fixturesDir); table.reload(compiled.overlays);
  const state = {}, packets = [];
  const core = {
    state, plugin: m, parseYaml, demoNow: () => Date.parse("2026-10-09T12:00:00Z"), log() {},
    layerDirs: sub => layerDirs(m.fixturesDir, table.overlays, sub),
    fixture(method, url) { const found = table.find(method, url); return found ? substitute(found.route.val, found.params) : undefined; },
    async streamNdjson(_res, stream) { for await (const value of stream) packets.push(value.packet); },
  };
  const handlers = createHandlers(core);
  handlers.reset({ overlays: compiled.overlays, resetChats: true });
  const call = async (method, routePath, body = {}, params = {}, query = {}) => {
    let status, value;
    const route = handlers.routes.find(r => r.method === method && r.path === routePath);
    assert.ok(route, `route ${method} ${routePath}`);
    await route.handle({ body: async () => body, params, query, req: { url: routePath }, res: { destroyed: false }, send(code, data) { status = code; value = data; } });
    return { status, value };
  };
  return { core, state, handlers, call, packets };
}

test("armed replies preserve conversations, consume once, and clear on run reset", async (t) => {
  const built = build(t, minimal(), [send("first", "First exact answer. [1]"), send("second", "Second exact answer. [1]")]);
  const { state, handlers, call } = runtime(built);
  handlers.reset({ keep: true, resetChats: false, turn: "first", url: "http://localhost/app" });
  await call("POST", "/chat/send-chat-message", { message: "Who handled the rollback?", chat_session_info: { persona_id: 0 } });
  const session = Object.values(state.chatSessions)[0];
  assert.equal(session.nodes.at(-1).script.answer, "First exact answer. [1]");
  assert.equal(state.armedTurn, null);
  handlers.reset({ keep: true, resetChats: false, turn: "second", url: `http://localhost/app?chatId=${session.id}` });
  const wrong = await call("POST", "/chat/send-chat-message", { message: "Who handled the rollback?", chat_session_id: "another" });
  assert.equal(wrong.status, 409);
  assert.equal(state.armedTurn.id, "second");
  await call("POST", "/chat/send-chat-message", { message: "Who handled the rollback?", chat_session_id: session.id, parent_message_id: session.nodes.at(-1).id });
  assert.equal(session.nodes.at(-1).script.answer, "Second exact answer. [1]");
  assert.equal(session.nodes.length, 4);
  assert.deepEqual((await call("GET", "/mockshop/turn/:id", {}, { id: "second" })).value,
    { status: "complete", session: session.id });
  assert.throws(() => handlers.reset({ keep: true, turn: "missing" }), /missing/);
  handlers.reset({ keep: true, turn: "first" });
  handlers.reset({ overlays: built.compiled.overlays, resetChats: true });
  assert.equal(state.armedTurn, null);
  assert.deepEqual(state.chatSessions, {});
});

test("native exact arms preserve model variants and saved branch context without retyping", async (t) => {
  const content = minimal();
  content.apps = { onyx: { replies: {
    first: { turn: "native-first", question: "Initial question", text: "Common answer", title: "First title",
      chunk_delay_ms: 0, model_variants: { "gpt-5.2": { answer: "Selected model answer" } } },
    follow: { turn: "native-follow", question: "Follow up", text: '{{first.message}} / {{prev.title}}',
      title: "{{first.title}}", chunk_delay_ms: 0 },
  } } };
  const native = [
    { id: "arm", state: { turn: "native-first", keep: true, resetChats: false } },
    { id: "submit", click: { selector: "#onyx-chat-input-send-button" } },
  ];
  const built = build(t, content, native);
  const { handlers, state, call } = runtime(built);
  handlers.reset({ keep: true, resetChats: false, turn: "native-first", url: "http://localhost/app" });
  await call("POST", "/chat/send-chat-message", { message: "Initial question", chat_session_info: { persona_id: 0 },
    llm_override: { model_provider: "OpenAI", model_version: "gpt-5.2" } });
  const session = Object.values(state.chatSessions)[0];
  assert.equal(session.nodes.at(-1).script.answer, "Selected model answer");
  handlers.reset({ keep: true, resetChats: false, turn: "native-follow", url: `http://localhost/app?chatId=${session.id}` });
  await call("POST", "/chat/send-chat-message", { message: "Follow up", chat_session_id: session.id,
    parent_message_id: session.nodes.at(-1).id });
  assert.equal(session.nodes.at(-1).script.answer, "Initial question / First title");
  assert.equal(session.nodes.at(-1).script.title, "First title");
  assert.equal(state.armedTurn, null);
});

test("persistent screen selection is ordered and does not clear live conversations", async (t) => {
  const content = minimal();
  content.sources.archive = { name: "Archive", vendor: "notion" };
  content.conversations = { earlier: { title: "Earlier", messages: [{ role: "user", text: "Question" }, { role: "assistant", text: "Answer" }] }, latest: { title: "Latest", messages: [{ role: "user", text: "Question" }, { role: "assistant", text: "Answer" }] } };
  content.apps = { onyx: { sources: { archive: { visible: false } }, fixtures: { "GET /chat/get-user-chat-sessions": { has_more: false, sessions: [] } } } };
  const built = build(t, content, [{ id: "screen", state: { sidebar: ["latest", "earlier"], connectors: ["archive"], model: "gpt-5.2", agent: null } }]);
  const control = built.compiled.steps.find(s => s.state).state;
  const { handlers, state, core, call } = runtime(built);
  state.chatSessions[`${state.org}:live`] = { id: "live", org: state.org, nodes: [], description: "Live", created: "2026-10-09T12:00:00Z" };
  assert.deepEqual((await call("POST", "/manage/admin/connector/indexing-status")).value.map(g => g.source), ["confluence"]);
  handlers.reset({ ...control, url: "http://localhost/app?chatId=live" });
  assert.equal(Object.keys(state.chatSessions).length, 1);
  const rows = await handlers.transform["GET /chat/get-user-chat-sessions"](core.fixture("GET", "/chat/get-user-chat-sessions"));
  assert.deepEqual(rows.sessions.map(s => s.name), ["Latest", "Earlier"]);
  const connectors = await call("POST", "/manage/admin/connector/indexing-status");
  assert.deepEqual(connectors.value.map(g => g.source), ["notion"]);
  assert.match(Object.values(state.chatSessions)[0].model, /gpt-5\.2/);
});

test("viewer and teams project stable person identities into native user and group seeds", (t) => {
  const content = minimal();
  content.people.jules = { name: "Jules Kim", email: "jules@omzo.example" };
  content.teams = { reliability: { name: "Reliability", members: ["jules", "sam"] } };
  content.apps = { onyx: { viewer: "jules", teams: { reliability: { managers: ["sam"] } } } };
  const { routes } = build(t, content);
  const people = routes["GET /manage/users/accepted/all"], team = routes["GET /manage/admin/user-group"][0];
  assert.equal(routes["GET /me"].personalization.name, "Jules Kim");
  assert.deepEqual(team.users.map(u => u.email), ["jules@omzo.example", "sam@omzo.example"]);
  assert.deepEqual(team.manager_ids, [people.find(u => u.email === "sam@omzo.example").id]);
  assert.equal(routes["GET /mockshop/admin-groups/seeds"].groups[0].name, "Reliability");
});

test("the built edition is authoritative and carries no foreign identity defaults", (t) => {
  const { dir, m } = setup(t);
  m.runtimeDir = path.join(dir, "runtime"); fs.mkdirSync(m.runtimeDir);
  fs.writeFileSync(path.join(m.runtimeDir, ".mockshop-runtime.json"), JSON.stringify({ edition: "enterprise" }));
  const outputDir = path.join(m.fixturesDir, ".built", "edition");
  compile(minimal(), { m, script: { steps: [] }, outputDir });
  const routes = parseYaml(path.join(outputDir, "00-world.yaml"));
  assert.equal(routes["GET /settings"].ee_features_enabled, true);
  assert.equal(routes["GET /settings"].company_name, "Omzo");
  assert.doesNotMatch(JSON.stringify(routes), /Seaside|Maya Chen|Boutique coastal/);
});

test("returning to the primary whole world reuses its conversation namespace", (t) => {
  const { dir, m } = setup(t), content = minimal();
  const primary = path.join(dir, "primary.yaml"), other = path.join(dir, "other.yaml");
  fs.writeFileSync(primary, YAML.stringify(content));
  fs.writeFileSync(other, YAML.stringify({ ...content, company: { name: "Other", domain: "other.example" } }));
  const outputDir = path.join(m.fixturesDir, ".built", "world-switch");
  const compiled = compile(content, { m, outputDir, script: {
    _resolved: { source: path.join(dir, "script.yaml") },
    steps: [send("before", "Primary answer. [1]"), { id: "other", state: { world: "other.yaml" } },
      { id: "back", state: { world: "primary.yaml" } }, send("after", "Returned answer. [1]")],
  } });
  const switches = compiled.steps.filter(s => s.state?.overlays);
  assert.notDeepEqual(switches[0].state.overlays, compiled.overlays);
  assert.deepEqual(switches[1].state.overlays, compiled.overlays);
  const turns = fs.readdirSync(path.join(outputDir, "chat")).map(f => parseYaml(path.join(outputDir, "chat", f)));
  assert.deepEqual(new Set(turns.map(s => s.turn)), new Set(["before", "after"]));
});

function connectorContent() {
  const content = minimal();
  content.sources.issues = { name: "Service desk", vendor: "jira" };
  content.apps = { onyx: { sources: {
    runbooks: {
      id: 2048, connector_id: 5001, credential_id: 6001,
      detail: { supports_targeted_reindex: true, num_docs_indexed: 17, last_index_attempt_status: "failed" },
      attempts: { total_items: 1, items: [{ id: 81, status: "failed", docs_indexed: 17 }] },
      errors: { total_items: 3, items: [
        { id: 701, connector_credential_pair_id: 2048, is_resolved: false },
        { id: 702, connector_credential_pair_id: 2048, is_resolved: false },
        { id: 703, connector_credential_pair_id: 2048, is_resolved: true },
      ] },
    },
    issues: {
      id: 4096, connector_id: 5002, credential_id: 6002,
      detail: { supports_targeted_reindex: false, num_docs_indexed: 8, last_index_attempt_status: "success" },
      errors: { total_items: 1, items: [{ id: 704, connector_credential_pair_id: 4096, is_resolved: false }] },
    },
  } } };
  return content;
}

test("seeded identities above 1000 project status once and allocate new connector identities above every seed", async (t) => {
  const { core, handlers, call } = runtime(build(t, connectorContent()));
  assert.equal((await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "PAUSED" }, { id: "2048" })).status, 200);
  const seedRows = core.fixture("GET", "/manage/connector-status").slice().reverse();
  const before = await handlers.transform["GET /manage/connector-status"](seedRows);
  assert.equal(before.length, 2);
  assert.equal(before.find(row => row.cc_pair_id === 2048).status, "PAUSED");
  assert.equal(before.find(row => row.cc_pair_id === 4096).status, "ACTIVE");
  const connector = await call("POST", "/manage/admin/connector", { name: "New local connector", source: "confluence", connector_specific_config: {} });
  const credential = await call("POST", "/manage/credential", { source: "confluence", credential_json: {} });
  assert.equal(connector.value.id, 5003);
  assert.equal(credential.value.id, 6003);
  const bound = await call("PUT", "/manage/connector/:connector/credential/:credential", {}, { connector: "5003", credential: "6003" });
  assert.equal(bound.value.cc_pair_id, 4097);
  assert.equal((await call("POST", "/manage/admin/connector/run-once", { connector_id: 5003, credentialIds: [6003], from_beginning: true })).status, 200);
  const pair = (await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "4097" })).value;
  assert.equal(pair.last_index_attempt_status, "in_progress");
  assert.equal(pair.latest_checkpoint_description, "Local fake upload staged; no indexing process runs.");
  const after = await handlers.transform["GET /manage/connector-status"](seedRows);
  assert.deepEqual(after.map(row => row.cc_pair_id), [4096, 2048, 4097]);
  assert.equal(after.at(-1).has_successful_run, false);
});

test("seeded update and complete reindex validate native payloads and stage without changing protected snapshots", async (t) => {
  const built = build(t, connectorContent()), { core, handlers, call } = runtime(built);
  const readPair = async id => structuredClone((await call("GET", "/manage/admin/cc-pair/:id", {}, { id: String(id) })).value);
  const before = await readPair(2048), unrelated = await readPair(4096);
  const errors = structuredClone((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value);
  const attempts = structuredClone(core.fixture("GET", "/manage/admin/cc-pair/2048/index-attempts"));
  const request = { connector_id: 5001, credentialIds: [6001], from_beginning: false };
  for (const payload of [{}, { ...request, credentialIds: [] }, { ...request, from_beginning: undefined }])
    assert.equal((await call("POST", "/manage/admin/connector/run-once", payload)).status, 400);
  assert.equal((await call("POST", "/manage/admin/connector/run-once", { ...request, credentialIds: [9999] })).status, 404);
  await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "PAUSED" }, { id: "2048" });
  assert.equal((await call("POST", "/manage/admin/connector/run-once", request)).status, 409);
  await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "ACTIVE" }, { id: "2048" });
  assert.equal((await call("POST", "/manage/admin/connector/run-once", request)).status, 200);
  const update = await readPair(2048);
  assert.equal(update.indexing, true);
  assert.equal(update.last_index_attempt_status, "not_started");
  assert.equal(update.latest_checkpoint_description, "Local fake indexing update request staged; no indexing process runs.");
  const protectedFields = value => Object.fromEntries(Object.entries(value).filter(([key]) => !["indexing", "last_index_attempt_status", "latest_checkpoint_description"].includes(key)));
  assert.deepEqual(protectedFields(update), protectedFields(before));
  assert.deepEqual(await readPair(4096), unrelated);
  assert.deepEqual((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value, errors);
  assert.deepEqual(core.fixture("GET", "/manage/admin/cc-pair/2048/index-attempts"), attempts);
  assert.equal((await call("POST", "/manage/admin/connector/run-once", { ...request, from_beginning: true })).status, 409);
  handlers.reset({ keep: true, resetChats: false });
  assert.deepEqual(await readPair(2048), update);
  handlers.reset({ overlays: built.compiled.overlays, keep: false, resetChats: true });
  assert.deepEqual(await readPair(2048), before);
  assert.equal((await call("POST", "/manage/admin/connector/run-once", { ...request, from_beginning: true })).status, 200);
  const complete = await readPair(2048);
  assert.equal(complete.last_index_attempt_status, "not_started");
  assert.equal(complete.latest_checkpoint_description, "Local fake complete re-index request staged; no indexing process runs.");
  assert.deepEqual(protectedFields(complete), protectedFields(before));
});

test("indexed errors page and targeted requests remain unresolved, org-scoped and resettable", async (t) => {
  const built = build(t, connectorContent()), { core, state, handlers, call } = runtime(built);
  const before = structuredClone((await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "2048" })).value);
  const errors = structuredClone((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value);
  const page = await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" }, { include_resolved: "false", page_num: "1", page_size: "1" });
  assert.deepEqual(page.value, { total_items: 2, items: [errors.items[1]] });
  assert.equal((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "9999" })).status, 404);
  for (const error_ids of [[], Array(101).fill(701)])
    assert.equal((await call("POST", "/manage/admin/indexing/targeted-reindex", { error_ids })).status, 400);
  assert.equal((await call("POST", "/manage/admin/indexing/targeted-reindex", { error_ids: [701, 9999] })).status, 404);
  assert.equal((await call("POST", "/manage/admin/indexing/targeted-reindex", { error_ids: [704] })).status, 400);
  const queued = await call("POST", "/manage/admin/indexing/targeted-reindex", { error_ids: [701, 701, 703] });
  assert.deepEqual(queued.value, { targeted_reindex_job_id: 1, queued_count: 1, skipped_count: 1 });
  const job = structuredClone((await call("GET", "/manage/admin/indexing/targeted-reindex/:id", {}, { id: "1" })).value);
  assert.deepEqual({ ...job, requested_at: null }, { id: 1, status: "not_started", requested_at: null, completed_at: null,
    target_count: 1, resolved_count: 0, still_failing_count: 1, skipped_count: 1, resolved_summary: [] });
  assert.deepEqual((await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "2048" })).value, before);
  assert.deepEqual((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value, errors);
  const primary = state.org;
  handlers.reset({ keep: true, resetChats: false });
  assert.deepEqual((await call("GET", "/manage/admin/indexing/targeted-reindex/:id", {}, { id: "1" })).value, job);
  handlers.reset({ overlays: ["other-world"], keep: true, resetChats: false });
  assert.equal((await call("GET", "/manage/admin/indexing/targeted-reindex/:id", {}, { id: "1" })).status, 404);
  handlers.reset({ overlays: primary.split(","), keep: true, resetChats: false });
  assert.deepEqual((await call("GET", "/manage/admin/indexing/targeted-reindex/:id", {}, { id: "1" })).value, job);
  handlers.reset({ overlays: built.compiled.overlays, keep: false, resetChats: true });
  assert.equal((await call("GET", "/manage/admin/indexing/targeted-reindex/:id", {}, { id: "1" })).status, 404);
  assert.deepEqual(core.fixture("GET", "/manage/admin/cc-pair/2048/errors"), errors);
  assert.equal((await call("POST", "/manage/admin/indexing/targeted-reindex", { error_ids: [702] })).value.targeted_reindex_job_id, 1);
});

test("connector deletion requires paused or invalid state and cannot be resumed after scheduling", async (t) => {
  const { core, handlers, call } = runtime(build(t, connectorContent()));
  const request = { connector_id: 5001, credential_id: 6001 };
  const original = structuredClone((await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "2048" })).value);
  const errors = structuredClone((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value);
  assert.equal((await call("POST", "/manage/admin/deletion-attempt", request)).status, 400);
  assert.equal((await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "INVALID" }, { id: "2048" })).status, 400);
  await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "PAUSED" }, { id: "2048" });
  assert.equal((await call("POST", "/manage/admin/deletion-attempt", request)).status, 200);
  const deleted = (await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "2048" })).value;
  assert.equal(deleted.status, "DELETING");
  assert.deepEqual(deleted.latest_deletion_attempt, { ...request, status: "PENDING" });
  assert.equal(deleted.num_docs_indexed, original.num_docs_indexed);
  assert.equal((await call("PUT", "/manage/admin/cc-pair/:id/status", { status: "ACTIVE" }, { id: "2048" })).status, 400);
  assert.equal((await call("POST", "/manage/admin/deletion-attempt", request)).status, 400);
  assert.deepEqual((await call("GET", "/manage/admin/cc-pair/:id/errors", {}, { id: "2048" })).value, errors);
  const statusRows = await handlers.transform["GET /manage/connector-status"](core.fixture("GET", "/manage/connector-status"));
  assert.equal(statusRows.find(row => row.cc_pair_id === 2048).status, "DELETING");
});

test("an invalid seeded connector cannot index but can schedule deletion without deleting documents", async (t) => {
  const content = connectorContent();
  content.apps.onyx.sources.issues.detail.status = "INVALID";
  const { call } = runtime(build(t, content));
  assert.equal((await call("POST", "/manage/admin/connector/run-once", { connector_id: 5002, credentialIds: [6002], from_beginning: true })).status, 409);
  assert.equal((await call("POST", "/manage/admin/deletion-attempt", { connector_id: 5002, credential_id: 6002 })).status, 200);
  const pair = (await call("GET", "/manage/admin/cc-pair/:id", {}, { id: "4096" })).value;
  assert.equal(pair.status, "DELETING");
  assert.equal(pair.latest_deletion_attempt.status, "PENDING");
  assert.equal(pair.num_docs_indexed, 8);
});
