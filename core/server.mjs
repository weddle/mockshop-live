// Mockshop mock backend framework. Usage: node core/server.mjs <plugin>
// Order per request: control plane (/__mockshop/*) -> plugin handler routes -> fixtures (+ plugin transforms)
// -> default ([] / {}) logged to logs/<plugin>/mock-misses.log.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadPlugin } from "./plugin.mjs";
import { builtEdition } from "./build.mjs";
import { FixtureTable, compilePattern, demoNow, getAnchor, guessDefault, layerDirs, parseYaml, setAnchor, setPluginVars, substitute, tmpl } from "./fixtures.mjs";
import { isoLocal } from "./time.mjs";
import { resolveLocale, localizeUser } from "./locale.mjs";
import { chunkText, streamNdjson, streamSse } from "./stream.mjs";
import { prepareScript } from "./script.mjs";
import { randomBytes } from "node:crypto";
import { stateTokenFile } from "./state-api.mjs";

const m = loadPlugin(process.argv[2]);
setPluginVars({ "plugin.ref": m.upstream?.ref ?? m.upstream?.commit?.slice(0, 9) });
const PORT = m.ports.mock;
fs.mkdirSync(m.logsDir, { recursive: true });
const MISS_LOG = path.join(m.logsDir, "mock-misses.log");
// Runner-only state API (/__mockshop/state/<collection>[/<key>]): a per-process secret in a file only the runner (same checkout) reads.
// The page reaches the mock through the web server's /api proxy and never learns it, so scripts cannot read or depend on backend state.
const runnerToken = randomBytes(24).toString("hex");
fs.writeFileSync(stateTokenFile(m), runnerToken, { mode: 0o600 });
const table = new FixtureTable(m.fixturesDir);
// Neutral defaults are compiled through the same adapter as selected worlds, below edition/script overlays.
const defaultOverlays = m.default_world ? (await prepareScript(m, null, { script: { steps: [] } })).overlays : [];
const editionOverlays = () => [...defaultOverlays, ...(m.editions?.[builtEdition(m) || m.edition]?.fixtures ? [m.editions[builtEdition(m) || m.edition].fixtures] : [])];
table.overlays = editionOverlays();
const state = {locale:resolveLocale(m).code}; // free-form per-plugin state, reset via POST /__mockshop/state
// Script-scoped policy also covers SSR calls, whose browser headers never reach the mock.
let strict = false;
const strictMisses = [];

function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string";
  res.writeHead(status, { "content-type": isStr ? "text/plain" : "application/json", ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({ _raw: b }); } });
  });
}

// World data files: <overlay>/<name>.json written by the adapter next to the fixture routes (world state flags, entity ID maps).
// Layers merge base first, selected overlays later (objects deep-merge, anything else replaces); cached until the table reloads.
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const mergeData = (a, b) => (isPlain(a) && isPlain(b) ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, k in b ? mergeData(a[k], b[k]) : a[k]])) : b);
let dataFor = null, dataCache = new Map();
function worldData(name) {
  if (dataFor !== table.routes) { dataFor = table.routes; dataCache = new Map(); }
  if (!dataCache.has(name)) {
    let value = {};
    for (const dir of layerDirs(m.fixturesDir, table.overlays).reverse()) {
      const file = path.join(dir, `${name}.json`);
      if (fs.existsSync(file)) value = mergeData(value, JSON.parse(fs.readFileSync(file, "utf8")));
    }
    dataCache.set(name, value);
  }
  return dataCache.get(name);
}

const core = {
  get locale() { return resolveLocale(m,state.locale); },
  plugin: m, state, tmpl, parseYaml, demoNow, chunkText, streamNdjson, streamSse, send,
  layerDirs: (sub) => layerDirs(m.fixturesDir, table.overlays, sub),
  data: worldData,
  fixture: (method, p) => { const hit = table.find(method, p); return hit ? localizeUser(m,core.locale,method,p,substitute(hit.route.val, hit.params)) : undefined; },
  log: (...a) => console.log(`[${m.name}]`, ...a),
};

let plugin = { routes: [], transform: {}, reset() {} };
if (m.handlersFile) {
  const mod = await import(m.handlersFile);
  plugin = { routes: [], transform: {}, reset() {}, ...(await (mod.default || mod.createHandlers)(core)) };
}
const routes = plugin.routes.map((r) => ({ ...r, rx: compilePattern(r.path) }));
const transforms = Object.entries(plugin.transform || {}).map(([k, fn]) => { const [method, p] = k.split(/\s+/); return { method, rx: compilePattern(p), fn }; });

