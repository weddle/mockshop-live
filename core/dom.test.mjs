import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeDomRecording, buildReplayHtml, replayFile, pointerSvg, inlineStylesheets } from "./dom.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ms-dom-"));
const snap = (t) => ({ type: 2, timestamp: t, data: {} });
const mut = (t) => ({ type: 3, timestamp: t, data: { source: 1 } });
// A recorder after two cuts in scene "one" and one in scene "two", with the trailing open segment holding only a snapshot.
const sample = () => ({
  t0: 1000, scene: "two",
  scenes: [{ id: "one", segment: 0 }, { id: "two", segment: 2 }],
  segments: [
    { name: "submitted", scene: "one", step_id: "ask", events: [snap(1000), mut(1500)] },
    { name: "answer", scene: "one", step_id: "ask", events: [snap(1600), mut(2000)] },
    { name: "opened", scene: "two", step_id: "open", events: [snap(2100), mut(2200), mut(2300)] },
    { name: null, events: [snap(2400)] },
  ],
});

test("each beat is its own segment; scenes list their segments; the empty tail is dropped", () => {
  const out = writeDomRecording(sample(), path.join(tmp(), "a.rrweb.json"), { viewport: [1440, 900], cursor: { fill: "#0B5CFF" }, script: "demo" });
  assert.equal(out.version, 4);
  assert.deepEqual(out.segments.map((g) => [g.name, g.scene, g.events.length]), [["submitted", "one", 2], ["answer", "one", 2], ["opened", "two", 3]]);
  assert.deepEqual(out.chapters.scenes.map((s) => [s.id, s.segments]), [["one", [0, 1]], ["two", [2]]]);
});

test("a cut that lands on another cut leaves no beat", () => {
  const rec = sample(); rec.segments.splice(1, 0, { name: "tool-visible", scene: "one", events: [snap(1550)] });
  const out = writeDomRecording(rec, path.join(tmp(), "e.rrweb.json"), { script: "s" });
  assert.deepEqual(out.segments.map((g) => g.name), ["submitted", "answer", "opened"]);
});

test("a tail with real events after the last cut is kept as the run-out", () => {
  const rec = sample(); rec.segments[3].events.push(mut(2500));
  const out = writeDomRecording(rec, path.join(tmp(), "b.rrweb.json"), { script: "s" });
  assert.equal(out.segments.length, 4); assert.equal(out.segments[3].name, "end"); assert.equal(out.segments[3].scene, "two");
});

test("a run without scene marks gets one scene holding every beat", () => {
  const rec = sample(); rec.scenes = [];
  const out = writeDomRecording(rec, path.join(tmp(), "c.rrweb.json"), { script: "s" });
  assert.deepEqual(out.chapters.scenes.map((s) => [s.id, s.segments]), [["s", [0, 1, 2]]]);
});

test("the replay page is self-contained and cannot be broken by markup in the recording", () => {
  const out = writeDomRecording(sample(), path.join(tmp(), "d.rrweb.json"), { viewport: [800, 600], cursor: { fill: "#123456", size: 40 }, script: "s" });
  out.segments[0].events[0].data.href = "</script><script>alert(1)</script>";
  const html = buildReplayHtml(out, { title: "A <b>title</b>" });
  assert.ok(html.includes("rrweb.Replayer"), "replayer bundle inlined");
  assert.ok(!html.includes("</script><script>alert"), "closing tag escaped inside the data block");
  assert.ok(html.includes("A &lt;b&gt;title&lt;/b&gt;"), "title escaped");
  assert.ok(html.includes('"fill":"#123456"'), "pointer defaults to the clip cursor colour");
  assert.ok(!/src="http/.test(html) && !/href="http/.test(html), "no external resources");
});

test("replayFile reports segments and accepts a chapters file", () => {
  const d = tmp(); const f = path.join(d, "demo.rrweb.json"); const c = path.join(d, "chapters.json");
  writeDomRecording(sample(), f, { viewport: [100, 100], script: "demo" });
  const r = replayFile(f, path.join(d, "demo.replay.html"), { title: "t" });
  assert.equal(r.beats, 3); assert.equal(r.scenes, 2); assert.equal(r.events, 7);
  fs.writeFileSync(c, JSON.stringify({ title: "T", intro: { title: "Opening", text: "hi" }, scenes: [{ id: "one", title: "A", text: "", viewer: null, segments: [0, 1, 2] }] }));
  const r2 = replayFile(f, path.join(d, "o.html"), { chapters: c });
  assert.equal(r2.scenes, 1);
  assert.ok(fs.readFileSync(r2.out, "utf8").includes("Opening"), "narration from the chapters file is on the page");
});

test("stylesheet links in the snapshot and in later adds are inlined from the live server", async () => {
  const link = (href) => ({ type: 2, tagName: "link", attributes: { rel: "stylesheet", href }, childNodes: [] });
  const events = [
    { type: 4, data: { href: "http://127.0.0.1:3310/app" } },
    { type: 2, data: { node: { type: 0, childNodes: [{ type: 2, tagName: "head", attributes: {}, childNodes: [link("/_next/a.css"), { type: 2, tagName: "link", attributes: { rel: "stylesheet", href: "/x.css", _cssText: "already" }, childNodes: [] }] }] } } },
    { type: 3, data: { source: 0, adds: [{ node: link("http://127.0.0.1:3310/_next/b.css") }] } },
  ];
  const seen = [];
  const n = await inlineStylesheets(events, async (u) => { seen.push(u); return u.endsWith("b.css") ? "b{}" : "a{}"; });
  assert.equal(n, 2);
  assert.deepEqual(seen, ["http://127.0.0.1:3310/_next/a.css", "http://127.0.0.1:3310/_next/b.css"]);
  assert.equal(events[1].data.node.childNodes[0].childNodes[0].attributes._cssText, "a{}");
  assert.equal(events[2].data.adds[0].node.attributes._cssText, "b{}");
});

test("pointer svg carries fill and stroke", () => {
  assert.match(pointerSvg({ fill: "#0B5CFF", stroke: "#fff" }), /fill="#0B5CFF" stroke="#fff"/);
});
