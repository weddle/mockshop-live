import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateApp } from "./adapter/shared.mjs";
import { derive } from "./adapter/state.mjs";
import createAdminPages from "./handlers-admin-pages.mjs";
import createAuthAnonymous from "./handlers-auth-anonymous.mjs";
import createUserConditional from "./handlers-user-conditional.mjs";
import createUserExtras from "./handlers-user-extras.mjs";

const script = { name: "t", steps: [], _resolved: { source: "script.yaml" } };
const accepts = (state) => validateApp({ state }, script);
const rejects = (state, pattern) => assert.throws(() => accepts(state), pattern);

test("state schema accepts every known flag", () => {
  accepts({});
  for (const kind of ["none", "trialing", "active", "canceling", "expired"]) accepts({ billing: { case: kind } });
  accepts({ user_extras: { options: { enabled: true, empty_sidebar: true, notifications: [] } } });
  accepts({ user_conditional: { staging: { enabled: true } } });
  accepts({ auth_anonymous: { staging: { enabled: true, mode: "member", requires_verification: true, impersonation_superuser: true }, content: { label: "x" } } });
  accepts({ browser: { local_storage: [{ key: "onyx:craftOnboardingSeen:1", value: "true" }], session_storage: [{ key: "k", value: "v" }] } });
});

test("state schema rejects typos and bad values loudly", () => {
  rejects({ biling: { case: "active" } }, /apps\.onyx\.state/);
  rejects({ billing: { case: "gold" } }, /apps\.onyx\.state\.billing\.case/);
  rejects({ billing: { kase: "active" } }, /apps\.onyx\.state\.billing/);
  rejects({ user_extras: { option: {} } }, /apps\.onyx\.state\.user_extras/);
  rejects({ user_extras: { options: [] } }, /apps\.onyx\.state\.user_extras\.options/);
  rejects({ user_conditional: { staging: { enabled: "yes" } } }, /apps\.onyx\.state\.user_conditional\.staging\.enabled/);
  rejects({ user_conditional: { staging: { enable: true } } }, /apps\.onyx\.state\.user_conditional\.staging/);
  rejects({ auth_anonymous: { staging: { mode: 1 } } }, /apps\.onyx\.state\.auth_anonymous\.staging\.mode/);
  rejects({ auth_anonymous: { stage: {} } }, /apps\.onyx\.state\.auth_anonymous/);
  rejects({ browser: { local_storage: [{ key: "k", value: 1 }] } }, /apps\.onyx\.state\.browser\.local_storage/);
  rejects({ browser: { local_storage: { k: "v" } } }, /apps\.onyx\.state\.browser\.local_storage/);
  rejects({ browser: { cookies: {} } }, /apps\.onyx\.state\.browser/);
});

test("billing.case moved from the billing section to state", () => {
  const { billing } = JSON.parse(fs.readFileSync(new URL("./world.schema.json", import.meta.url), "utf8")).$defs;
  assert.equal(billing.properties.case, undefined);
});

test("the adapter writes the state flags to state.json, and an empty object when the world sets none", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "onyx-state-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const state = { billing: { case: "trialing" }, browser: { local_storage: [{ key: "a", value: "b" }] } };
  derive({ app: { state }, outputDir });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, "state.json"), "utf8")), state);
  derive({ app: {}, outputDir });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, "state.json"), "utf8")), {});
});

// Minimal core: fixtures by route, state.json layer re-read on every request (like core.data).
function fakeCore(fixtures = {}) {
  const core = {
    flags: {},
    plugin: { ports: { web: 3300, mock: 8800 } }, state: {}, demoNow: () => 0,
    data: (name) => (name === "state" ? core.flags : {}),
    fixture: (method, route) => fixtures[`${method} ${route}`],
  };
  return core;
}

