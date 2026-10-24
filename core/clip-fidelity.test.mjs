// Clip fidelity: `type` clicks first and scales with length, off-screen clicks scroll smoothly, wheel scrolls are
// pointer-anchored, `upload` drives a real file chooser, and `meta` / `click_ms` reach the timeline.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { typeTotalMs, clipDefaults } from "./clip.mjs";
import { launchBrowser, runScripts, uploadPayloads } from "./runner.mjs";
import { META_KEYS, Timeline } from "./timeline.mjs";
import { check } from "./validate.mjs";

const schema = JSON.parse(fs.readFileSync(new URL("../schema/script.schema.json", import.meta.url), "utf8"));
const step = (value) => check(schema.$defs.step, value, schema);
const clipOptions = (value) => check(schema.$defs.clip, value, schema);

test("type duration scales with length, clamps to 700..3200 ms, and yields to clip_ms and type_cps: null", () => {
  const clip = clipDefaults();
  assert.equal(clip.type_cps, 32);
  assert.equal(typeTotalMs("abc", clip), 700);
  assert.equal(typeTotalMs("x".repeat(64), clip), 2000);
  assert.equal(typeTotalMs("x".repeat(500), clip), 3200);
  assert.equal(typeTotalMs("x".repeat(64), clip, 900), 900);
  assert.equal(typeTotalMs("x".repeat(64), clipDefaults({ type_cps: 16 })), 3200);
  assert.equal(typeTotalMs("abc", clipDefaults({ type_cps: null, type_ms: 1800 })), 1800);
});

test("the schema accepts the new keys and rejects malformed ones", () => {
  assert.deepEqual(step({ type: { selector: "#q", value: "hi", click: false } }), []);
  assert.deepEqual(step({ scroll: { by: 300, at: { selector: "#box" } } }), []);
  assert.deepEqual(step({ scroll: { by: -200 } }), []);
  assert.deepEqual(step({ scroll: 300 }), []);
  assert.deepEqual(step({ upload: { click: { role: "button", name: "Add Files" }, files: [{ name: "a.md", text: "x" }, { path: "fixtures/b.csv" }, { name: "c.csv", path: "fixtures/b.csv" }] } }), []);
  assert.deepEqual(step({ click: "Go", meta: { intent: "open it", lint_allow: ["T03"] } }), []);
  assert.deepEqual(clipOptions({ type_cps: 20 }), []);
  assert.deepEqual(clipOptions({ type_cps: null }), []);
  assert.notDeepEqual(step({ scroll: { at: "x" } }), []);
  assert.notDeepEqual(step({ upload: { click: "Add", files: [{ name: "a.md" }] } }), []);
  assert.notDeepEqual(step({ upload: { click: "Add", files: [{ name: "a.md", text: "x", path: "a.md" }] } }), []);
  assert.notDeepEqual(step({ upload: { files: [{ name: "a.md", text: "x" }] } }), []);
  assert.notDeepEqual(step({ click: "Go", meta: "nope" }), []);
  assert.notDeepEqual(clipOptions({ type_cps: 0 }), []);
});

test("upload files: text becomes an in-memory buffer, path is read relative to the script folder", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-upload-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "fixtures"));
  fs.writeFileSync(path.join(dir, "fixtures", "plan.xlsx"), "sheet");
  const files = uploadPayloads([{ name: "notes.md", text: "# Hi" }, { path: "fixtures/plan.xlsx" }, { name: "renamed.bin", path: "fixtures/plan.xlsx" }], dir);
  assert.deepEqual(files.map((f) => [f.name, f.mimeType, f.buffer.toString()]), [
    ["notes.md", "text/markdown", "# Hi"],
    ["plan.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sheet"],
    ["renamed.bin", "application/octet-stream", "sheet"],
  ]);
  assert.throws(() => uploadPayloads([{ path: "missing.csv" }], dir), /ENOENT/);
});

