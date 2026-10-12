import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadContent, loadData, mergeData, resolveContent } from "../core/content.mjs";
import { check } from "../core/validate.mjs";

function files(t, contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-content-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(contents)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof text === "string" ? text : JSON.stringify(text));
  }
  return (name) => path.join(root, name);
}

const shared = () => ({
  company: { name: "Example", domain: "example.test" },
  people: { sam: { name: "Sam", title: "Engineer" }, dana: { name: "Dana" } },
  teams: { engineering: { name: "Engineering", members: ["sam"] } },
  sources: { runbooks: { name: "Runbooks", vendor: "confluence" } },
  documents: { rollback: { source: "runbooks", title: "Rollback", author: "sam", owners: ["dana"], body: "Ask {{people.sam.name}}." } },
  conversations: { incident: { title: "Incident", messages: [{ role: "assistant", person: "dana", text: "{{people.sam.name}} owns rollback.", documents: ["rollback"] }] } },
});

test("one composition rule replaces arrays/scalars and preserves null without mutating inputs", () => {
  const base = { a: { inherited: 1, changed: 2 }, list: [1, 2], clear: { old: true } };
  const override = { a: { changed: 3 }, list: [3], clear: null };
  const result = mergeData(base, override);
  assert.deepEqual(result, { a: { inherited: 1, changed: 3 }, list: [3], clear: null });
  result.a.inherited = 9;
  result.list.push(4);
  assert.deepEqual(base, { a: { inherited: 1, changed: 2 }, list: [1, 2], clear: { old: true } });
  assert.deepEqual(override, { a: { changed: 3 }, list: [3], clear: null });
  assert.deepEqual(mergeData(base, undefined), base);
  assert.equal(mergeData({ a: 1 }, null), null);
});

test("ordered includes, nested relative files and script content compose before resolving", (t) => {
  const at = files(t, {
    "world/parts/common.yaml": "people:\n  sam:\n    name: Original\n    title: Engineer\nvars:\n  list: [one, two]\n  value: 1\n  nullable: inherited\n",
    "world/parts/next.json": { vars: { list: ["next"], value: 2 }, people: { sam: { name: "Second" } } },
    "world/world.yaml": "includes: [parts/common.yaml, parts/next.json]\ncompany:\n  name: Example\npeople:\n  sam:\n    name: World\nvars:\n  greeting: 'Hello {{people.sam.name}}'\n",
    "script/extra.yaml": "vars:\n  list: [script]\n  value: 3\n",
    "script/demo.yaml": "content:\n  includes: [extra.yaml]\n  people:\n    sam:\n      name: Local\n  vars:\n    nullable: null\n",
  });
  const raw = loadData(at("script/demo.yaml"));
  const loaded = loadContent(at("world/world.yaml"), { content: raw.data.content, file: at("script/demo.yaml"), origins: raw.origins, inputs: raw.inputs });
  assert.deepEqual(loaded.content.people.sam, { name: "Local", title: "Engineer" });
  assert.deepEqual(loaded.content.vars, { list: ["script"], value: 3, nullable: null, greeting: "Hello Local" });
  assert.equal(loaded.origins["people.sam.name"].file, fs.realpathSync(at("script/demo.yaml")));
  assert.equal(loaded.origins["people.sam.name"].line, 5);
  assert.equal(loaded.origins["people.sam.title"].file, fs.realpathSync(at("world/parts/common.yaml")));
  assert.equal(loaded.origins["vars.list.0"].file, fs.realpathSync(at("script/extra.yaml")));
  assert.equal(loaded.origins["vars.list.1"], undefined, "replaced lists cannot retain old origin entries");
  assert.equal(loaded.inputs.length, 5);
  assert.equal(loadContent(at("world/world.yaml")).content.people.sam.name, "World", "script overrides do not mutate reusable worlds");
});

test("loadData handles generic YAML/JSON origins without applying world validation or references", (t) => {
  const at = files(t, {
    "script.yaml": "name: demo\nscenes:\n  - id: intro\n    steps:\n      - id: greeting\n        type: '{{people.sam.name}}'\n",
    "data.json": { arbitrary: [1, null, false] },
  });
  const loaded = loadData(at("script.yaml"), { includes: false });
  assert.equal(loaded.data.scenes[0].steps[0].type, "{{people.sam.name}}");
  assert.equal(loaded.origins["scenes.0.steps.0.id"].line, 5);
  assert.deepEqual(loaded.origins["scenes[0].steps[0].id"], loaded.origins["scenes.0.steps.0.id"]);
  assert.deepEqual(loadData(at("data.json")).data, { arbitrary: [1, null, false] });
});