test("admin pages read the billing case per request from state, not from a fixture switch", () => {
  const core = fakeCore({
    "GET /mockshop/admin-pages/defaults": { fake_secret: "x", billing_tiers: { active: "business", none: "community" } },
    "GET /mockshop/admin-pages/billing-snapshots": { active: { subscribed: true, seats: 5 }, none: { subscribed: false } },
  });
  const settings = (pages) => pages.transform["GET /settings"]({ tier: "enterprise" }).tier;
  let pages = createAdminPages(core);
  assert.equal(pages.transform["GET /tenants/billing-information"]("baseline"), "baseline", "no flag keeps the baseline fixture");
  assert.equal(settings(pages), "enterprise");
  core.flags = { billing: { case: "active" } };
  assert.equal(settings(pages), "business", "tier follows the flag without rebuilding the handler");
  pages = createAdminPages(core);
  assert.deepEqual(pages.transform["GET /tenants/billing-information"]("baseline"), { subscribed: true, seats: 5 });
  core.flags = { billing: { case: "none" } };
  pages.reset();
  assert.deepEqual(pages.transform["GET /tenants/billing-information"]("baseline"), { subscribed: false });
});

test("user extras decorations come from state.user_extras.options and need enabled: true", () => {
  const core = fakeCore({ "GET /mockshop/user-extras": { avatar_png_base64: "AA", branding: { application_name: "Seed" } } });
  const extras = createUserExtras(core, {});
  assert.equal(extras.visibleAgent({ builtin_persona: false }), true);
  assert.equal(extras.seedPins(["pin"]).length, 1);
  core.flags = { user_extras: { options: { enabled: true, empty_gallery: true, empty_sidebar: true } } };
  assert.equal(extras.visibleAgent({ builtin_persona: false }), false);
  assert.deepEqual(extras.seedPins(["pin"]), []);
  core.flags = { user_extras: { options: { empty_gallery: true } } };
  assert.equal(extras.visibleAgent({ builtin_persona: false }), true, "options without enabled: true stay inert");
});

test("conditional receipts route is scoped by state.user_conditional.staging.enabled", async () => {
  const core = fakeCore({ "GET /mockshop/user-conditional/content": { label: "FAKE" } });
  const route = createUserConditional(core, { stageMember() {} }).routes.find((r) => r.path === "/mockshop/user-conditional/receipts");
  const sent = [];
  const ctx = { send: (...args) => sent.push(args) };
  assert.equal(await route.handle(ctx), false);
  core.flags = { user_conditional: { staging: { enabled: true } } };
  await route.handle(ctx);
  assert.equal(sent[0][0], 200);
  assert.equal(sent[0][1].label, "FAKE");
});

test("auth-anonymous routes follow state.auth_anonymous.staging and state content deep-merges over the seeded content", async () => {
  const seeded = { label: "SEED", email: "a@example.test", messages: {} };
  const core = fakeCore({ "GET /mockshop/auth-anonymous/content": seeded });
  const route = createAuthAnonymous(core, { webOrigin: "http://127.0.0.1:3300" }).routes.find((r) => r.path === "/mockshop/auth-anonymous/messages");
  const sent = [];
  const ctx = { query: {}, send: (...args) => sent.push(args) };
  assert.equal(await route.handle(ctx), false);
  core.flags = { auth_anonymous: { staging: { enabled: true, mode: "logged-out" }, content: { label: "DEMO", email: "b@example.test", messages: {} } } };
  await route.handle(ctx);
  assert.equal(sent.length, 1);
  assert.match(JSON.stringify(sent[0]), /DEMO/);
  core.flags = { auth_anonymous: { staging: { enabled: true } } };
  sent.length = 0;
  await route.handle(ctx);
  assert.match(JSON.stringify(sent[0]), /SEED/, "without state content the seeded fixture is the default");
  core.flags = { auth_anonymous: { staging: { enabled: true }, content: { label: "SPARSE" } } };
  sent.length = 0;
  await route.handle(ctx);
  assert.equal(sent[0][1].label, "SPARSE", "sparse state content overrides only the keys it states and the route still answers from the seeded rest");
});