test("the timeline copies meta, click_ms, scroll by and upload names; meta is never an operation", async () => {
  assert.ok(META_KEYS.includes("meta"));
  let now = 0;
  const page = { async waitForTimeout(ms) { now += ms; } };
  const tl = new Timeline({ script: "s", plugin: "p", now: () => now });
  await tl.begin({ i: 1, op: "click", arg: "Go", step: { id: "go", click: "Go", meta: { intent: "go", lint_allow: ["T03"] } }, page, loc: () => null });
  now += 400; tl.clickAt(); now += 300;
  await tl.end();
  await tl.begin({ i: 2, op: "scroll", arg: { by: 250, at: { selector: "#box" } }, step: { id: "sc" }, page, loc: () => ({ boundingBox: async () => ({ x: 1, y: 2, width: 3, height: 4 }) }) });
  await tl.end();
  await tl.begin({ i: 3, op: "upload", arg: { click: "Add", files: [{ name: "a.md", text: "x" }, { path: "dir/b.csv" }] }, step: { id: "up" }, page, loc: () => null });
  tl.clickAt();
  await tl.end();
  await tl.begin({ i: 4, op: "type", arg: { selector: "#q", value: "abc" }, step: { id: "ty" }, page, loc: () => null });
  await tl.end();
  const [click, scroll, upload, type] = tl.toJSON().actions;
  assert.deepEqual(click.meta, { intent: "go", lint_allow: ["T03"] });
  assert.equal(click.click_ms, 400);
  assert.ok(click.click_ms > click.start_ms && click.click_ms < click.end_ms);
  assert.equal(scroll.by, 250);
  assert.equal(scroll.selector, "css:#box");
  assert.deepEqual(upload.files, ["a.md", "b.csv"]);
  assert.equal(upload.click_ms, 700);
  assert.equal(upload.selector, 'text:"Add"');
  assert.equal(type.meta, undefined);
  assert.equal(type.click_ms, undefined);
});

const PAGE = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;overflow:hidden;font:12px sans-serif}
#side{position:absolute;left:0;top:0;width:100px;height:300px;overflow:auto;background:#eee}#side div{height:1200px}
#main{position:absolute;left:100px;top:0;right:0;bottom:0;overflow:auto}#in{position:relative;height:1600px}
#in *{position:absolute}
</style>
<div id="side"><div>sidebar</div></div>
<div id="main"><div id="in">
  <input id="q" style="left:10px;top:10px;width:120px"><input id="r" style="left:10px;top:40px;width:120px">
  <button id="add" style="left:140px;top:40px">Add Files</button><input id="f" type="file" multiple hidden>
  <div id="box" style="left:10px;top:80px;width:140px;height:90px;overflow:auto;background:#cde"><div style="position:static;height:600px">box</div></div>
  <button id="far" style="left:10px;top:1000px">Far button</button>