test("script and profile loaders reject root includes but allow content includes", (t) => {
  const at = files(t, {
    "part.yaml": "vars: {answer: 42}\n",
    "profile.yaml": "includes: [part.yaml]\n",
    "script.yaml": "content:\n  includes: [part.yaml]\nscenes: []\n",
  });
  assert.throws(() => loadData(at("profile.yaml"), { includes: false }), /profile\.yaml:1: includes:.*only supported in world\/content/);
  const loaded = loadData(at("script.yaml"), { includes: false });
  assert.deepEqual(loadContent(null, { content: loaded.data.content, file: at("script.yaml"), origins: loaded.origins, inputs: loaded.inputs }).content, { vars: { answer: 42 } });
});

test("whole-value references retain all JSON types while embedded references use scalar text", () => {
  const content = { vars: { number: 42, flag: false, empty: null, list: [1, 2], object: { nested: 3 }, chain: "{{vars.number}}" } };
  assert.deepEqual(resolveContent({ number: "{{vars.chain}}", flag: "{{ vars.flag }}", empty: "{{vars.empty}}", list: "{{vars.list}}", object: "{{vars.object}}", text: "{{vars.number}} / {{vars.flag}} / {{vars.empty}}", indexed: "{{vars.list.1}}" }, content), {
    number: 42, flag: false, empty: null, list: [1, 2], object: { nested: 3 }, text: "42 / false / null", indexed: 2,
  });
  assert.throws(() => resolveContent("List: {{vars.list}}", content, { file: "script.yaml" }), /script\.yaml:1:.*must resolve to scalar text/);
  assert.throws(() => resolveContent("Object: {{vars.object}}", content), /must resolve to scalar text/);
});

test("substituted text is never reinterpreted, including a subsequent script resolution", () => {
  const loaded = loadContent(null, { content: { vars: { open: "{{", name: "people.missing.name", literal: "{{vars.open}}{{vars.name}}}}", clock: "{{vars.open}}ago:3h}}" } } });
  assert.equal(loaded.content.vars.literal, "{{people.missing.name}}");
  assert.equal(loaded.content.vars.clock, "{{ago:3h}}");
  assert.equal(resolveContent("Value: {{vars.literal}}", loaded.content), "Value: {{people.missing.name}}");
  assert.equal(resolveContent({ value: "{{vars.clock}}" }, loaded.content).value, "{{ago:3h}}");
});

test("structured use deep-merges defaults, replaces lists/null, and permits inherited path lookup", () => {
  const content = { vars: { defaults: { nested: { inherited: 1, overridden: 2 }, list: [1, 2], clear: "yes" }, derived: { use: "vars.defaults", nested: { overridden: 9 }, list: [3], clear: null }, inherited: "{{vars.derived.nested.inherited}}" } };
  const loaded = loadContent(null, { content }).content;
  assert.deepEqual(loaded.vars.derived, { nested: { inherited: 1, overridden: 9 }, list: [3], clear: null });
  assert.equal(loaded.vars.inherited, 1);
  assert.deepEqual(resolveContent({ use: "vars.derived", nested: { extra: 4 } }, loaded), { nested: { inherited: 1, overridden: 9, extra: 4 }, list: [3], clear: null });
  assert.throws(() => resolveContent({ use: "vars.list" }, { vars: { list: [] } }), /use must reference a structured object/);
  assert.throws(() => resolveContent({ use: ["vars.defaults"] }, content), /invalid reference path/);
});

test("use and whole-object references retain inherited field origins", (t) => {
  const at = files(t, {
    "world.yaml": "vars:\n  default_person:\n    name: Sam\n    title: Engineer\npeople:\n  sam:\n    use: vars.default_person\n    title: Lead\n  dana: '{{vars.default_person}}'\n",
  });
  const loaded = loadContent(at("world.yaml"));
  assert.equal(loaded.origins["people.sam.name"].line, 3);
  assert.equal(loaded.origins["people.sam.title"].line, 8);
  assert.equal(loaded.origins["people.dana.title"].line, 4);
  assert.deepEqual(loaded.content.people, { sam: { name: "Sam", title: "Lead" }, dana: { name: "Sam", title: "Engineer" } });
});

