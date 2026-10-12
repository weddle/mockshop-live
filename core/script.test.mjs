import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { prepareScript } from "./script.mjs";
import { stepPresentation } from "./presentation.mjs";

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-script-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const m = { name: "example", dir, fixturesDir: path.join(dir, "fixtures"), outDir: path.join(dir, "out"), runner: {} };
  const put = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : YAML.stringify(value));
    return file;
  };
  put("adapter.mjs", `import fs from "node:fs";
import path from "node:path";
export async function compile(content, { m, script, outputDir }) {
  fs.writeFileSync(path.join(outputDir, "catalog.json"), JSON.stringify(content));
  const steps = script.steps.flatMap(({ send, ...step }) => send ? [
    { ...step, id: step.id + "-arm", state: { turn: step.id } },
    { ...step, id: step.id + "-type", type: { selector: "#chat", value: send.text } },
    { ...step, id: step.id + "-submit", press: "Enter" }
  ] : step.state?.sidebar !== undefined ? [{ ...step, state: { screen: { sidebar: step.state.sidebar } } }] : [step]);
  fs.writeFileSync(path.join(outputDir, "replies.json"), JSON.stringify(script.steps.filter(s => s.send).map(s => ({ turn: s.id, ...s.send }))));
  return { overlays: [path.relative(m.fixturesDir, outputDir)], steps };
}
`);
  return { dir, m, put };
}

const scene = (steps, extra = {}) => ({ id: "investigate", ...extra, steps });

test("world composition, structured defaults, exact exchanges and source identities reach a real compiler", async (t) => {
  const { m, put } = workspace(t);
  const world = put("world.yaml", {
    company: { name: "Example", domain: "example.test" },
    people: { sam: { name: "Sam Adeyemi" } },
    sources: { runbooks: { name: "Runbooks", vendor: "confluence" } },
    documents: { rollback: { source: "runbooks", title: "Rollback", body: "Ask {{people.sam.name}}." } },
    apps: { example: { replies: { summary: { queries: ["rollback owner"], cites: ["rollback"], text: "{{people.sam.name}} owns rollback." } } } },
  });
  const file = put("script.yaml", {
    plugin: "example", world: "world.yaml", overlays: ["old-fictional-layer"],
    content: { people: { sam: { name: "Sam Okafor" } } },
    scenes: [scene([
      { id: "first-question", send: { text: "Who owns rollback?", reply: { use: "apps.example.replies.summary" } } },
      { id: "second-question", send: { text: "Who owns rollback?", reply: { queries: ["different query"], cites: ["rollback"], text: "An intentionally different answer." } } },
      { id: "inspect", click: { text: "{{people.sam.name}}" } },
    ])],
  });
  const sc = await prepareScript(m, file);
  assert.equal(sc._resolved.content.people.sam.name, "Sam Okafor");
  assert.equal(sc._resolved.content.documents.rollback.body, "Ask Sam Okafor.");
  assert.equal(YAML.parse(fs.readFileSync(world, "utf8")).people.sam.name, "Sam Adeyemi");
  assert.equal(sc.overlays.length, 1);
  assert.match(sc.overlays[0], /^\.built[/\\][a-f0-9]+$/);
  assert.equal(sc.steps.length, 7);
  assert.equal(sc.steps[0].state.turn, "first-question");
  assert.equal(sc.steps[0].author_id, "first-question");
  assert.equal(sc.steps[1].scene, "investigate");
  assert.equal(sc.steps[1].origin.file, fs.realpathSync(file));
  assert.equal(sc.steps[1].origin.field, "scenes.0.steps.0");
  assert.ok(sc.steps[1].origin.line > 1);
  assert.equal(sc.steps.at(-1).click.text, "Sam Okafor");
  const compiled = path.join(m.fixturesDir, sc.overlays[0]);
  const replies = JSON.parse(fs.readFileSync(path.join(compiled, "replies.json"), "utf8"));
  assert.equal(replies[0].reply.text, "Sam Okafor owns rollback.");
  assert.deepEqual(replies[0].reply.queries, ["rollback owner"]);
  assert.equal(replies[1].reply.text, "An intentionally different answer.");
  assert.notEqual(replies[0].turn, replies[1].turn);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(compiled, "resolved.json"), "utf8"))._resolved.content, sc._resolved.content);
  assert.ok(sc._resolved.inputs.some((input) => input.file === fs.realpathSync(world) && /^[a-f0-9]{64}$/.test(input.hash)));
  assert.ok(sc._resolved.inputs.some((input) => input.file.endsWith("adapter.mjs")));
  fs.writeFileSync(path.join(compiled, "obsolete.json"), "{}");
  const repeated = await prepareScript(m, file);
  assert.deepEqual(repeated.overlays, sc.overlays);
  assert.equal(fs.existsSync(path.join(compiled, "obsolete.json")), false, "every compilation replaces its complete generated snapshot");
});