</div></div>
<script>
const d = document.body.dataset, $ = (id) => document.getElementById(id);
$("q").addEventListener("mousedown", () => d.down = "q");
$("q").addEventListener("input", () => d.typed = $("q").value);
$("r").addEventListener("input", () => d.typedR = $("r").value);
$("r").addEventListener("mousedown", () => d.downR = "r");
$("add").addEventListener("click", () => $("f").click());
$("f").addEventListener("change", async () => {
  const files = [...$("f").files];
  d.files = files.map((f) => f.name).join("|");
  d.first = (await Promise.all(files.map((f) => f.text()))).map((t) => t.split("\\n")[0]).join("|");
});
$("main").addEventListener("wheel", () => d.wheel = "main");
$("side").addEventListener("wheel", () => d.wheelSide = "side");
$("box").addEventListener("scroll", () => { if ($("box").scrollTop > 0) d.box = "moved"; });
const seen = new Set();
$("main").addEventListener("scroll", () => { if ($("main").scrollTop >= 300) seen.add($("main").scrollTop); });
$("far").addEventListener("click", () => { d.clicked = "1"; d.smooth = seen.size > 4 ? "yes" : "no"; });
</script>`;

async function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-fidelity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain request bodies. */ }
    if (request.url === "/favicon.ico") { response.writeHead(204); return response.end(); }
    if (request.url === "/__mockshop/state") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(request.method === "GET" ? JSON.stringify({ strict_misses: [] }) : "{}");
    }
    response.writeHead(request.url === "/fidelity" ? 200 : 404, { "content-type": "text/html" });
    response.end(request.url === "/fidelity" ? PAGE : "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const before = process.env.MOCKSHOP_URL;
  delete process.env.MOCKSHOP_URL;
  t.after(() => { if (before !== undefined) process.env.MOCKSHOP_URL = before; });
  const m = { name: "probe", dir, fixturesDir: path.join(dir, "fixtures"), outDir: path.join(dir, "out"), ports: { mock: port, web: port }, runner: {} };
  const put = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : YAML.stringify(value));
    return file;
  };
  return { m, dir, put };
}

async function recorderAvailable(t) {
  const missing = ["ffmpeg", "ffprobe"].filter((bin) => spawnSync(bin, ["-version"]).status !== 0);
  if (missing.length) { t.skip(`${missing.join(", ")} not installed`); return false; }
  try { await (await launchBrowser()).close(); }
  catch (error) { if (!error.message.startsWith("no Chrome/Chromium found")) throw error; t.skip(error.message); return false; }
  return true;
}

const att = (selector, timeout = 5000) => ({ wait: { selector, state: "attached", timeout } });
const FILES = [{ name: "notes.md", text: "# Briefing\nbody" }, { path: "fixtures/data.csv" }];
const CLIP = { nav_fade: 0, hold_ms: 100, end_hold_ms: 200, fps: 10, crf: 35, preset: "ultrafast" };

test("clip mode: type clicks first, off-screen clicks scroll smoothly, wheels follow the pointer, upload opens the chooser, timeline carries meta and click_ms", async (t) => {
  if (!(await recorderAvailable(t))) return;
  const { m, put } = await workspace(t);
  put("scripts/fixtures/data.csv", "a,b\n1,2\n");
  const file = put("scripts/fidelity.yaml", { name: "fidelity", viewport: [480, 300], clip: CLIP, steps: [
    { goto: "/fidelity" }, att("#q"),
    { type: { selector: "#q", value: "hello world" }, meta: { intent: "type a query" } },
    att("body[data-down='q']"), att("body[data-typed='hello world']"),
    { type: { selector: "#r", value: "abc", click: false } },
    att("body[data-typed-r='abc']"),
    { upload: { click: { role: "button", name: "Add Files" }, files: FILES }, meta: { intent: "attach files" } },
    att("body[data-files='notes.md|data.csv']"), att("body[data-first='# Briefing|a,b']"),
    { move: [30, 250] },
    { scroll: 40 },
    att("body[data-wheel='main']"), { wait: { selector: "body[data-wheel-side]", state: "detached", timeout: 500 } },
    { move: [30, 250] },
    { scroll: { by: 150, at: { selector: "#box" } } },
    att("body[data-box='moved']"),
    { click: { selector: "#far" }, meta: { intent: "click far button" } },
    att("body[data-clicked='1']"), att("body[data-smooth='yes']"),
  ] });
  assert.equal(await runScripts(m, [file], { clip: true, force: true }), 0);
  const timeline = JSON.parse(fs.readFileSync(path.join(m.outDir, "clips", "fidelity.timeline.json"), "utf8"));
  assert.ok(timeline.actions.every((a) => a.ok), JSON.stringify(timeline.actions.filter((a) => !a.ok)));
  const by = (op, n = 0) => timeline.actions.filter((a) => a.op === op)[n];
  const within = (pos, box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h;

  const typed = by("type", 0);
  assert.ok(typed.cursor?.to, "type moves the pointer");
  assert.ok(within(typed.cursor.to, typed.target_box), "the pointer ends on the field");
  assert.deepEqual(typed.meta, { intent: "type a query" });
  assert.equal(typed.click_ms, undefined);
  assert.equal(typed.chars, 11);
  const silent = by("type", 1);
  assert.equal(silent.cursor, undefined, "click: false leaves the pointer alone");

  const upload = by("upload");
  assert.ok(within(upload.cursor.to, upload.target_box));
  assert.deepEqual(upload.files, ["notes.md", "data.csv"]);
  assert.ok(upload.click_ms >= upload.start_ms && upload.click_ms <= upload.end_ms);
  assert.deepEqual(upload.meta, { intent: "attach files" });

  const [wheel, anchored] = [by("scroll", 0), by("scroll", 1)];
  assert.equal(wheel.by, 40);
  assert.ok(wheel.cursor.to[0] > 100, "a bare wheel scroll glides into the main content, not the sidebar");
  assert.equal(anchored.by, 150);
  assert.equal(anchored.selector, "css:#box");
  assert.ok(within(anchored.cursor.to, anchored.target_box), "the anchored wheel glides to its locator");

  const far = by("click");
  assert.ok(far.target_box.y > 300, "the target started below the fold");
  assert.ok(far.cursor.to[1] > 0 && far.cursor.to[1] < 300, "the pointer clicked on screen, after the page scrolled");
  assert.ok(far.click_ms > far.start_ms && far.click_ms < far.end_ms);
  assert.deepEqual(far.meta, { intent: "click far button" });
});

test("shot mode: type does not click, and upload and anchored scroll work", async (t) => {
  const { m, put } = await workspace(t);
  put("scripts/fixtures/data.csv", "a,b\n1,2\n");
  const file = put("scripts/fidelity-shot.yaml", { name: "fidelity-shot", viewport: [480, 300], steps: [
    { goto: "/fidelity" }, att("#q"),
    { type: { selector: "#q", value: "hello world" } },
    att("body[data-typed='hello world']"),
    { wait: { selector: "body[data-down]", state: "detached", timeout: 500 } },
    { upload: { click: { role: "button", name: "Add Files" }, files: FILES } },
    att("body[data-files='notes.md|data.csv']"), att("body[data-first='# Briefing|a,b']"),
    { scroll: { by: 150, at: { selector: "#box" } } },
    att("body[data-box='moved']"),
    { scroll: 40 },
    att("body[data-wheel='main']"),
  ] });
  assert.equal(await runScripts(m, [file], {}), 0);
});
