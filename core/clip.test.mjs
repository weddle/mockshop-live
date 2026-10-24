import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { clipOutputs, launchBrowser, runFailed, runScript, runScripts } from "./runner.mjs";

const FRAME = "iframe >> internal:control=enter-frame >> ";
const rows = Array.from({ length: 40 }, (_, i) => `<div id="row${i}">Row ${i}</div>`).join("");
const PAGES = {
  "/": `<!doctype html><body style="margin:0"><iframe src="/frame" style="width:300px;height:160px;border:0"></iframe></body>`,
  // A native scroller inside an iframe that starts mid-list; body[data-edge] reports which edge it reached.
  "/frame": `<!doctype html><style>body{margin:0}#list{height:120px;overflow:auto}#list div{height:40px}</style>
<div id="list">${rows}</div><script>
const list = document.getElementById("list");
list.addEventListener("scroll", () => {
  const edge = list.scrollTop === 0 ? "top" : list.scrollTop + list.clientHeight >= list.scrollHeight - 1 ? "bottom" : "";
  if (edge) document.body.dataset.edge = edge; else delete document.body.dataset.edge;
});
list.scrollTop = 343;
</script>`,
  "/noisy": `<!doctype html><p>noisy</p><script>console.error("boom")</script>`,
};
const CLIP = { nav_fade: 0, hold_ms: 100, end_hold_ms: 200, fps: 10, crf: 35, preset: "ultrafast" };

// Isolated plugin (tempdir out/) served by one local page + mock-state server that records every request.
async function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-clip-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hits = [];
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain request bodies. */ }
    hits.push(`${request.method} ${request.url}`);
    if (request.url === "/favicon.ico") { response.writeHead(204); return response.end(); }
    if (request.url === "/__mockshop/state") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(request.method === "GET" ? JSON.stringify({ strict_misses: [] }) : "{}");
    }
    const page = PAGES[request.url];
    response.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    response.end(page ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  setEnv(t, "MOCKSHOP_URL", undefined);
  const m = { name: "probe", dir, fixturesDir: path.join(dir, "fixtures"), outDir: path.join(dir, "out"), ports: { mock: port, web: port }, runner: {} };
  const put = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, YAML.stringify(value));
    return file;
  };
  return { m, hits, put, clips: path.join(m.outDir, "clips") };
}

const script = (name, steps, extra = {}) => ({ name, viewport: [320, 200], scale: 2, clip: CLIP, steps, ...extra });

// Seed a complete previous bundle with distinct bytes per file.
function seed(m, name) {
  const finals = clipOutputs(m, name);
  fs.mkdirSync(path.dirname(finals[0]), { recursive: true });
  const bytes = finals.map((f) => `previous take: ${path.basename(f)}`);
  finals.forEach((f, k) => fs.writeFileSync(f, bytes[k]));
  return { finals, bytes };
}

function setEnv(t, key, value) {
  const before = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
}

async function recorderAvailable(t) {
  const missing = ["ffmpeg", "ffprobe"].filter((bin) => spawnSync(bin, ["-version"]).status !== 0);
  if (missing.length) { t.skip(`${missing.join(", ")} not installed`); return false; }
  try { await (await launchBrowser()).close(); }
  catch (error) { if (!error.message.startsWith("no Chrome/Chromium found")) throw error; t.skip(error.message); return false; }
  return true;
}

const dimensions = (file) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();

test("duplicate final outputs and existing clips refuse the whole batch before any server, browser or recording", async (t) => {
  const { m, hits, put, clips } = await workspace(t);
  put("scripts/world.yaml", { company: { name: "Example" }, vars: { slug: "demo" } });
  const templated = put("scripts/templated.yaml", { name: "{{vars.slug}}", world: "world.yaml", steps: [{ goto: "/" }] });
  const plain = put("scripts/demo.yaml", { steps: [{ goto: "/" }] });
  const other = put("scripts/other.yaml", { name: "other", steps: [{ goto: "/" }] });
  const caseAlias = put("scripts/case-alias.yaml", { name: "Demo", steps: [{ goto: "/" }] });
  for (const opts of [{ clip: true, force: true }, { clip: true }, {}]) {
    await assert.rejects(runScripts(m, [other, templated, plain], opts), /demo[^\n]*written by both [^\n]*templated\.yaml and [^\n]*demo\.yaml/);
    await assert.rejects(runScripts(m, [other, other], opts), /written by both [^\n]*other\.yaml and [^\n]*other\.yaml/);
    await assert.rejects(runScripts(m, [other, plain, caseAlias], opts), /written by both [^\n]*demo\.yaml and [^\n]*case-alias\.yaml/);
  }
  assert.equal(fs.existsSync(m.outDir), false);
  // One existing file of a world-templated name refuses the whole batch without force.
  fs.mkdirSync(clips, { recursive: true });
  fs.writeFileSync(path.join(clips, "demo.vtt"), "previous");
  await assert.rejects(runScripts(m, [other, templated], { clip: true }), /demo\.vtt: exists/);
  assert.deepEqual(fs.readdirSync(clips), ["demo.vtt"]);
  assert.equal(fs.readFileSync(path.join(clips, "demo.vtt"), "utf8"), "previous");
  assert.deepEqual(hits, []);
});