test("a CLI profile replaces selection without changing content, while narrow presentation scopes revert", async (t) => {
  const { m, put } = workspace(t);
  put("world.yaml", { vars: { question: "Who owns rollback?" } });
  const blue = put("profiles/blue.yaml", { cursor: { style: "signature_arc", look: { fill: "#0B5CFF", size: 36 } }, clip: { hold_ms: 1800 } });
  const quiet = put("profiles/quiet.yaml", { cursor: { style: "straight", look: { fill: "#222222" } }, clip: { hold_ms: 900 } });
  const file = put("script.yaml", {
    world: "world.yaml", profile: "profiles/blue.yaml",
    presentation: { cursor: { look: { size: 40 } } },
    scenes: [
      scene([{ id: "red", presentation: { cursor: { look: { fill: "#ff0000" } }, clip: { hold_ms: 300 } }, shot: "red" }, { id: "blue", shot: "blue" }]),
      { id: "admin", presentation: { cursor: false }, steps: [{ id: "hidden", presentation: { cursor: { look: { fill: "#00ff00" } } }, shot: "hidden" }] },
      { id: "return", steps: [{ id: "restored", shot: "restored" }] },
    ],
  });
  const original = await prepareScript(m, file);
  const replacement = await prepareScript(m, file, { profile: quiet });
  assert.deepEqual(original._resolved.content, replacement._resolved.content);
  assert.equal(original._resolved.profile, blue);
  assert.equal(replacement._resolved.profile, quiet);
  assert.equal(replacement.cursor.look.fill, "#222222");
  assert.equal(replacement.cursor.look.size, 40);
  assert.equal(replacement.cursor.look.size === 36, false, "the unselected blue profile contributes nothing");
  const settings = original.steps.map((step) => stepPresentation(original, step));
  assert.equal(settings[0].cursor.look.fill, "#ff0000");
  assert.equal(settings[0].clip.hold_ms, 300);
  assert.equal(settings[1].cursor.look.fill, "#0B5CFF");
  assert.equal(settings[1].clip.hold_ms, 1800);
  assert.equal(settings[2].cursor.enabled, false);
  assert.equal(settings[2].cursor.look.fill, "#00ff00");
  assert.equal(settings[3].cursor.enabled, true);
  assert.equal(settings[3].cursor.look.fill, "#0B5CFF");
  const overrides = put("restyle.yaml", { presentation: { cursor: true }, steps: { red: { cursor: { style: "straight", look: { fill: "#abcdef" } } } } });
  const external = await prepareScript(m, file, { renderOverrides: overrides });
  assert.equal(stepPresentation(external, external.steps[0]).cursor.look.fill, "#abcdef");
  assert.equal(stepPresentation(external, external.steps[0]).cursor.style, "straight");
  assert.equal(stepPresentation(external, external.steps[2]).cursor.enabled, false, "a broad override cannot unhide a narrow hidden scene");
  const reveal = put("reveal.yaml", { scenes: { admin: { cursor: { enabled: true } } } });
  const revealed = await prepareScript(m, file, { renderOverrides: reveal });
  assert.equal(stepPresentation(revealed, revealed.steps[2]).cursor.enabled, true);
  assert.equal(stepPresentation(revealed, revealed.steps[2]).cursor.look.size, 40);
});

test("manual scripts preserve exact values and stable automatic identities", async (t) => {
  const { m, put } = workspace(t);
  const actions = [
    { cursor: false },
    { move: { to: [937, 411], hold: 483, cursor: { ms: 720 } } },
    { pause: 725 },
    { wait: 123 },
    { press: "Control+Shift+K" },
    { type: { selector: "textarea", value: "literal {{not.a.reference}}", clip_ms: 4321 } },
    { eval: "window.customDirection(17)" },
    { state: { overlays: ["manual-layer"] } },
  ];
  const file = put("manual.yaml", { cursor: { look: { fill: "#345678" } }, steps: actions });
  const sc = await prepareScript(m, file);
  const strip = ({ id, author_id, scene, origin, _presentation, ...step }) => step;
  assert.deepEqual(sc.steps.map(strip), actions);
  assert.equal(sc.overlays, undefined);
  assert.equal(sc._resolved.outputDir, undefined);
  const inserted = await prepareScript(m, file, { script: { steps: [{ goto: "/app" }, ...actions] } });
  assert.deepEqual(inserted.steps.slice(1).map((step) => step.id), sc.steps.map((step) => step.id));
  const { mergeCursor } = await import("./cursor.mjs");
  const hidden = mergeCursor(sc.cursor, false);
  assert.equal(stepPresentation(sc, sc.steps[1], hidden).cursor.enabled, false);
  const visible = mergeCursor(hidden, true);
  assert.equal(stepPresentation(sc, sc.steps[1], visible).cursor.look.fill, "#345678");
});

