import assert from "node:assert/strict";
import test from "node:test";
import { assertState, checkStep, snapshot } from "./state-assert.mjs";

const agents = [
  { id: 11, _key: "desk", name: "Desk", is_listed: true, display_priority: 1, tags: ["a"] },
  { id: 12, _key: "ops", name: "Ops", is_listed: false, display_priority: 0, tags: [] },
  { id: 13, _key: "analyst", name: "Analyst", is_listed: true, display_priority: 0, tags: ["a", "b"] },
  { id: 90, name: "Created live", is_listed: true, display_priority: null, tags: [] },
];
// A fake state API over an in-memory world; `mutate` lets a test change it between steps.
const world = () => {
  const data = { agents: structuredClone(agents), user: { pinned_agents: [0, 11, 12] } };
  const read = async (path) => {
    const [collection, key] = path.slice(1).split("/");
    if (collection === "user") return data.user[key];
    if (key === undefined) return data[collection];
    return data[collection]?.find((row) => row._key === key);
  };
  return { data, read, snapshots: new Map() };
};
const run = (w, arg) => assertState(arg, w.read, w.snapshots);

test("entity field operators", async () => {
  const w = world();
  await run(w, { entity: "agents.ops", field: "is_listed", equals: false });
  await run(w, { entity: "agents.ops", field: "display_priority", in: [0, 1] });
  await run(w, { entity: "agents.desk", field: "tags", contains: "a" });
  await run(w, { entity: "agents.desk", field: "name", not_equals: "Ops" });
  await run(w, { entity: "agents.desk", field: "name", contains: "es" });
  await run(w, { list: "agents", where: { is_listed: false }, field: "name", contains: "Op" });
  await assert.rejects(run(w, { list: "agents", where: { is_listed: false }, field: "name", contains: "Desk" }), /contains: expected "Desk"/);
  await run(w, { entity: "agents.desk", exists: true });
  await run(w, { entity: "agents.nobody", exists: false });
  await run(w, { entity: "user.pinned_agents", equals: [0, 11, 12] });
});

test("a failed assertion names the entity, field, operator, expected and actual value", async () => {
  const w = world();
  await assert.rejects(run(w, { entity: "agents.ops", field: "is_listed", equals: true }), /agents\.ops\.is_listed equals: expected true, got false/);
  await assert.rejects(run(w, { entity: "agents.ops", field: "display_priority", in: [5, 6] }), /in: expected \[5,6\], got 0/);
  await assert.rejects(run(w, { entity: "agents.nobody", exists: true }), /exists: expected true, got undefined/);
});

test("list filtering, ordering, counting and ordered keys (stable order, nulls last, '-' descending)", async () => {
  const w = world();
  await run(w, { list: "agents", count: 4 });
  await run(w, { list: "agents", where: { is_listed: true }, count: 3 });
  await run(w, { list: "agents", where: { is_listed: true }, order_by: "display_priority", keys: ["analyst", "desk", "90"] });
  await run(w, { list: "agents", order_by: "-display_priority", keys: ["desk", "ops", "analyst", "90"] });
  await assert.rejects(run(w, { list: "agents", where: { is_listed: true }, keys: ["desk", "analyst"] }), /keys: expected \["desk","analyst"\], got \["desk","analyst","90"\]/);
  await run(w, { list: "agents", where: { is_listed: false }, field: "name", equals: ["Ops"] });
  await assert.rejects(run(w, { list: "agents", count: 3 }), /count: expected 3, got 4/);
});

test("snapshots: unchanged_since with except, equals_snapshot, and scope to one Map", async () => {
  const w = world();
  await snapshot({ as: "before", entity: "agents.ops" }, w.read, w.snapshots);
  await snapshot({ as: "pins", entity: "user.pinned_agents" }, w.read, w.snapshots);
  await run(w, { entity: "agents.ops", unchanged_since: "before" });
  await run(w, { entity: "user.pinned_agents", equals_snapshot: "pins" });
  w.data.agents[1].is_listed = true;
  await assert.rejects(run(w, { entity: "agents.ops", unchanged_since: "before" }), /unchanged_since before.*expected .*"is_listed":false.*got .*"is_listed":true/s);
  await run(w, { entity: "agents.ops", unchanged_since: "before", except: ["is_listed"] });
  w.data.user.pinned_agents = [0];
  await assert.rejects(run(w, { entity: "user.pinned_agents", equals_snapshot: "pins" }), /equals_snapshot pins: expected \[0,11,12\], got \[0\]/);
  await assert.rejects(run(w, { entity: "agents.ops", equals_snapshot: "missing" }), /no snapshot named "missing"/);
  assert.equal(world().snapshots.size, 0, "snapshots do not leak between runs");
});

test("a snapshot of a field compares that field", async () => {
  const w = world();
  await snapshot({ as: "listed", entity: "agents.ops", field: "is_listed" }, w.read, w.snapshots);
  await run(w, { entity: "agents.ops", field: "is_listed", equals_snapshot: "listed" });
  w.data.agents[1].is_listed = true;
  await assert.rejects(run(w, { entity: "agents.ops", field: "is_listed", equals_snapshot: "listed" }), /expected false, got true/);
});

test("checkStep: target shape, operators, snapshot names and collections", () => {
  const paths = (op, arg, opts) => checkStep(op, arg, opts).map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(paths("assert_state", { entity: "agents.ops", equals: 1 }), []);
  assert.match(paths("assert_state", { equals: 1 })[0], /exactly one of entity or list/);
  assert.match(paths("assert_state", { entity: "agents.ops", list: "agents", equals: 1 })[0], /exactly one/);
  assert.match(paths("assert_state", { entity: "agents", equals: 1 }).join("\n"), /<collection>\.<key>/);
  assert.match(paths("assert_state", { entity: "agents.ops" }).join("\n"), /needs an operator/);
  assert.match(paths("assert_state", { entity: "agents.ops", count: 1 }).join("\n"), /count only applies to list/);
  assert.match(paths("assert_state", { entity: "agents.ops", unchanged_since: "x" }, { known: new Set() }).join("\n"), /no earlier snapshot_state named "x"/);
  assert.deepEqual(paths("assert_state", { entity: "agents.ops", unchanged_since: "x", except: ["a"] }, { known: new Set(["x"]) }), []);
  assert.match(paths("assert_state", { entity: "agents.ops", equals: 1, except: ["a"] }).join("\n"), /except only applies with unchanged_since/);
  assert.match(paths("assert_state", { list: "nope", count: 1 }, { collections: ["agents"] }).join("\n"), /unknown state collection "nope"/);
  assert.match(paths("snapshot_state", { entity: "agents.ops" }).join("\n"), /needs a snapshot name/);
  assert.match(paths("snapshot_state", { as: "x", entity: "agents.ops" }, { known: new Set(["x"]) }).join("\n"), /duplicate snapshot name "x"/);
  assert.match(paths("assert_state", { entity: "agents.ops", equals: 1, bogus: 1 }).join("\n"), /unknown assert_state field "bogus"/);
});
