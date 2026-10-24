import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { worldIdentities, lintIdentityLiterals } from "./fixture-content.mjs";
import { validateScriptFile } from "../core/validate.mjs";

function plugin(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-identities-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, data) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, YAML.stringify(data)); return f; };
  put("worlds/a/world.yaml", { company: { name: "Alpha Org", domain: "alpha.test" }, people: { owner: { name: "Ada Stone", email: "ada@{{company.domain}}" } },
    apps: { example: { agents: { helper: { name: "Planning Helper" } }, replies: { planning: { question: "What is next?" } } } } });
  put("worlds/b/world.yaml", { company: { name: "Beta" }, people: { owner: { name: "Sam" } }, sources: { kb: { name: "Knowledge Base", vendor: "file" } },
    documents: { notes: { source: "kb", title: "Relay review" } } });
  fs.writeFileSync(path.join(dir, "adapter.mjs"), `import path from "node:path";
export async function compile(content, { m, outputDir }) { return { overlays: [path.relative(m.fixturesDir, outputDir)] }; }
`);
  return { m: { name: "example", dir, fixturesDir: path.join(dir, "fixtures"), outDir: path.join(dir, "out"), runner: {} }, put };
}

test("identities come from every world, resolved; refs and longer words are not hits", (t) => {
  const { m } = plugin(t);
  const ids = worldIdentities(m);
  assert.deepEqual(ids.get("ada@alpha.test"), ["a: people.owner.email"], "templated values are resolved");
  for (const k of ["Alpha Org", "Ada Stone", "Planning Helper", "What is next?", "Beta", "Sam", "Relay review"]) assert.ok(ids.has(k), k);
  const text = [
    "title: Ask {{people.owner.name}} at {{company.name}}",   // refs only
    "  - wait: { text: Planning Helper }",                     // literal agent name (world a)
    "  - type: { value: Sample text }",                        // "Sam" inside a longer word
    "  - wait: { text: \"Relay review by Sam\" }",             // two identities of world b
  ].join("\n");
  assert.deepEqual(lintIdentityLiterals(text, ids).map((h) => [h.line, h.literal]), [[2, "Planning Helper"], [4, "Relay review"], [4, "Sam"]]);
});

test("validate fails a world-swappable script with a literal identity, and ignores scripts that pin a world", async (t) => {
  const { m, put } = plugin(t);
  const swappable = put("scripts/demo.yaml", { steps: [{ goto: "/app" }, { wait: { text: "Ada Stone" } }] });
  const r = await validateScriptFile(swappable, m);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /literal "Ada Stone" is world content \(a: people\.owner\.name\)/);
  const clean = put("scripts/clean.yaml", { steps: [{ goto: "/app" }, { wait: { text: "{{people.owner.name}}" } }] });
  process.env.MOCKSHOP_WORLD = path.join(m.dir, "worlds/a/world.yaml");
  t.after(() => delete process.env.MOCKSHOP_WORLD);
  assert.equal((await validateScriptFile(clean, m)).ok, true);
  const pinned = put("scripts/pinned.yaml", { world: "../worlds/b/world.yaml", steps: [{ goto: "/app" }, { wait: { text: "Sam" } }] });
  assert.equal((await validateScriptFile(pinned, m)).ok, true, "a script that pins its world is not swapped");
});