test("missing, unsafe and cyclic reference/use paths produce source diagnostics", (t) => {
  const at = files(t, { "bad.yaml": "vars:\n  message: '{{people.missing.name}}'\n" });
  assert.throws(() => loadContent(at("bad.yaml")), (error) => error.file === fs.realpathSync(at("bad.yaml")) && error.line === 2 && error.path === "vars.message" && /missing reference/.test(error.message));
  for (const expression of ["people.__proto__.name", "vars.constructor", "vars.prototype", "vars.list.length", "vars.list[-1]", "vars.a + 1", "process.env.HOME", "vars.toString"]) {
    assert.throws(() => resolveContent(`{{${expression}}}`, { vars: { list: [] } }), /reference/);
  }
  assert.throws(() => loadContent(null, { content: { vars: { a: "{{vars.b}}", b: "{{vars.a}}" } } }), /reference cycle/);
  assert.throws(() => loadContent(null, { content: { vars: { a: { use: "vars.b" }, b: { use: "vars.a" } } } }), /reference\/use cycle/);
  assert.throws(() => loadContent(null, { content: { vars: { a: "{{vars}}" } } }), /reference cycle/);
  assert.throws(() => loadContent(null, { content: { vars: { a: "{{vars.b}}", b: { value: "{{vars.a}}" } } } }), /reference cycle/);
});

test("body files resolve relative to their declaring include or script and contribute byte hashes", (t) => {
  const at = files(t, {
    "world/world.yaml": "includes: [parts/documents.yaml]\npeople:\n  sam: {name: World}\nsources:\n  runbooks: {name: Runbooks, vendor: confluence}\n",
    "world/parts/documents.yaml": "documents:\n  rollback:\n    source: runbooks\n    title: Rollback\n    body_file: body.txt\n",
    "world/parts/body.txt": "Ask {{people.sam.name}}.\n",
    "script/demo.yaml": "content:\n  people:\n    sam:\n      name: Local\n  documents:\n    rollback:\n      body_file: local.txt\n",
    "script/local.txt": "Local owner: {{people.sam.name}}.\n",
  });
  const world = loadContent(at("world/world.yaml"));
  assert.equal(world.content.documents.rollback.body, "Ask World.\n");
  assert.equal(world.content.documents.rollback.body_file, undefined);
  assert.deepEqual(world.origins["documents.rollback.body"], { file: fs.realpathSync(at("world/parts/body.txt")), line: 1 });
  const script = loadData(at("script/demo.yaml"));
  const loaded = loadContent(at("world/world.yaml"), { content: script.data.content, file: at("script/demo.yaml"), origins: script.origins, inputs: script.inputs });
  assert.equal(loaded.content.documents.rollback.body, "Local owner: Local.\n");
  assert.equal(loaded.inputs.length, 5);
  for (const input of loaded.inputs) assert.equal(input.hash, createHash("sha256").update(fs.readFileSync(input.file)).digest("hex"));
  assert.equal(new Set(loaded.inputs.map((input) => input.file)).size, loaded.inputs.length);
  const before = loaded.inputs.find((input) => input.file === fs.realpathSync(at("script/local.txt"))).hash;
  fs.writeFileSync(at("script/local.txt"), "Changed {{people.sam.name}}.\n");
  const updated = loadContent(at("world/world.yaml"), { content: { documents: { rollback: { body_file: "local.txt" } } }, file: at("script/demo.yaml") });
  assert.notEqual(updated.inputs.find((input) => input.file === fs.realpathSync(at("script/local.txt"))).hash, before);
});

test("explicit inline bodies override inherited file bodies and null remains an authored value", (t) => {
  const at = files(t, {
    "world.yaml": "sources:\n  docs: {name: Docs, vendor: other}\ndocuments:\n  note:\n    source: docs\n    title: Note\n    body_file: note.txt\n",
    "note.txt": "Inherited body",
  });
  assert.equal(loadContent(at("world.yaml"), { content: { documents: { note: { body: "Inline" } } } }).content.documents.note.body, "Inline");
  assert.equal(loadContent(at("world.yaml"), { content: { documents: { note: { body: null } } } }).content.documents.note.body, null);
  assert.throws(() => loadContent(null, { content: { vars: { note: { body: "both", body_file: "note.txt" } } }, file: at("world.yaml") }), /body and body_file/);
  assert.throws(() => loadContent(null, { content: { vars: { note: { body_file: "note.txt" } } } }), /declaring file is required/);
});