function reload() { console.log(`${isoLocal()} [mock] ${m.name}: loaded ${table.reload()} fixture routes (overlays: ${table.overlays.join(",") || "none"}; demo anchor ${isoLocal(new Date(getAnchor()))})`); }
reload();
// Hot-reload authored fixtures. fixtures/.built holds compiled world outputs (one dir per world hash; it reaches 100k+
// files) and is never edited by hand, so it is not watched: a recursive watch there exhausts the per-user inotify limit
// (ENOSPC) and crashed the mock. A watch error disables hot reload instead of killing the mock.
const onFixtureChange = () => {
  clearTimeout(reload.t);
  reload.t = setTimeout(() => {
    try { reload(); }
    catch (e) { console.error(`[mock] fixture reload failed: ${e.message}`); }
  }, 150);
};
const onWatchError = (e) => console.error(`[mock] fixture hot reload disabled: ${e.message}`);
const watchFixtures = (dir, opts) => { try { fs.watch(dir, opts, onFixtureChange).on("error", onWatchError); } catch (e) { onWatchError(e); } };
watchFixtures(m.fixturesDir, {});
for (const d of fs.readdirSync(m.fixturesDir, { withFileTypes: true })) {
  if (d.isDirectory() && d.name !== ".built") watchFixtures(path.join(m.fixturesDir, d.name), { recursive: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let p = url.pathname.replace(/\/+$/, "") || "/";
  const strip = m.mock?.strip_prefix;
  if (strip && p.startsWith(strip + "/")) p = p.slice(strip.length);
  const method = req.method;
  let bodyP;
  const ctx = { req, res, method, path: p, query: Object.fromEntries(url.searchParams), params: {}, state, core,
    body: () => (bodyP ||= readBody(req)), send: (s, b, h) => send(res, s, b, h) };

  try {
    if (p === "/__mockshop/health") return send(res, 200, { ok: true, plugin: m.name });
    if (p.startsWith("/__mockshop/state/")) {
      if (req.headers["x-mockshop-runner"] !== runnerToken) return send(res, 403, { detail: "the state API is runner-only" });
      if (method !== "GET") return send(res, 405, { detail: "the state API is read-only" });
      if (!plugin.state) return send(404, { detail: `plugin ${m.name} has no state API` });
      const parts = p.slice("/__mockshop/state/".length).split("/").map(decodeURIComponent);
      let value;
      try { value = await plugin.state(parts, ctx); }
      catch (e) { return send(res, e.status || 500, { detail: e.message }); }   // a plugin throws { status: 400 } for an unknown collection
      return value === undefined ? send(res, 404, { detail: `no state at ${parts.join("/")}` }) : send(res, 200, value);
    }
    if (p === "/__mockshop/state") {
      // keep: true (live overlay switch) leaves locale and demo clock alone unless given; plugins see it in reset(b)
      if (method === "POST") {
        const b = await ctx.body();
        if (b.theme != null && b.theme !== "light" && b.theme !== "dark") return send(res, 400, { detail: `theme must be light or dark (got ${JSON.stringify(b.theme)})` });
        if (typeof b.strict === "boolean") { strict = b.strict; strictMisses.length = 0; }
        // Author-selected presentation theme (core.state.theme: undefined | light | dark). A fresh reset without one
        // clears the earlier choice so world fixtures decide; keep: true retains it unless supplied (null clears).
        if (!b.keep || b.theme !== undefined) { if (b.theme) state.theme = b.theme; else delete state.theme; }
        if (!b.keep || b.locale) state.locale = resolveLocale(m, b.locale).code;
        if (!b.keep || b.anchor) setAnchor(b.anchor ?? Date.now());
        if (!b.keep || b.overlays !== undefined) {
          const edition = editionOverlays();
          // GET includes the implicit default/edition prefix. Strip it from a roundtrip payload so
          // the fixture table and plugin retain the caller's overlay namespace.
          if (edition.length && Array.isArray(b.overlays) && edition.every((o, i) => b.overlays[i] === o)) b.overlays = b.overlays.slice(edition.length);
          table.reload([...edition, ...(b.overlays || [])]);
        }
        await plugin.reset?.(b);
      }
      return send(res, 200, { plugin: m.name, locale: state.locale, theme: state.theme ?? null, overlays: table.overlays, demo_anchor: isoLocal(new Date(getAnchor()), { ms: true }), strict, strict_misses: strictMisses });
    }
    for (const r of routes) {
      if (r.method !== method && r.method !== "ANY") continue;
      const mm = p.match(r.rx);
      if (!mm) continue;
      ctx.params = mm.groups || {};
      const handled = await r.handle(ctx);
      if (handled !== false && res.headersSent) return;
    }
    const hit = table.find(method, p);
    if (hit) {
      ctx.params = hit.params;
      let val = substitute(hit.route.val, hit.params);
      for (const t of transforms) if ((t.method === method || t.method === "ANY") && t.rx.test(p)) val = await t.fn(val, ctx);
      val = localizeUser(m,core.locale,method,p,val);
      if (val && typeof val === "object" && "__status" in val) return send(res, val.__status, val.__body ?? {}, val.__headers || {});
      return send(res, 200, val);
    }
    if (strict || req.headers["x-mockshop-strict"] === "true") {
      const detail = `Unmocked endpoint: ${method} ${p}${url.search}`;
      strictMisses.push(detail);
      fs.appendFileSync(MISS_LOG, `${isoLocal()} ${method} ${p}${url.search} -> strict 501\n`);
      return send(res, 501, { detail });
    }
    const def = guessDefault(method, p);
    fs.appendFileSync(MISS_LOG, `${isoLocal()} ${method} ${p}${url.search} -> default ${JSON.stringify(def)}\n`);
    return send(res, 200, def);
  } catch (e) {
    console.error(`${isoLocal()} [mock] ${method} ${p} failed:`, e);
    if (!res.headersSent) send(res, 500, { detail: `mockshop handler error: ${e.message}` });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`${isoLocal()} [mock] ${m.name} mock backend on http://127.0.0.1:${PORT}`));
