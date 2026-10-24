// Authored chat tool steps: web search, open URL and code interpreter replies compile to the native packets,
// replay the same steps on reload, and serve generated files like the backend's fetch_chat_file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compile } from "./adapter.mjs";
import { buildChatStream, replayPackets } from "./chat.mjs";
import { CHAT_FILES_DIR, findChatFile } from "./chat-files.mjs";
import { parseYaml } from "../../core/fixtures.mjs";

const pluginDir = path.dirname(new URL(import.meta.url).pathname);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dd3a2f40000000049454e44ae426082", "hex");
const content = () => ({
  company: { name: "Acme", domain: "acme.example" },
  people: { sam: { name: "Sam Adeyemi", email: "sam@acme.example" } },
  sources: { runbooks: { name: "Engineering Runbooks", vendor: "confluence" } },
  documents: { rollback: { source: "runbooks", title: "Relay rollback", body: "Sam coordinated the rollback.", owners: ["sam"] } },
});
function build(t, reply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-onyx-tools-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixturesDir = path.join(dir, "fixtures");
  fs.cpSync(path.join(pluginDir, "fixtures/base"), path.join(fixturesDir, "base"), { recursive: true });
  fs.writeFileSync(path.join(dir, "chart.png"), PNG);
  const m = { name: "onyx", dir: pluginDir, fixturesDir, ports: { web: 3300, mock: 8800 }, upstream: { ref: "v0.0.0-test" }, edition: "community", editions: {} };
  const outputDir = path.join(fixturesDir, ".built", "script");
  const script = { name: "test", steps: [{ id: "ask", send: { text: "Question?", reply } }], _resolved: { source: path.join(dir, "script.yaml") } };
  compile(content(), { m, script, outputDir });
  const chat = path.join(outputDir, "chat");
  return { outputDir, turn: parseYaml(path.join(chat, fs.readdirSync(chat).find((f) => f.startsWith("turn-")))) };
}
const objs = (packets) => packets.map((p) => p.obj).filter(Boolean);
const live = (script) => [...buildChatStream(script, { user: 1, agent: 2 })].map((e) => e.packet);

const reply = () => ({
  text: "Inspect before frost [1]. Our rollback notes agree [2].\n\n[chart.png](chart.png) and [units.csv](units.csv)",
  web_search: { queries: ["seal inspection winter"], results: [
    { title: "Cold weather pumps", url: "https://pumps.example.com/cold", snippet: "Inspect seals before frost." },
    { title: "Seal checklist", url: "https://www.example.org/checklist", snippet: "Three grades." }] },
  open_url: [{ url: "https://pumps.example.com/cold", title: "Cold weather pumps" }],
  code: { source: "print(1)", output: "1\n", files: [{ name: "chart.png", path: "chart.png" }, { name: "units.csv", rows: [["unit", "note"], ["N1", "worn, replace"]] }] },
  cites: ["https://pumps.example.com/cold", "rollback"],
});