test("input hash and origin are retained when script origins are provided without preloaded inputs", (t) => {
  const at = files(t, { "script.yaml": "content:\n  vars:\n    count: 2\n" });
  const script = loadData(at("script.yaml"));
  const loaded = loadContent(null, { content: script.data.content, file: at("script.yaml"), origins: script.origins });
  assert.equal(loaded.inputs.length, 1);
  assert.deepEqual(loaded.inputs[0], script.inputs[0]);
  assert.equal(loaded.origins["vars.count"].line, 3);
});

test("include/body errors reject remote, absolute, malformed paths, duplicate keys and cycles", (t) => {
  const at = files(t, {
    "a.yaml": "includes: [b.yaml]\n",
    "b.yaml": "includes: [a.yaml]\n",
    "remote.yaml": "includes: ['https://example.test/world.yaml']\n",
    "absolute.yaml": "includes: ['/tmp/world.yaml']\n",
    "missing.yaml": "includes: [missing-part.yaml]\n",
    "bad-list.yaml": "includes: child.yaml\n",
    "script.yaml": "includes: [generator.mjs]\n",
    "duplicate.yaml": "vars:\n  a: 1\n  a: 2\n",
    "unsafe.json": '{"vars":{"__proto__":{"polluted":true}}}',
    "alias.yaml": "vars:\n  loop: &loop [*loop]\n",
    "tag.yaml": "vars:\n  value: !execute code\n",
    "number-key.yaml": "people:\n  1: {name: One}\n",
    "array.yaml": "- not-an-object\n",
  });
  assert.throws(() => loadContent(at("a.yaml")), /include cycle:.*a\.yaml.*b\.yaml.*a\.yaml/);
  for (const name of ["remote.yaml", "absolute.yaml"]) assert.throws(() => loadContent(at(name)), /relative local file path/);
  assert.throws(() => loadContent(at("missing.yaml")), /includes\.0: cannot read/);
  assert.throws(() => loadContent(at("bad-list.yaml")), /includes must be a list/);
  assert.throws(() => loadContent(at("script.yaml")), /data files must use/);
  assert.throws(() => loadContent(at("duplicate.yaml")), /unique|duplicate/i);
  assert.throws(() => loadContent(at("unsafe.json")), /unsafe property/);
  assert.throws(() => loadContent(at("alias.yaml")), /cyclic|alias/i);
  assert.throws(() => loadContent(at("tag.yaml")), /Unresolved tag|tag/i);
  assert.throws(() => loadContent(at("number-key.yaml")), /map keys must be strings/);
  assert.throws(() => loadContent(at("array.yaml")), /expected a data object/);
  assert.equal({}.polluted, undefined);
});

test("repeated includes are not cycles and symlink aliases cannot hide a real cycle", (t) => {
  const at = files(t, {
    "shared.yaml": "vars: {value: 1}\n",
    "left.yaml": "includes: [shared.yaml]\n",
    "right.yaml": "includes: [shared.yaml]\n",
    "world.yaml": "includes: [left.yaml, right.yaml]\n",
    "cycle.yaml": "includes: [alias.yaml]\n",
  });
  const loaded = loadContent(at("world.yaml"));
  assert.equal(loaded.content.vars.value, 1);
  assert.equal(loaded.inputs.length, 4);
  fs.symlinkSync(at("cycle.yaml"), at("alias.yaml"));
  assert.throws(() => loadContent(at("cycle.yaml")), /include cycle/);
});

test("explicit removals happen before resolution and reject remaining relationships", () => {
  const content = shared();
  const removed = loadContent(null, { content, remove: ["conversations.incident", "documents.rollback", "teams.engineering", "people.sam", "company"] });
  assert.equal(removed.content.company, undefined);
  assert.deepEqual(removed.content.people, { dana: { name: "Dana" } });
  assert.equal(removed.origins["people.sam.name"], undefined);
  assert.equal(content.people.sam.name, "Sam");
  assert.throws(() => loadContent(null, { content, remove: ["people.sam"] }), /missing reference|unknown people entity/);
  assert.throws(() => loadContent(null, { content, remove: ["sources.runbooks"] }), /documents\.rollback\.source: unknown sources entity/);
  assert.throws(() => loadContent(null, { content, remove: ["documents.rollback"] }), /conversations\.incident\.messages\.0\.documents\.0: unknown documents entity/);
  assert.throws(() => loadContent(null, { content, remove: ["people.absent"] }), /cannot remove missing entity/);
  assert.throws(() => loadContent(null, { content, remove: ["people.sam.name"] }), /remove entries must name/);
  assert.throws(() => loadContent(null, { content, remove: ["vars.__proto__"] }), /unsafe or invalid reference path/);
  assert.throws(() => loadContent(null, { content, remove: "people.sam" }), /remove must be a list/);
  const app = loadContent(null, { content: { apps: { unrelated: { entities: { a: { value: 1 }, b: { value: 2 } } } }, vars: { spare: null } }, remove: ["apps.unrelated.entities.a", "vars.spare"] });
  assert.deepEqual(app.content, { apps: { unrelated: { entities: { b: { value: 2 } } } }, vars: {} });
});

