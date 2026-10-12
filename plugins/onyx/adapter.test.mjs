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
  const call = async (method, routePath, body = {}, params = {}) => {
    let status, value;
    const route = handlers.routes.find(r => r.method === method && r.path === routePath);
    assert.ok(route, `route ${method} ${routePath}`);
    await route.handle({ body: async () => body, params, query: {}, req: { url: routePath }, res: { destroyed: false }, send(code, data) { status = code; value = data; } });
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
  assert.ok(built.compiled.steps.some(s => s.eval?.includes("location.replace(u.href)")));
  assert.ok(built.compiled.steps.some(s => s.wait_gone));
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