test("invalid IDs, unsupported operations and presentation targets fail with author diagnostics", async (t) => {
  const { m, put } = workspace(t);
  const cases = [
    [{ scenes: [scene([{ id: "duplicate", wait: 1 }, { id: "duplicate", wait: 2 }])] }, /duplicate step ID/],
    [{ scenes: [scene([]), scene([])] }, /duplicate scene ID/],
    [{ scenes: [scene([{ wait: 1 }])] }, /missing required "id"/],
    [{ scenes: [scene([{ id: "two", wait: 1, press: "Enter" }])] }, /exactly one op/],
    [{ scenes: [scene([{ id: "bad-time", wait: 1, at: "later" }])] }, /timestamp/],
    [{ scenes: [scene([{ id: "frame", presentation: { viewport: [800, 600] }, wait: 1 }])] }, /unknown field "viewport"/],
    [{ steps: [{ state: { agent: null } }] }, /did not compile/],
    [{ steps: [], plugin: "wrong" }, /selected plugin/],
    [{ scenes: [], steps: [] }, /exactly one/],
  ];
  for (const [index, [value, match]] of cases.entries()) {
    const file = put(`invalid-${index}.yaml`, value);
    await assert.rejects(prepareScript(m, file), (error) => error.message.includes(file) && match.test(error.message));
  }
  const file = put("targets.yaml", { scenes: [scene([{ id: "show", shot: "show" }])] });
  const overrides = put("bad-override.yaml", { steps: { missing: { cursor: false } } });
  await assert.rejects(prepareScript(m, file, { renderOverrides: overrides }), (error) => error.message.includes(`${overrides}:`) && /unknown step ID "missing"/.test(error.message));
  const profile = put("bad-profile.yaml", { world: "world.yaml", cursor: true });
  await assert.rejects(prepareScript(m, file, { profile }), /unknown field "world"/);
  put("extra.yaml", { steps: [{ wait: 1 }] });
  const inheritance = put("inheritance.yaml", { includes: ["extra.yaml"] });
  await assert.rejects(prepareScript(m, inheritance), /includes/);
});

test("content-only scripts and live raw objects share the same preparation path", async (t) => {
  const { m, put } = workspace(t);
  const file = put("inline.yaml", { content: { vars: { label: "Inline label" } }, scenes: [scene([{ id: "inline", click: "{{vars.label}}" }])] });
  const sc = await prepareScript(m, file);
  assert.equal(sc.steps[0].click, "Inline label");
  const raw = { name: "live", continue_on_error: true };
  const live = await prepareScript(m, null, { script: raw, steps: [] });
  assert.deepEqual(live.steps, []);
  assert.equal(live._resolved.source, "<live>");
  assert.deepEqual(raw, { name: "live", continue_on_error: true });
});

test("literal high-level scripts compile without an ambient world or template interpretation", async (t) => {
  const { dir, m, put } = workspace(t);
  const file = put("literal.yaml", {
    scenes: [scene([
      { id: "literal-question", send: { text: "Show literal {{untouched.question}}", reply: { text: "Keep literal {{untouched.answer}}" } } },
      { id: "manual-literal", type: { selector: "#manual", value: "{{untouched.manual}}" } },
    ])],
  });
  const compiled = await prepareScript(m, file);
  assert.deepEqual(compiled._resolved.content, {});
  assert.ok(compiled._resolved.outputDir);
  assert.equal(compiled.steps[0].state.turn, "literal-question");
  assert.equal(compiled.steps[1].type.value, "Show literal {{untouched.question}}");
  assert.equal(compiled.steps.at(-1).type.value, "{{untouched.manual}}");
  const replies = JSON.parse(fs.readFileSync(path.join(compiled._resolved.outputDir, "replies.json"), "utf8"));
  assert.equal(replies[0].reply.text, "Keep literal {{untouched.answer}}");
  const stateFile = put("literal-state.yaml", { scenes: [scene([{ id: "empty-sidebar", state: { sidebar: [] } }])] });
  const state = await prepareScript(m, stateFile);
  assert.ok(state._resolved.outputDir, "high-level state also activates the adapter without a send or world");
  assert.deepEqual(state.steps[0].state, { screen: { sidebar: [] } });
  await assert.rejects(prepareScript({ ...m, dir: path.join(dir, "without-adapter") }, file), /no adapter.mjs.*high-level operations/);
});
