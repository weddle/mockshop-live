import assert from "node:assert/strict";
import test from "node:test";
import createSaveControls from "./handlers-save-controls.mjs";
import createIndexMonitoring from "./handlers-index-monitoring.mjs";

const fixtures = {
  "GET /admin/llm/provider": { providers: [] },
  "GET /me": { email: "dana.reed@acme.example" },
  "GET /mockshop/save-controls": { pair: { status: "ACTIVE", num_docs_indexed: 0, indexing: false, permissions: { operate: true } } },
  "GET /manage/admin/credential": [{ id: 7, source: "confluence", name: "Engineering wiki account", credential_json: {} }],
  "GET /manage/admin/connector/indexing-status": [],
};
const core = { state: { org: "" }, fixture: (method, route) => fixtures[`${method} ${route}`] ?? null };
const call = async (route, body) => {
  let sent;
  await route.handle({ body: async () => body, params: {}, query: {}, send: (status, value) => { sent = { status, value }; } });
  return sent;
};

test("the Add Connector Create call makes a connector and pair that the indexing monitor lists", async () => {
  const saveControls = createSaveControls(core);
  const route = saveControls.routes.find((r) => r.path === "/manage/admin/connector-with-credential");
  const created = await call(route, {
    connector: { name: "Confluence – Quality space", source: "confluence", input_type: "poll", access_type: "sync", connector_specific_config: { space: "QUAL" } },
    pairing: { name: "Confluence – Quality space", access_type: "sync" }, credential_id: 7,
  });
  assert.equal(created.status, 200);
  assert.equal(created.value.success, true);
  const rows = createIndexMonitoring(core).transform["GET /manage/admin/index-monitoring/connectors"]({ items: [], federated_connectors: [] }, { req: { url: "/x?" } });
  assert.deepEqual(rows.items.map((row) => [row.cc_pair_id, row.name, row.status]), [[created.value.cc_pair_id, "Confluence – Quality space", "scheduled"]]);
});

test("an unknown saved account is refused with CREDENTIAL_NOT_FOUND", async () => {
  const route = createSaveControls(core).routes.find((r) => r.path === "/manage/admin/connector-with-credential");
  const refused = await call(route, { connector: { name: "x", source: "confluence", connector_specific_config: {} }, credential_id: 99 });
  assert.equal(refused.status, 404);
  assert.equal(refused.value.error_code, "CREDENTIAL_NOT_FOUND");
});
