// Mockshop script/manifest validation: a tiny JSON Schema (subset) checker + plugin-aware checks.
// Used by `./mockshop validate` and by `./mockshop live` (to validate exported YAML).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ROOT } from "./plugin.mjs";

const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "schema", f), "utf8"));
export const scriptSchema = () => load("script.schema.json");
export const pluginSchema = () => load("plugin.schema.json");

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => (t === "number" ? typeof v === "number" : t === "integer" ? Number.isInteger(v) : typeOf(v) === t);

// Supports: $ref (#/$defs/x), type, enum, const, properties, required, additionalProperties, items, minItems,
// maxItems, minimum, maximum, minLength, pattern, oneOf, anyOf, allOf. Returns [{path, message}].
export function check(schema, value, root = schema, at = "") {
  const errs = [];
  const err = (message, p = at) => errs.push({ path: p || "(root)", message });
  if (schema.$ref) {
    const target = schema.$ref.slice(2).split("/").reduce((o, k) => o?.[k], root);
    errs.push(...check(target, value, root, at));
  }
  if (schema.type && !([].concat(schema.type)).some((t) => isType(value, t))) { err(`expected ${[].concat(schema.type).join(" or ")}, got ${typeOf(value)}`); return errs; }
  if (schema.enum && !schema.enum.includes(value)) err(`must be one of ${schema.enum.join(", ")} (got ${JSON.stringify(value)})`);
  if (schema.const !== undefined && value !== schema.const) err(`must be ${JSON.stringify(schema.const)}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) err(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) err(`must be <= ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) err("must not be empty");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) err(`must match /${schema.pattern}/ (got ${JSON.stringify(value)})`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) err(`needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`needs at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...check(schema.items, v, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) err(`needs at most ${schema.maxProperties} keys`);
    for (const k of schema.required || []) if (!(k in value)) err(`missing required "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const p = at ? `${at}.${k}` : k;
      if (props[k]) errs.push(...check(props[k], v, root, p));
      else if (schema.additionalProperties === false) err(`unknown field "${k}"${closest(k, Object.keys(props))}`, p);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errs.push(...check(schema.additionalProperties, v, root, p));
    }
  }
  for (const s of schema.allOf || []) errs.push(...check(s, value, root, at));
  if (schema.anyOf && !schema.anyOf.some((s) => !check(s, value, root, at).length)) {
    const keys = schema.anyOf.flatMap((s) => s.required || []);
    err(keys.length ? `needs one of: ${keys.join(", ")}` : "matches none of the allowed forms");
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => check(s, value, root, at));
    const ok = results.filter((r) => !r.length).length;
    if (ok !== 1) {
      if (schema.oneOf.every((s) => s.required?.length === 1)) {
        const keys = schema.oneOf.map((s) => s.required[0]);
        const have = keys.filter((k) => k in value);
        err(have.length ? `exactly one op allowed, found: ${have.join(", ")}` : `needs one op of: ${keys.join(", ")}`);
      } else if (ok > 1) err("matches more than one allowed form");
      else { // report the branch that came closest
        const typed = results.filter((r) => !(r[0]?.message.startsWith("expected") && r[0].path === (at || "(root)")));
        const best = (typed.length ? typed : results).reduce((a, b) => (b.length < a.length ? b : a));
        errs.push(...(results.length === 2 || best.length <= 2 ? best : [{ path: at || "(root)", message: "matches none of the allowed forms" }]));
      }
    }
  }
  return errs;
}

function closest(k, keys) {
  const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  const best = keys.map((x) => [x, d(k, x)]).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 2 ? ` (did you mean "${best[0]}"?)` : "";
}

// Built Next pages plus explicitly declared aliases backed by original physical destinations.
function webRoutes(m, errors = []) {
  let aliases = m.route_aliases ?? [];
  if (m.route_aliases !== undefined) {
    const schema = pluginSchema();
    const invalid = check(schema.properties.route_aliases, m.route_aliases, schema, "route_aliases");
    errors.push(...invalid);
    if (invalid.length) aliases = [];
  }
  const f = m.runtimeDir && path.join(m.runtimeDir, ".next", "server", "app-paths-manifest.json");
  if (!f || !fs.existsSync(f)) {
    if (aliases.length) errors.push({ path: "route_aliases", message: "aliases require a built physical web route table" });
    return null;
  }
  const physical = Object.keys(JSON.parse(fs.readFileSync(f, "utf8"))).filter((k) => k.endsWith("/page"))
    .map((k) => "/" + k.slice(0, -5).split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).join("/"));
  const pages = new Set(physical);
  for (const [i, alias] of aliases.entries()) {
    const source = alias.source.replace(/\/+$/, ""), destination = alias.destination.replace(/\/+$/, "");
    let matched = false;
    for (const p of physical) {
      if (p !== destination && !p.startsWith(`${destination}/`)) continue;
      matched = true;
      pages.add((source + p.slice(destination.length)).replace(/\/+$/, "") || "/");
    }
    if (!matched) errors.push({ path: `route_aliases[${i}].destination`, message: `"${alias.destination}" has no physical page target in the built ${m.name} runtime` });
  }
  return [...pages].map((p) => {
    const segs = p.split("/").filter(Boolean);
    const body = segs.map((s) => (/^\[\[\.\.\./.test(s) ? "(?:/.*)?" : /^\[\.\.\./.test(s) ? "/.+" : /^\[/.test(s) ? "/[^/]+" : "/" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
    return new RegExp(`^${body || ""}/?$`);
  });
}

// Plugin-aware checks: overlays exist, requires names an edition, goto paths are real web routes.
function pluginChecks(m, sc) {
  const warns = [], errs = [];
  for (const o of [...(sc.overlays || []), ...(sc.steps || []).flatMap((s) => s?.state?.overlays || [])]) if (!fs.existsSync(path.join(m.fixturesDir, o))) errs.push({ path: "overlays", message: `no fixture overlay dir "${o}" in ${path.relative(ROOT, m.fixturesDir)}/` });
  if (sc.requires && m.editions) for (const r of [].concat(sc.requires)) if (!(r in m.editions)) errs.push({ path: "requires", message: `unknown edition "${r}" (have: ${Object.keys(m.editions).join(", ")})` });
  const routes = webRoutes(m, errs);
  const seen = new Set();
  (sc.steps || []).forEach((s, i) => {
    if (typeof s?.goto === "string") {
      const p = s.goto.split(/[?#]/)[0] || "/";
      if (routes && !routes.some((r) => r.test(p))) errs.push({ path: `steps[${i}].goto`, message: `"${s.goto}" is not a page route of the built ${m.name} runtime` });
    }
    const n = typeof s?.shot === "string" ? s.shot : s?.shot?.name;
    if (n) { if (seen.has(n)) warns.push({ path: `steps[${i}].shot`, message: `duplicate shot name "${n}"` }); seen.add(n); }
  });
  if (!routes && (sc.steps || []).some((s) => s?.goto)) warns.push({ path: "steps", message: `goto paths not checked (${m.name} has no built web route table)` });
  return { errs, warns };
}

// Validate script text/object. m = loaded plugin (optional). Returns { ok, errors[], warnings[] }.
export function validateScript(input, m = null) {
  let sc = input;
  if (typeof input === "string") {
    try { sc = YAML.parse(input); } catch (e) { return { ok: false, errors: [{ path: "(yaml)", message: e.message.split("\n")[0] }], warnings: [] }; }
  }
  const errors = check(scriptSchema(), sc), warnings = [];
  if (!errors.length && m) { const r = pluginChecks(m, sc); errors.push(...r.errs); warnings.push(...r.warns); }
  return { ok: !errors.length, errors, warnings };
}

// File validation follows the same content/profile/compiler path as rendering.
// Keep validateScript synchronous for live authoring and schema consumers.
export async function validateScriptFile(file, m, opts = {}) {
  try {
    const { prepareScript } = await import("./script.mjs");
    const resolved = await prepareScript(m, file, opts);
    const { errs, warns } = pluginChecks(m, resolved);
    return { ok: !errs.length, errors: errs, warnings: warns };
  } catch (e) {
    return { ok: false, errors: [{ path: file, message: e.message }], warnings: [] };
  }
}

export function validateManifest(file) {
  let doc;
  try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { ok: false, errors: [{ path: "(yaml)", message: e.message.split("\n")[0] }], warnings: [] }; }
  const errors = check(pluginSchema(), doc), warnings = [];
  if (doc?.name && doc.name !== path.basename(path.dirname(file))) errors.push({ path: "name", message: `must equal the plugin dir name "${path.basename(path.dirname(file))}"` });
  if (doc?.editions && doc.edition && !(doc.edition in doc.editions)) errors.push({ path: "edition", message: `"${doc.edition}" is not in editions` });
  if (!errors.length && doc.route_aliases?.length) webRoutes({ ...doc,
    runtimeDir: doc.runtime?.dir ? path.resolve(path.dirname(file), doc.runtime.dir) : null }, errors);
  return { ok: !errors.length, errors, warnings };
}

// Path part of a goto/route ("https://h/a/b?x#y" or "/a/b#y" -> "/a/b"), trailing slash dropped.
const pathOf = (u) => (u.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/(.)\/+$/, "$1") || "/");
// Vocabulary route -> RegExp; ":param" segments match one path segment.
const routeRx = (r) => new RegExp(`^${pathOf(r).split("/").map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`);

// plugins/<p>/vocabulary.yaml (docs/plugin-vocabulary.md): schema + guides, scripts, locales, editions, routes, snippets.
export function validateVocabulary(file, m) {
  let doc;
  try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { ok: false, errors: [{ path: "(yaml)", message: e.message.split("\n")[0] }], warnings: [] }; }
  const errors = check(load("vocabulary.schema.json"), doc), warnings = [];
  if (errors.length) return { ok: false, errors, warnings };
  const E = (p, message) => errors.push({ path: p, message }), W = (p, message) => warnings.push({ path: p, message });
  if (doc.plugin !== m.name) E("plugin", `must equal the plugin dir name "${m.name}"`);
  const ids = {};
  for (const list of ["surfaces", "entities", "actions", "moments", "snippets"]) {
    ids[list] = new Set();
    (doc[list] || []).forEach((x, i) => { if (ids[list].has(x.id)) E(`${list}[${i}].id`, `duplicate id "${x.id}"`); ids[list].add(x.id); });
  }
  const ref = (p, list, v) => { if (v !== undefined && !ids[list].has(v)) E(p, `unknown ${list.slice(0, -1)} "${v}"${closest(v, [...ids[list]])}`); };
  // Bundled scripts: name -> {gotos, shots}. Operating guides do not depend on the sample catalog.
  const scen = new Map();
  if (m.scriptsDir && fs.existsSync(m.scriptsDir)) for (const f of fs.readdirSync(m.scriptsDir).filter((f) => /\.ya?ml$/.test(f))) {
    let sc; try { sc = YAML.parse(fs.readFileSync(path.join(m.scriptsDir, f), "utf8")); } catch { continue; }
    const steps = Array.isArray(sc?.steps) ? sc.steps : (sc?.scenes || []).flatMap((scene) => scene.steps || []);
    scen.set(f.replace(/\.ya?ml$/, ""), {
      gotos: steps.filter((s) => typeof s?.goto === "string").map((s) => pathOf(s.goto)),
      shots: new Set(steps.map((s) => (typeof s?.shot === "string" ? s.shot : s?.shot?.name)).filter(Boolean)),
    });
  }
  const refScript = (p, name) => { if (name !== undefined && !scen.has(name)) E(p, `no script "${name}" in ${path.relative(ROOT, m.scriptsDir)}/${closest(name, [...scen.keys()])}`); };
  const guides = new Map();
  const refGuide = (field, target) => {
    if (target === undefined) return;
    const [relative, anchor, ...extra] = target.split("#");
    const guide = path.resolve(m.dir, relative);
    if (!relative.endsWith(".md") || extra.length || path.isAbsolute(relative) || path.relative(m.dir, guide).startsWith("..")) {
      E(field, "guide must name a Markdown file within this plugin, optionally followed by #heading"); return;
    }
    if (!fs.existsSync(guide) || !fs.statSync(guide).isFile()) { E(field, `missing operating guide "${relative}"`); return; }
    if (!anchor) return;
    if (!guides.has(guide)) {
      const text = fs.readFileSync(guide, "utf8");
      const anchors = new Set([...text.matchAll(/<a\s+id=["']([^"']+)["']/g)].map((match) => match[1]));
      const counts = new Map();
      let fenced = false;
      for (const line of text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
        const heading = !fenced && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
        if (!heading) continue;
        const slug = heading[1].toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
        const n = counts.get(slug) || 0;
        anchors.add(n ? `${slug}-${n}` : slug); counts.set(slug, n + 1);
      }
      guides.set(guide, anchors);
    }
    if (!guides.get(guide).has(anchor)) E(field, `no heading "#${anchor}" in "${relative}"`);
  };
  const editions = m.editions ? Object.keys(m.editions) : [];
  const routes = webRoutes(m, errors), gotos = [...scen.values()].flatMap((s) => s.gotos);
  let unchecked = 0;
  doc.surfaces.forEach((s, i) => {
    if (s.edition !== undefined && !editions.includes(s.edition)) E(`surfaces[${i}].edition`, `unknown edition "${s.edition}" (have: ${editions.join(", ") || "none"})`);
    if (s.status !== "works" && s.status !== "partial") return;
    s.routes.forEach((r, j) => {
      const p = pathOf(r);
      if (routes) { if (!routes.some((rx) => rx.test(p))) E(`surfaces[${i}].routes[${j}]`, `"${r}" is not a page route of the built ${m.name} runtime`); }
      else if (!gotos.some((g) => routeRx(r).test(g))) unchecked++;
    });
  });
  if (unchecked) W("surfaces", `${unchecked} works/partial route(s) not opened by a bundled ${m.name} script and no built route table to check them against`);
  (doc.entities || []).forEach((x, i) => (x.surfaces || []).forEach((s, j) => ref(`entities[${i}].surfaces[${j}]`, "surfaces", s)));
  (doc.actions || []).forEach((x, i) => {
    ref(`actions[${i}].surface`, "surfaces", x.surface);
    (x.entities || []).forEach((e, j) => ref(`actions[${i}].entities[${j}]`, "entities", e));
    refScript(`actions[${i}].script`, x.script);
    refGuide(`actions[${i}].guide`, x.guide);
  });
  (doc.moments || []).forEach((x, i) => {
    ref(`moments[${i}].surface`, "surfaces", x.surface);
    refScript(`moments[${i}].script`, x.script);
    refGuide(`moments[${i}].guide`, x.guide);
    if (x.shot !== undefined) {
      if (x.script === undefined) E(`moments[${i}].shot`, "needs a script");
      else if (scen.has(x.script) && !scen.get(x.script).shots.has(x.shot)) E(`moments[${i}].shot`, `no shot "${x.shot}" in script "${x.script}"${closest(x.shot, [...scen.get(x.script).shots])}`);
    }
  });
  (doc.not_supported || []).forEach((x, i) => ref(`not_supported[${i}].surface`, "surfaces", x.surface));
  const sch = scriptSchema(), step = sch.$defs.step;
  (doc.snippets || []).forEach((x, i) => {
    ref(`snippets[${i}].action`, "actions", x.action);
    x.steps.forEach((s, j) => errors.push(...check(step, s, sch, `snippets[${i}].steps[${j}]`)));
  });
  const have = m.localization?.locales || [];
  (doc.locales || []).forEach((l, i) => { if (!have.includes(l)) E(`locales[${i}]`, `"${l}" is not in plugin.yaml localization.locales${have.length ? "" : " (plugin declares none)"}`); });
  if (doc.default_locale !== undefined && !(doc.locales || []).includes(doc.default_locale)) E("default_locale", `"${doc.default_locale}" is not in locales`);
  if (!fs.existsSync(path.join(path.dirname(file), "PLAYBOOK.md"))) W("PLAYBOOK.md", "missing next to vocabulary.yaml");
  return { ok: !errors.length, errors, warnings };
}

export function printResult(label, r) {
  console.log(`${r.ok ? "✓" : "✗"} ${label}`);
  for (const e of r.errors) console.log(`    ✗ ${e.path}: ${e.message}`);
  for (const w of r.warnings) console.log(`    · ${w.path}: ${w.message}`);
}
