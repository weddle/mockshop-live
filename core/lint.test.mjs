import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lintText, lintFiles, worldNames, scriptPaths, isWorldDriven } from "./lint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = (text, names = []) => lintText(text, names).violations.map((v) => `${v.line}:${v.rule}`);

test("a clean world-driven script has no findings", () => {
  const text = [
    "name: clean",
    "title: Ask {{agents.helper.name}} about {{documents.plan.title}}",
    "steps:",
    "  - goto: /app/agent/{{agents.helper.id}}",
    "  - type: { selector: '#chat', value: '{{replies.status.ask}}' }",
    "  - assert_state: { entity: agents.helper, field: is_listed, equals: true }",
    "  - shot: done",
  ].join("\n");
  assert.deepEqual(rules(text, ["Planning Notes Draft"]), []);
});

test("each rule fires on the line that breaks it", () => {
  const text = [
    "name: dirty",                                        // 1
    "title: Read the Planning Notes Draft",               // 2 S1
    "steps:",                                             // 3
    "  - type: { value: ada@alpha.test }",                // 4 S2
    "  - click: '[data-testid=agent-row-actions-12]'",    // 5 S3
    "  - eval: |",                                        // 6
    "      const r = await fetch('/api/persona');",       // 7 S4
    "      sessionStorage.setItem('x', '1');",            // 8 S5
    "  - goto: /mockshop/billing/expired",                // 9 S6
    "  - wait: { text: v1.2.3 }",                         // 10 S8
    "  # a comment may say anything: v9.9.9 /mockshop/x", // 11 ignored
  ].join("\n");
  assert.deepEqual(rules(text, ["Planning Notes Draft"]), ["2:S1", "4:S2", "5:S3", "7:S4", "8:S5", "9:S6", "10:S8"]);
});

test("content may only include worlds; inline data is S7", () => {
  const ok = "content:\n  includes:\n    - ../worlds/a.yaml\nsteps: []\n";
  assert.deepEqual(rules(ok), []);
  assert.deepEqual(rules("content:\n  people:\n    a: {name: A}\nsteps: []\n"), ["2:S7"]);
});

test("template text is ignored and the product support address is exempt", () => {
  assert.deepEqual(rules("title: '{{people.owner.email}} support@onyx.app'"), []);
});

test("an S1 pragma with a reason allowlists UI copy; other pragmas are S0", () => {
  const ok = lintText("title: Planning Notes Draft # lint-allow S1: fixed UI heading copy", ["Planning Notes Draft"]);
  assert.equal(ok.violations.length, 0);
  assert.equal(ok.allowed.length, 1);
  assert.deepEqual(rules("title: x # lint-allow S3: some reason here"), ["1:S0"]);
  assert.deepEqual(rules("title: Planning Notes Draft # lint-allow S1: short", ["Planning Notes Draft"]), ["1:S0", "1:S1"]);
  assert.deepEqual(rules("title: nothing here # lint-allow S1: not used anywhere"), ["1:S0"]);
});

test("world names come from shared worlds and lintFiles summarizes per file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-lint-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "worlds/w"), { recursive: true });
  fs.writeFileSync(path.join(dir, "worlds/w/world.yaml"), "people:\n  a: {name: Avery Example}\napps:\n  demo:\n    agents:\n      helper: {name: Helpful Agent}\n");
  assert.deepEqual(worldNames(dir), ["Avery Example", "Helpful Agent"]);
  const f = path.join(dir, "s.yaml");
  fs.writeFileSync(f, "name: s\ntitle: Ask Helpful Agent\n");
  const r = lintFiles([f], { root: dir });
  assert.equal(r.violations, 1);
  assert.equal(r.clean, 0);
  assert.equal(r.perFile[0].file, "s.yaml");
  assert.deepEqual(r.byRule, { "S1 literal-entity": 1 });
});

test("the shipped world-driven scripts are lint-clean", () => {
  const files = scriptPaths(ROOT).filter(isWorldDriven);
  assert.ok(files.length > 0);
  const r = lintFiles(files, { root: ROOT });
  assert.equal(r.violations, 0, r.perFile.flatMap((p) => p.violations.map((v) => `${p.file}:${v.line} ${v.rule} ${v.message}`)).join("\n"));
});

test("./mockshop lint exits 0 when clean, 1 on findings, 2 on a missing file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-lint-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, "bad.yaml");
  fs.writeFileSync(bad, "name: bad\nsteps:\n  - goto: /mockshop/billing/expired\n");
  const run = (...args) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, "core/cli.mjs"), "lint", ...args], { encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  assert.equal(run().code, 0);
  const r = run(bad);
  assert.equal(r.code, 1);
  assert.match(r.out, /bad\.yaml:3: S6 mockshop-route/);
  assert.equal(run(path.join(dir, "missing.yaml")).code, 2);
  assert.equal(JSON.parse(run("--json", "-", bad).out).violations, 1);
});
