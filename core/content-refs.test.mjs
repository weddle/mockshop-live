import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { contentRefs, loadContent, refRoots, resolveContent } from "./content.mjs";
import { stableNumber, stableUuid } from "./ids.mjs";

const manifest = {
  name: "demo",
  world_refs: { collections: {
    agents: { from: "apps.demo.agents", id: "number" },
    teams: { from: "apps.demo.teams", shared: true, id: "number" },
    people: { from: "apps.demo.people", shared: true, id: "uuid" },
  } },
};

const world = (agents, extra = "") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-refs-"));
  const file = path.join(dir, "world.yaml");
  fs.writeFileSync(file, `company: { name: Acme }
people:
  ann: { name: Ann Lee }
teams:
  ops: { name: Ops, members: [ann] }
apps:
  demo:
    agents:
${agents}
    teams:
      ops: { id: 7 }
${extra}`);
  return { dir, file };
};
const load = (file, content = {}) => loadContent(file, { content, refs: contentRefs(manifest) });

test("IDs are pure functions of namespace:collection:key; an explicit id wins; people use UUIDs", () => {
  assert.equal(stableNumber("demo", "agents", "desk"), stableNumber("demo", "agents", "desk"));
  assert.notEqual(stableNumber("demo", "agents", "desk"), stableNumber("demo", "agents", "ops"));
  assert.notEqual(stableNumber("demo", "agents", "desk"), stableNumber("other", "agents", "desk"));
  assert.match(stableUuid("demo", "people", "ann"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  const { dir, file } = world("      desk: { name: Desk, id: 11 }\n      ops: { name: Ops Agent }");
  try {
    const { refs } = load(file);
    assert.equal(refs.agents.desk.id, 11);
    assert.equal(refs.agents.ops.id, stableNumber("demo", "agents", "ops"));
    assert.equal(refs.teams.ops.id, 7, "shared collection: id from apps.<plugin>.teams");
    assert.equal(refs.teams.ops.name, "Ops", "shared collection keeps the shared entity fields");
    assert.equal(refs.people.ann.id, stableUuid("demo", "people", "ann"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("reordering or adding agents changes no other agent's ID", () => {
  const a = world("      desk: { name: Desk }\n      ops: { name: Ops Agent }");
  const b = world("      extra: { name: New }\n      ops: { name: Ops Agent }\n      desk: { name: Desk }");
  try {
    const x = load(a.file).refs.agents, y = load(b.file).refs.agents;
    assert.equal(x.desk.id, y.desk.id);
    assert.equal(x.ops.id, y.ops.id);
    assert.deepEqual(Object.keys(y), ["extra", "ops", "desk"]);
  } finally { for (const w of [a, b]) fs.rmSync(w.dir, { recursive: true, force: true }); }
});

test("world strings and script strings resolve {{agents.<key>.id}} and entity fields; the validated world carries no extra roots", () => {
  const { dir, file } = world("      desk: { name: Desk, id: 11 }\n      ops: { name: \"{{company.name}} Ops\", note: \"see {{agents.desk.id}}\" }");
  try {
    const { content, refs } = load(file);
    assert.equal(content.apps.demo.agents.ops.note, "see 11");
    assert.equal(content.apps.demo.agents.ops.name, "Acme Ops");
    assert.equal(content.agents, undefined);
    const script = resolveContent({ a: "{{agents.desk.id}}", b: "row-{{agents.ops.id}}", c: "{{agents.ops.name}}", d: "{{teams.ops.id}}" }, { ...content, ...refs }, { roots: Object.keys(refs), resolvedContext: true });
    assert.equal(script.a, 11);
    assert.equal(script.b, `row-${refs.agents.ops.id}`);
    assert.equal(script.c, "Acme Ops");
    assert.equal(script.d, 7);
    assert.throws(() => resolveContent({ a: "{{agents.desk.id}}" }, content), /unknown reference root "agents"/);
    assert.throws(() => resolveContent({ a: "{{agents.nobody.id}}" }, { ...content, ...refs }, { roots: Object.keys(refs), resolvedContext: true }), /missing reference "agents.nobody.id"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("without a manifest declaration nothing extra resolves", () => {
  assert.equal(contentRefs({ name: "plain" }), undefined);
  assert.deepEqual(refRoots({ apps: {} }, undefined), {});
});
