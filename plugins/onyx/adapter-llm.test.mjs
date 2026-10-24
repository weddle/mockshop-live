import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { compile } from "./adapter.mjs";
import createHandlers from "./handlers.mjs";
import { FixtureTable, layerDirs, parseYaml, substitute } from "../../core/fixtures.mjs";

const pluginDir = path.dirname(new URL(import.meta.url).pathname);
const ROUTES = ["GET /llm/provider", "GET /admin/llm/provider", "GET /llm/persona/:id/providers"];

function build(t, onyx, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-llm-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, upstream: { ref: "v0.0.0-test" }, edition: "community" };
  const content = { company: { name: "Acme", domain: "acme.example" }, people: { sam: { name: "Sam Adeyemi", email: "sam@acme.example" } },
    teams: { training: { name: "Training", members: ["sam"] } }, ...extra, apps: { onyx } };
  const outputDir = path.join(fixturesDir, ".built", "script");
  compile(content, { m, script: { name: "t", steps: [], _resolved: { source: path.join(dir, "script.yaml") } }, outputDir });
  return YAML.parse(fs.readFileSync(path.join(outputDir, "00-world.yaml"), "utf8"));
}
const baseline = () => YAML.parse(fs.readFileSync(path.join(pluginDir, "fixtures/base/50-llm.yaml"), "utf8"));
const world = (extra = {}) => ({
  llm_providers: {
    "openai-main": { id: 7, provider: "openai", default: true, api_key_set: true, models: {
      "gpt-5": { display_name: "GPT-5", default: true, max_input_tokens: 400000, supports_image_input: true, reasoning_efforts: ["low", "high"] },
      "gpt-5-mini": { display_name: "GPT-5 mini", default: ["chat_naming"], visible: false },
    } },
    local: { provider: "ollama_chat", api_base: "http://gpu.example:11434", models: { "llama3.3:70b": { max_input_tokens: 128000 } } },
  },
  ...extra,
});

test("a small world derives GET /llm/provider, /admin/llm/provider and /llm/persona/:id/providers", (t) => {
  const routes = build(t, world());
  const admin = routes["GET /admin/llm/provider"], pub = routes["GET /llm/provider"];
  assert.deepEqual(admin.providers.map((p) => p.name), ["OpenAI", "Ollama"]);
  const [openai, local] = admin.providers;
  assert.equal(openai.id, 7);
  assert.equal(openai.api_key, "mock-only-not-a-secret");
  assert.equal(local.api_key, null);
  assert.equal(local.api_base, "http://gpu.example:11434");
  assert.equal(openai.is_public, true);
  assert.deepEqual([openai.groups, openai.personas], [[], []]);
  const [gpt5, mini] = openai.model_configurations;
  assert.deepEqual(gpt5, { id: gpt5.id, name: "gpt-5", display_name: "GPT-5", is_visible: true, max_input_tokens: 400000, supports_image_input: true,
    supports_reasoning: true, supported_reasoning_efforts: ["low", "high"], vendor: "openai" });
  assert.equal(mini.is_visible, false);
  assert.equal(mini.supports_reasoning, false);
  // The default provider's default model answers text and vision; the naming default is claimed explicitly.
  for (const catalog of [admin, pub, routes["GET /llm/persona/:id/providers"]]) {
    assert.deepEqual(catalog.default_text, { provider_id: 7, model_name: "gpt-5" });
    assert.deepEqual(catalog.default_vision, { provider_id: 7, model_name: "gpt-5" });
    assert.deepEqual(catalog.default_chat_naming, { provider_id: 7, model_name: "gpt-5-mini" });
    assert.equal(catalog.default_craft, null);
  }
  assert.deepEqual(pub.providers[0], { id: 7, name: "OpenAI", provider: "openai", provider_display_name: "OpenAI", model_configurations: openai.model_configurations, next_model_configuration_offset: null });
  assert.equal(pub.providers[1].provider_display_name, "Ollama");
  assert.deepEqual(routes["GET /llm/persona/:id/providers"].providers, pub.providers);
});

test("llm_providers: {} and null derive no providers instead of the neutral base default", (t) => {
  for (const empty of [{}, null]) {
    const routes = build(t, { llm_providers: empty });
    for (const route of ROUTES) {
      assert.deepEqual(routes[route], { providers: [], default_text: null, default_vision: null, default_chat_naming: null, default_craft: null }, route);
    }
  }
});