test("shared validation enforces typed entities/relationships without imposing an application baseline", () => {
  assert.deepEqual(loadContent(null).content, {});
  assert.deepEqual(loadContent(null, { content: { apps: { unrelated: { custom: [1, null, false] } } } }).content, { apps: { unrelated: { custom: [1, null, false] } } });
  assert.equal(loadContent(null, { content: shared() }).content.conversations.incident.messages[0].text, "Sam owns rollback.");
  const invalid = [
    [{ presentation: { cursor: false } }, /unknown field/],
    [{ cursor: false }, /unknown field/],
    [{ people: [{ name: "Sam" }] }, /expected object/],
    [{ people: { sam: {} } }, /missing required "name"/],
    [{ people: { sam: { name: "Sam", department: "Ops" } } }, /unknown field/],
    [{ people: { "bad.key": { name: "Bad" } } }, /entity keys must be stable/],
    [{ sources: { docs: { name: "Docs" } } }, /missing required "vendor"/],
    [{ documents: { doc: { title: "Doc", source: "missing" } } }, /unknown sources entity/],
    [{ teams: { ops: { name: "Ops", members: ["missing"] } } }, /unknown people entity/],
    [{ teams: { ops: { name: "Ops", members: "wrong" } } }, /allowed forms|expected array/],
    [{ conversations: { one: { messages: [{ role: "user" }] } } }, /missing required "text"/],
    [{ conversations: { one: { messages: [{ role: "user", text: "Hi", person: "missing" }] } } }, /unknown people entity/],
    [{ vars: { count: 1 }, people: { sam: { name: "{{vars.count}}" } } }, /expected string/],
    [{ vars: { wrong: [1] }, people: { sam: { use: "vars.wrong" } } }, /use must reference/],
  ];
  for (const [content, expected] of invalid) assert.throws(() => loadContent(null, { content }), expected);
});

test("world authoring schema supports partial entities/use and resolved schema enforces final types", () => {
  const schema = JSON.parse(fs.readFileSync(new URL("./world.schema.json", import.meta.url), "utf8"));
  const authored = { includes: ["../shared/world.yaml"], people: { sam: { use: "vars.person", title: "Lead" } }, documents: { note: { body_file: "note.txt" } }, teams: { ops: { members: "{{vars.members}}" } } };
  assert.deepEqual(check(schema, authored), []);
  assert.ok(check(schema.$defs.resolved, authored, schema).length > 0);
  const loaded = loadContent(null, { content: shared() });
  assert.deepEqual(check(schema.$defs.resolved, loaded.content, schema), []);
  assert.ok(check(schema, { presentation: { cursor: false } }).length > 0);
});

test("nested content includes retain the original declaring file after generic data composition", (t) => {
  const at = files(t, {
    "container.yaml": "includes: [parts/fragment.yaml]\n",
    "parts/fragment.yaml": "content:\n  includes: [local-world.yaml]\n",
    "parts/local-world.yaml": "vars: {value: from-local-include}\n",
  });
  const loaded = loadData(at("container.yaml"));
  const resolved = loadContent(null, { content: loaded.data.content, file: at("container.yaml"), origins: loaded.origins, inputs: loaded.inputs });
  assert.equal(resolved.content.vars.value, "from-local-include");
  assert.equal(resolved.inputs.length, 3);
});

test("reusing a resolved nested value does not reinterpret its generated literal text", () => {
  const { content } = loadContent(null, { content: { vars: { open: "{{", reply: { text: "{{vars.open}}people.missing.name}}" } } } });
  assert.deepEqual(resolveContent(content.vars.reply, content), { text: "{{people.missing.name}}" });
});
