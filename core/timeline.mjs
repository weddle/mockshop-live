// Clip timeline: a structured record of every step with start/end ms relative to the clip start, plus marks.
// Written next to the MP4 as <script>.timeline.json and <script>.vtt. Also feeds `mockshop live`.
// The runner calls begin()/end()/mark() around each step; everything here is best-effort and never throws into a step.
import fs from "node:fs";
import path from "node:path";

// Step keys that are not the op.
export const META_KEYS = ["only", "at", "cursor", "id", "author_id", "scene", "origin", "presentation", "_presentation"];

// `at:` -> ms. Accepts 12.5 (seconds), "12.5s", "1500ms", "1:02.5" / "00:12.500". null if unparseable.
export function parseAt(v) {
  if (typeof v === "number") return Math.round(v * 1000);
  const s = String(v ?? "").trim();
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)ms$/))) return Math.round(Number(m[1]));
  if ((m = s.match(/^(\d+(?:\.\d+)?)s?$/))) return Math.round(Number(m[1]) * 1000);
  if ((m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/))) return Math.round((Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  return null;
}

// Short human-readable form of a locator spec (the YAML as written, compacted).
export function describeLoc(spec) {
  if (typeof spec === "string") return `text:${JSON.stringify(spec)}`;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  if (spec.testid) return `testid:${spec.testid}`;
  if (spec.role) return `role:${spec.role}${spec.name ? `[${spec.name}]` : ""}`;
  if (spec.placeholder) return `placeholder:${JSON.stringify(spec.placeholder)}`;
  if (spec.label) return `label:${JSON.stringify(spec.label)}`;
  if (spec.selector) return `css:${spec.selector}`;
  if (spec.text) return `text:${JSON.stringify(spec.text)}`;
  return null;
}

const LOCATOR_OPS = new Set(["click", "hover", "move", "fill", "type", "wait", "wait_gone", "scroll"]);
const r1 = (n) => Math.round(n * 10) / 10;
const pad = (n, w = 2) => String(n).padStart(w, "0");
const vttTime = (ms) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.round(ms % 1000), 3)}`;

export class Timeline {
  // now(): ms on the timeline clock (video time in clips, wall time in live). ready(): false until time 0 exists.
  constructor({ script, plugin, source, inputs, scenes, now, ready = () => true }) {
    this.meta = { script, plugin, ...(source ? { source } : {}), ...(inputs ? { inputs } : {}), ...(scenes ? { scenes } : {}) };
    this.now = now; this.ready = ready;
    this.actions = []; this.marks = []; this.cur = null;
  }
  t() { return this.ready() ? Math.max(0, Math.round(this.now())) : 0; }

  async box(page, loc, arg) {
    try {
      const spec = arg && typeof arg === "object" && !Array.isArray(arg) && arg.hover === undefined ? arg : typeof arg === "string" ? arg : null;
      if (!spec) return null;
      const b = await loc(spec).boundingBox({ timeout: 250 });
      return b ? { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) } : null;
    } catch { return null; }
  }

  // Before a step: honour `at:` (wait until that clip time), then record start, target and cursor origin.
  async begin({ i, op, arg, step, page, loc, cursor, presentation }) {
    const at = step.at !== undefined ? parseAt(step.at) : null;
    let late_ms;
    if (at !== null && this.ready()) {
      const wait = at - this.t();
      if (wait > 0) await page.waitForTimeout(wait); else late_ms = -wait;
    }
    const a = { step: i, op, start_ms: this.t(), end_ms: null };
    if (step.id) a.id = step.id;
    if (step.author_id || step.id) a.step_id = step.author_id || step.id;
    if (step.scene) a.scene = step.scene;
    if (step.origin) a.origin = step.origin;
    if (presentation) a.presentation = presentation;
    if (at !== null) { a.at_ms = at; if (late_ms) a.late_ms = late_ms; }
    const target = op === "shot" ? arg?.hover : arg;
    const sel = describeLoc(op === "move" && Array.isArray(arg) ? null : target);
    if (sel && (LOCATOR_OPS.has(op) || op === "shot")) a.selector = sel;
    if (op === "move" && Array.isArray(arg)) a.point = arg;
    if (op === "goto") a.url = arg;
    if (op === "shot") a.name = typeof arg === "string" ? arg : arg.name;
    if (op === "press") a.key = arg;
    if (op === "type" || op === "fill") a.chars = String(arg.value ?? "").length;
    if (op === "card") a.title = typeof arg === "string" ? arg : arg.title;
    if (op === "pause" || (op === "wait" && typeof arg === "number")) a.ms = arg;
    this.loc = null;
    if (sel && LOCATOR_OPS.has(op) || (op === "shot" && arg?.hover)) { this.loc = { loc, spec: target }; a.target_box = await this.box(page, loc, target); }
    if (cursor?.pos) a.cursor = { from: cursor.pos.map(r1) };
    if (step.cursor !== undefined) a.cursor_opts = step.cursor;
    this.cur = { a, page, cursor };
    this.actions.push(a);
  }

  async end(error = null) {
    const c = this.cur; if (!c) return;
    const { a, page, cursor } = c;
    a.end_ms = Math.max(this.t(), a.start_ms);
    a.ok = !error;
    if (error) a.error = String(error.message || error).split("\n")[0];
    if (!a.target_box && this.loc && !error) a.target_box = await this.box(page, this.loc.loc, this.loc.spec);
    if (cursor?.pos && a.cursor) { const to = cursor.pos.map(r1); if (to[0] !== a.cursor.from[0] || to[1] !== a.cursor.from[1]) a.cursor.to = to; else delete a.cursor; }
    this.cur = null;
  }

  mark(arg, step, kind) {
    const m = typeof arg === "string" ? { name: arg } : arg;
    const rec = { name: m.name, ...(m.note ? { note: m.note } : {}), kind, t_ms: this.t(), step };
    if (this.cur) for (const key of ["id", "step_id", "scene", "origin"]) if (this.cur.a[key] !== undefined) rec[key] = this.cur.a[key];
    this.marks.push(rec);
    if (this.cur) this.cur.a.mark = m.name;
    return rec;
  }

  toJSON(extra = {}) {
    return { ...this.meta, ...extra, time_note: "all *_ms are milliseconds from the first frame of the clip (cuts removed)", actions: this.actions, marks: this.marks };
  }

  // Writes <base>.timeline.json and <base>.vtt (cues: one per action, one per mark).
  write(base, extra = {}) {
    const json = this.toJSON(extra);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(`${base}.timeline.json`, JSON.stringify(json, null, 2));
    const cues = [];
    for (const a of this.actions) {
      if (a.end_ms === null || (a.op === "mark" || a.op === "keyframe")) continue;
      const label = [a.op, a.name || a.selector || a.url || a.key || a.title || ""].filter(Boolean).join(" ");
      cues.push([a.start_ms, Math.max(a.end_ms, a.start_ms + 100), label]);
    }
    for (const m of this.marks) cues.push([m.t_ms, m.t_ms + 1000, `[${m.kind}] ${m.name}${m.note ? `: ${m.note}` : ""}`]);
    cues.sort((x, y) => x[0] - y[0]);
    fs.writeFileSync(`${base}.vtt`, "WEBVTT\n\n" + cues.map(([s, e, t], k) => `${k + 1}\n${vttTime(s)} --> ${vttTime(e)}\n${t}\n`).join("\n"));
    return json;
  }
}