test("an absent llm_providers leaves the neutral base fixtures untouched", (t) => {
  const routes = build(t, {});
  const base = baseline();
  for (const route of ROUTES) assert.deepEqual(routes[route], base[route], route);
});

test("`<key>: null` drops an inherited provider", (t) => {
  const routes = build(t, world({ llm_providers: { ...world().llm_providers, local: null } }));
  assert.deepEqual(routes["GET /admin/llm/provider"].providers.map((p) => p.provider), ["openai"]);
});

test("provider and model IDs are order-independent: explicit id wins, otherwise a stable hash of the key", (t) => {
  const spec = world().llm_providers;
  const ids = (providers) => Object.fromEntries(build(t, { llm_providers: providers })["GET /admin/llm/provider"].providers.map((p) => [p.name, { id: p.id, models: Object.fromEntries(p.model_configurations.map((m) => [m.name, m.id])) }]));
  const forward = ids(spec);
  const reversed = ids(Object.fromEntries(Object.entries(spec).reverse().map(([key, value]) => [key, { ...value, models: Object.fromEntries(Object.entries(value.models).reverse()) }])));
  assert.deepEqual(reversed, forward);
  assert.equal(forward.OpenAI.id, 7, "explicit provider id wins");
  assert.ok(forward.Ollama.id >= 1000 && forward.Ollama.id !== 7, "derived id comes from the key");
  const modelIds = [...Object.values(forward.OpenAI.models), ...Object.values(forward.Ollama.models)];
  assert.equal(new Set(modelIds).size, 3);
  // Adding a provider changes no other provider's IDs.
  const more = ids({ extra: { provider: "anthropic" }, ...spec });
  assert.deepEqual({ OpenAI: more.OpenAI, Ollama: more.Ollama }, forward);
  const fixed = build(t, { llm_providers: { x: { provider: "openai", id: 1, models: { a: { id: 41 } } } } })["GET /admin/llm/provider"].providers[0];
  assert.deepEqual([fixed.id, fixed.model_configurations[0].id], [1, 41]);
});

test("groups and agents restrict a provider and drive /llm/persona/:id/providers", (t) => {
  const routes = build(t, {
    agents: { concierge: { name: "Concierge" }, other: { name: "Other agent" } },
    llm_providers: {
      open: { provider: "openai", models: { "gpt-5": { default: true } } },
      private: { provider: "anthropic", agents: ["concierge"], models: { claude: {} } },
      team: { provider: "portkey", groups: ["training"], models: { m: {} } },
    },
  });
  const admin = routes["GET /admin/llm/provider"].providers;
  const concierge = routes["GET /persona/" + admin.find((p) => p.provider === "anthropic").personas[0]]?.id;
  assert.ok(concierge > 0, "personas hold the agent's ID");
  const [open, priv, team] = admin;
  assert.equal(open.is_public, true);
  assert.deepEqual([priv.is_public, priv.groups, priv.personas], [false, [], [concierge]]);
  assert.equal(team.is_public, false);
  assert.equal(team.groups.length, 1);
  assert.deepEqual(routes["GET /admin/llm/provider"].providers.map((p) => p.name), ["OpenAI", "Anthropic", "Portkey"]);
  // The generic route lists unrestricted providers; the restricted agent additionally sees its own.
  assert.deepEqual(routes["GET /llm/persona/:id/providers"].providers.map((p) => p.provider), ["openai"]);
  assert.deepEqual(routes[`GET /llm/persona/${concierge}/providers`].providers.map((p) => p.provider), ["openai", "anthropic"]);
  assert.equal(routes["GET /llm/provider"].providers.length, 3);
});

test("v5 data derives router models, model routing and cost overrides; without it the base routes stay untouched", (t) => {
  const plain = build(t, world());
  assert.equal(plain["GET /admin/llm/model-routing"], undefined);
  const routes = build(t, { llm_providers: { main: { provider: "openai", models: { a: { id: 11 }, b: { id: 12 } },
    v5: { router_models: ["b"], routing: { enabled: true, model: "b" }, cost_overrides: { b: { model_configuration_id: 12, input_cost_per_million: 1.5 } } } } } });
  assert.deepEqual(routes["GET /admin/llm/router-models"].map((p) => p.model_configurations.map((m) => m.id)), [[12]]);
  assert.deepEqual(routes["GET /admin/llm/model-routing"], { model_routing_enabled: true, model_routing_model_configuration_id: 12 });
  assert.deepEqual(routes["GET /admin/cost-overrides"], [{ model_configuration_id: 12, input_cost_per_million: 1.5 }]);
  assert.throws(() => build(t, { llm_providers: { main: { provider: "openai", v5: { router_models: ["missing"] } } } }), /apps\.onyx\.llm_providers\.main\.v5\.router_models: unknown model missing/);
});

