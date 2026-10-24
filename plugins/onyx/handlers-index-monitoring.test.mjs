import assert from "node:assert/strict";
import test from "node:test";
import createIndexMonitoring, { createdRows } from "./handlers-index-monitoring.mjs";

const seedRow = (id, name, status) => ({ cc_pair_id: id, name, source: "slack", access_type: "public", cc_pair_status: "ACTIVE", status, docs_indexed: 10, latest_index_attempt: null });
const connectors = { items: [seedRow(1, "Slack – Engineering chat", "indexed")], total_items: 1, status_counts: {}, federated_connectors: [] };
const store = { seededPairs: new Set([1]), pairs: {
  1: { id: 1, name: "Slack – Engineering chat", connector: { source: "slack" }, status: "ACTIVE" },
  1000: { id: 1000, name: "Microsoft Teams – Plant Operations", connector: { source: "teams" }, status: "ACTIVE", access_type: "sync", creator_email: "dana.reed@acme.example" },
} };
const core = (saveControls) => ({ state: { org: "", saveControls: saveControls ? { "": saveControls } : {} },
  fixture: (method, route) => (route.endsWith("/runs") ? { items: [] } : connectors), demoNow: () => 0 });
const ctx = { req: { url: "/api/manage/admin/index-monitoring/connectors?" } };

test("only pairs created in the UI become scheduled rows", () => {
  const rows = createdRows(store);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].cc_pair_id, rows[0].source, rows[0].status, rows[0].docs_indexed], [1000, "teams", "scheduled", 0]);
  assert.deepEqual(createdRows(undefined), []);
});

test("the connectors list and the overview include created pairs", () => {
  const { transform } = createIndexMonitoring(core(store));
  const list = transform["GET /manage/admin/index-monitoring/connectors"](connectors, ctx);
  assert.deepEqual(list.items.map((row) => row.cc_pair_id), [1000, 1]);
  assert.equal(list.total_items, 2);
  assert.equal(list.status_counts.scheduled, 1);
  const overview = transform["GET /manage/admin/index-monitoring/overview"]({}, { req: { url: "/x?window=24h" } });
  assert.equal(overview.active_connectors, 2);
});

test("with no saved state the list is untouched", () => {
  const { transform } = createIndexMonitoring(core(null));
  assert.equal(transform["GET /manage/admin/index-monitoring/connectors"](connectors, ctx).total_items, 1);
});
