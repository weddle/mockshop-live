// Fixture layering: <fixturesDir>/base/*.yaml, then each overlay dir (later wins).
// Route keys are "METHOD /path" (GET POST PUT PATCH DELETE ANY), with :param and * segments.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const UNIT = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
// Demo anchor: the instant a scenario/recording starts (set by the runner via POST /__mockshop/state).
// {{now}} {{ago:2h}} {{in:3d}} resolve against it, so the UI shows the same relative times ("2 hours ago")
// on every run instead of drifting with wall-clock time while fixtures sit loaded.
// The anchor can be a fixed instant (scenario/manifest `demo_anchor`); the browser clock is shifted to match.
let anchorMs = Date.now(), anchorSetAt = Date.now();
export function setAnchor(t) { const ms = typeof t === "number" ? t : Date.parse(t); anchorMs = Number.isFinite(ms) ? ms : Date.now(); anchorSetAt = Date.now(); return anchorMs; }
export const getAnchor = () => anchorMs;
// "Now" on the demo clock: anchor + real time elapsed since the scenario started (for things created live, e.g. chats).
export const demoNow = () => anchorMs + (Date.now() - anchorSetAt);
export function tmpl(str) {
  return str
    .replace(/\{\{now\}\}/g, () => new Date(anchorMs).toISOString())
    .replace(/\{\{(ago|in):(\d+(?:\.\d+)?)([smhdw])\}\}/g, (_, dir, n, u) =>
      new Date(anchorMs + Number(n) * UNIT[u] * (dir === "ago" ? -1 : 1)).toISOString());
}

export function parseYaml(file) {
  return YAML.parse(tmpl(fs.readFileSync(file, "utf8")), { maxAliasCount: -1, merge: true }) || {};
}

export function compilePattern(pattern) {
  return new RegExp("^" + pattern.split("/").map((seg) =>
    seg === "*" ? ".*" : seg.startsWith(":") ? `(?<${seg.slice(1).replace(/[^\w]/g, "_")}>[^/]+)` : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  ).join("/") + "/?$");
}

// Layer dirs in priority order (highest first), optionally a subdir of each (e.g. "chat").
export function layerDirs(fixturesDir, overlays, sub = "") {
  return ["base", ...overlays].reverse().map((o) => path.join(fixturesDir, o, sub)).filter((d) => fs.existsSync(d));
}

function loadDir(dir) {
  const routes = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(f)) continue;
    const doc = parseYaml(path.join(dir, f));
    for (const [key, val] of Object.entries(doc)) {
      if (key.startsWith("x-") || key.startsWith("_")) continue; // anchors / notes
      const m = key.match(/^(GET|POST|PUT|PATCH|DELETE|ANY)\s+(\S+)$/);
      if (!m) { console.warn(`[mock] bad route key in ${f}: ${key}`); continue; }
      routes.push({ method: m[1], pattern: m[2], rx: compilePattern(m[2]), val, file: path.join(path.basename(dir), f),
        specificity: m[2].split(":").length + (m[2].includes("*") ? 10 : 0) });
    }
  }
  return routes;
}

export class FixtureTable {
  constructor(fixturesDir) { this.dir = fixturesDir; this.overlays = []; this.routes = []; }
  reload(overlays = this.overlays) {
    this.overlays = overlays;
    // Highest layer first; inside a layer, more specific (fewer params, no wildcard) first.
    this.routes = layerDirs(this.dir, overlays).flatMap((d) => loadDir(d).sort((a, b) => a.specificity - b.specificity));
    return this.routes.length;
  }
  find(method, p) {
    for (const r of this.routes) {
      if (r.method !== method && r.method !== "ANY") continue;
      const m = p.match(r.rx);
      if (m) return { route: r, params: m.groups || {} };
    }
    return null;
  }
}

// "{{param:name}}" in fixture bodies -> URL params.
export function substitute(val, params) {
  if (!params || !Object.keys(params).length) return val;
  let s = JSON.stringify(val);
  for (const [k, v] of Object.entries(params)) s = s.split(`{{param:${k}}}`).join(v);
  return JSON.parse(s);
}

export function guessDefault(method, p) {
  if (method !== "GET") return {};
  const last = p.split("/").filter(Boolean).pop() || "";
  return /s$|list|history|all$|statuses$/.test(last) ? [] : {};
}