test("a passing forced clip replaces the complete bundle; iframe edges and output dimensions are recorded", async (t) => {
  if (!(await recorderAvailable(t))) return;
  const { m, hits, put, clips } = await workspace(t);
  setEnv(t, "MOCKSHOP_KEEP_FRAMES", "1");
  const file = put("scripts/edges.yaml", script("edges", [
    { goto: "/" },
    { wait: { selector: `${FRAME}#row20`, state: "attached", timeout: 5000 } },
    { scroll: { selector: `${FRAME}#row20`, edge: "top" } },
    { wait: { selector: `${FRAME}body[data-edge='top']`, state: "attached", timeout: 3000 } },
    { scroll: { selector: `${FRAME}#row0`, edge: "bottom" } },
    { wait: { selector: `${FRAME}body[data-edge='bottom']`, state: "attached", timeout: 3000 } },
  ]));
  const { finals, bytes } = seed(m, "edges");
  assert.equal(await runScripts(m, [file], { clip: true, force: true }), 0);
  assert.ok(hits.includes("POST /__mockshop/state"));
  finals.forEach((f, k) => assert.notEqual(fs.readFileSync(f, "utf8"), bytes[k], f));
  const [mp4, reportFile, resolvedFile, timelineFile, vtt] = finals;
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.deepEqual(report.problems, []);
  assert.equal(report.mp4, mp4);
  assert.deepEqual(report.size, [640, 400]);
  assert.equal(dimensions(mp4), "640,400");
  assert.equal(JSON.parse(fs.readFileSync(resolvedFile, "utf8")).name, "edges");
  const timeline = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
  assert.equal(timeline.clip, "edges.mp4");
  assert.deepEqual(timeline.viewport, [320, 200]);
  assert.deepEqual(timeline.actions.filter((a) => a.op === "scroll").map((a) => a.ok), [true, true]);
  assert.match(fs.readFileSync(vtt, "utf8"), /^WEBVTT/);
  // Publishing leaves only the explicitly retained intermediate frames in the owned stage.
  const stages = fs.readdirSync(clips).filter((n) => n.startsWith(".edges-"));
  assert.equal(stages.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(clips, stages[0])), ["frames"]);
});

test("a failed forced clip publishes nothing, keeps every previous output and keeps the failed take apart", async (t) => {
  if (!(await recorderAvailable(t))) return;
  const { m, put, clips } = await workspace(t);
  setEnv(t, "MOCKSHOP_KEEP_FRAMES", undefined);
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const cases = [
    { name: "failing", steps: [{ goto: "/" }, { wait: { selector: "#missing", state: "attached", timeout: 300 } }], problem: /^STEP 2 wait/, still: "FAILED-step2-wait.png" },
    { name: "noisy", steps: [{ goto: "/noisy" }], extra: { strict: true }, problem: /^console: boom/ },
  ];
  for (const c of cases) {
    const file = put(`scripts/${c.name}.yaml`, script(c.name, c.steps, c.extra));
    const { finals, bytes } = seed(m, c.name);
    const r = await runScript(m, file, browser, { clip: true, force: true });
    assert.equal(runFailed(r), true, c.name);
    assert.ok(r.problems.some((p) => c.problem.test(p)), r.problems.join("\n"));
    assert.deepEqual(r.shots, []);
    finals.forEach((f, k) => assert.equal(fs.readFileSync(f, "utf8"), bytes[k], f));
    assert.equal(path.dirname(r.evidence), clips);
    const kept = fs.readdirSync(r.evidence);
    for (const f of finals) assert.ok(kept.includes(path.basename(f)), `${path.basename(f)} kept in ${r.evidence}`);
    assert.equal(kept.includes("frames"), false);
    if (c.still) assert.ok(kept.includes(c.still));
    const report = JSON.parse(fs.readFileSync(path.join(r.evidence, `${c.name}.report.json`), "utf8"));
    assert.equal(report.mp4, path.join(r.evidence, `${c.name}.mp4`));
    assert.deepEqual(report.problems, r.problems);
  }
});

test("a publication rename failure rolls back prior files and links evidence to the unpublished take", async (t) => {
  if (!(await recorderAvailable(t))) return;
  const { m, put, clips } = await workspace(t);
  setEnv(t, "MOCKSHOP_KEEP_FRAMES", undefined);
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const file = put("scripts/rollback.yaml", script("rollback", [{ goto: "/" }]));
  const { finals, bytes } = seed(m, "rollback");
  const rename = fs.renameSync;
  // Fail the second backup move at the filesystem boundary, after the old MP4 has actually moved.
  t.mock.method(fs, "renameSync", (from, to) => {
    if (from === finals[1] && path.basename(path.dirname(to)) === "previous") {
      throw Object.assign(new Error("simulated rename I/O failure"), { code: "EIO" });
    }
    return rename(from, to);
  });
  await assert.rejects(runScript(m, file, browser, { clip: true, force: true }), /publishing failed.*previous output restored.*new take is kept/);
  finals.forEach((artifact, index) => assert.equal(fs.readFileSync(artifact, "utf8"), bytes[index]));
  const stages = fs.readdirSync(clips).filter(name => name.startsWith(".rollback-"));
  assert.equal(stages.length, 1);
  const stage = path.join(clips, stages[0]);
  const report = JSON.parse(fs.readFileSync(path.join(stage, "rollback.report.json"), "utf8"));
  assert.equal(report.mp4, path.join(stage, "rollback.mp4"));
  assert.equal(dimensions(report.mp4), "640,400");
});