test("web search, open URL and code replies stream the native tool packets in order", (t) => {
  const { turn } = build(t, reply());
  const types = objs(live(turn)).map((o) => o.type);
  const steps = ["search_tool_start", "open_url_start", "tool_call_argument_delta", "python_tool_start", "message_start"].map((type) => types.indexOf(type));
  assert.deepEqual([...steps].sort((a, b) => a - b), steps, types.join(" "));
  const packets = live(turn);
  // Internal search for the cited world document, then web search, open URL and Python, each at its own turn.
  const turns = (type) => packets.filter((p) => p.obj?.type === type).map((p) => p.placement.turn_index);
  assert.deepEqual(turns("search_tool_start"), [0, 1]);
  assert.deepEqual(objs(packets).filter((o) => o.type === "search_tool_start").map((o) => o.is_internet_search), [false, true]);
  assert.deepEqual(turns("open_url_start"), [2]);
  assert.deepEqual(turns("python_tool_start"), [3]);
  const web = objs(packets).filter((o) => o.type === "search_tool_documents_delta")[1].documents;
  assert.deepEqual(web.map((d) => [d.document_id, d.link, d.source_type, d.is_internet, d.blurb]), [
    ["WEB_SEARCH_DOC_https://pumps.example.com/cold", "https://pumps.example.com/cold", "web", true, "Inspect seals before frost."],
    ["WEB_SEARCH_DOC_https://www.example.org/checklist", "https://www.example.org/checklist", "web", true, "Three grades."]]);
  const opened = objs(packets).find((o) => o.type === "open_url_documents").documents[0];
  assert.equal(opened.is_internet, false);
  assert.equal(opened.blurb, "Cold weather pumps");
  const files = objs(packets).find((o) => o.type === "python_tool_delta" && o.file_ids.length).file_ids;
  assert.equal(files.length, 2);
  const text = objs(packets).filter((o) => o.type === "message_delta").map((o) => o.content).join("");
  assert.match(text, /\[\[1\]\]\(https:\/\/pumps\.example\.com\/cold\)/);
  assert.match(text, /\[\[2\]\]\(\/api\/mockshop\/source\//);
  assert.ok(text.includes(`[chart.png](/api/chat/file/${files[0]})`) && text.includes(`[units.csv](/api/chat/file/${files[1]})`));
  const cites = objs(packets).filter((o) => o.type === "citation_info").map((o) => o.document_id);
  assert.deepEqual(cites, ["WEB_SEARCH_DOC_https://pumps.example.com/cold", turn.documents[0].id]);
  const start = objs(packets).find((o) => o.type === "message_start");
  assert.equal(start.final_documents.length, 3);
});

test("replay keeps the code, output and generated files in one delta", (t) => {
  const { turn } = build(t, reply());
  const r = replayPackets(turn);
  const deltas = objs(r.packets).filter((o) => o.type === "python_tool_delta");
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].stdout, "1\n");
  assert.equal(deltas[0].file_ids.length, 2);
  assert.ok(!objs(r.packets).some((o) => o.type === "tool_call_argument_delta"));
  assert.equal(objs(r.packets).find((o) => o.type === "python_tool_start").code, "print(1)");
  assert.equal(r.docs.length, 3);
});

test("generated files are served with the backend's inline or attachment policy", (t) => {
  const { outputDir, turn } = build(t, reply());
  const [png, csv] = turn.code.files.map((f) => findChatFile([path.join(outputDir, CHAT_FILES_DIR)], f.id));
  assert.equal(png.headers["content-type"], "image/png");
  assert.match(png.headers["content-disposition"], /^inline; filename="chart.png"/);
  assert.deepEqual(png.bytes, PNG);
  assert.equal(csv.headers["content-type"], "application/octet-stream");
  assert.match(csv.headers["content-disposition"], /^attachment; filename="units.csv"/);
  assert.equal(csv.bytes.toString(), 'unit,note\nN1,"worn, replace"\n');
  assert.equal(findChatFile([path.join(outputDir, CHAT_FILES_DIR)], "../00-world.yaml"), null);
});

test("the older web_search flag and plain replies keep their packets", (t) => {
  const { turn } = build(t, { text: "Sam handled it. [1]", queries: ["rollback"], cites: ["rollback"], web_search: true });
  const types = objs(live(turn)).map((o) => o.type);
  assert.equal(types.filter((type) => type === "search_tool_start").length, 1);
  assert.equal(objs(live(turn)).find((o) => o.type === "search_tool_start").is_internet_search, true);
  assert.ok(!types.some((type) => /open_url|python|tool_call_argument/.test(type)));
});

test("invalid tool replies fail with fields", (t) => {
  assert.throws(() => build(t, { ...reply(), cites: ["https://unknown.example.com/x"] }), /cites: https:\/\/unknown\.example\.com\/x is not a web_search result or open_url page/);
  assert.throws(() => build(t, { ...reply(), code: { source: "x", files: [{ name: "a.exe", body: "" }] } }), /code\.files\.0\.name: unsupported file type/);
  assert.throws(() => build(t, { ...reply(), code: { source: "x", files: [{ name: "a.csv", body: "a", rows: [] }] } }), /code\.files\.0: declare exactly one of body/);
  assert.throws(() => build(t, { ...reply(), open_url: ["not a url"] }), /open_url\.0: expected an http\(s\) URL/);
});