test("invalid provider worlds fail loudly", (t) => {
  assert.throws(() => build(t, { llm_providers: { x: { provider: "openai", bogus: true } } }), /apps\.onyx\.llm_providers\.x\.bogus: unknown field/);
  assert.throws(() => build(t, { llm_providers: { x: { provider: "openai", models: { m: { visble: true } } } } }), /apps\.onyx\.llm_providers\.x\.models\.m\.visble/);
  assert.throws(() => build(t, { llm_providers: { x: {} } }), /apps\.onyx\.llm_providers\.x: missing required "provider"/);
  assert.throws(() => build(t, { llm_providers: { x: { provider: "openai", groups: ["nobody"] } } }), /apps\.onyx\.llm_providers\.x\.groups: unknown team nobody/);
  assert.throws(() => build(t, { llm_providers: { x: { provider: "openai", agents: ["ghost"] } } }), /apps\.onyx\.llm_providers\.x\.agents: unknown agent ghost/);
  assert.throws(() => build(t, { llm_providers: { a: { provider: "openai", default: true }, b: { provider: "anthropic", default: true } } }), /only one provider can be the default/);
  assert.throws(() => build(t, { llm_providers: { a: { provider: "openai", models: { m: { default: true }, n: { default: true } } } } }), /default_text is also claimed/);
  assert.throws(() => build(t, { llm_providers: { x: { provider: "openai" } }, fixtures: { "GET /llm/provider": { providers: [] } } }), /apps\.onyx\.fixtures\.GET \/llm\/provider: provider routes are derived/);
});

test("the live catalog serves /llm/persona/:id/providers with the same restriction rule", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-llm-live-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, upstream: { ref: "v0.0.0-test" }, edition: "community" };
  const content = { company: { name: "Acme", domain: "acme.example" }, people: { sam: { name: "Sam", email: "sam@acme.example" }, kim: { name: "Kim" } },
    teams: { training: { name: "Training", members: ["kim"] } },
    apps: { onyx: { agents: { concierge: { name: "Concierge", id: 40 } }, llm_providers: {
      open: { provider: "openai", models: { "gpt-5": { default: true } } },
      private: { provider: "anthropic", agents: ["concierge"], models: { claude: {} } },
      team: { provider: "portkey", groups: ["training"], models: { m: {} } } } } } };
  const compiled = compile(content, { m, script: { name: "t", steps: [], _resolved: { source: path.join(dir, "script.yaml") } }, outputDir: path.join(fixturesDir, ".built", "script") });
  const table = new FixtureTable(fixturesDir); table.reload(compiled.overlays);
  const core = { state: {}, plugin: m, parseYaml, demoNow: () => Date.now(), log() {}, data: () => ({}), layerDirs: (sub) => layerDirs(fixturesDir, table.overlays, sub),
    fixture(method, url) { const found = table.find(method, url); return found ? substitute(found.route.val, found.params) : undefined; } };
  const handlers = createHandlers(core);
  handlers.reset({ overlays: compiled.overlays, resetChats: true });
  const get = (routePath, params = {}) => {
    const route = handlers.routes.find((r) => r.method === "GET" && r.path === routePath);
    let value;
    route.handle({ params, query: {}, send(_code, data) { value = data; } });
    return value;
  };
  const names = (value) => value.providers.map((p) => p.provider);
  // can_user_access_llm_provider: GET /llm/provider has no agent, so agent-restricted providers stay out; Sam (basic) is not in
  // Training, so its provider stays out too.
  assert.deepEqual(names(get("/llm/provider")), ["openai"]);
  assert.deepEqual(names(get("/llm/persona/:id/providers", { id: "40" })), ["openai", "anthropic"]);
  assert.deepEqual(names(get("/llm/persona/:id/providers", { id: "0" })), ["openai"]);
  // A member of the group sees it.
  core.state.adminGroupMembers = Object.fromEntries((core.fixture("GET", "/manage/admin/user-group") || []).map((group) => [group.id, [{ id: core.fixture("GET", "/me").id }]]));
  assert.deepEqual(names(get("/llm/provider")), ["openai", "portkey"]);
});
