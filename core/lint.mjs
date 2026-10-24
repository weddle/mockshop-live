// Script lint: keep world-driven scripts free of data. A script names its world, navigates, clicks, types and
// asserts (on screen or with assert_state / snapshot_state). Everything else comes from the world through {{refs}}.
// See docs/script-lint.md for the rules, the allowlist pragma and the CLI (`./mockshop lint`).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const RULES = {
  S0: "bad-pragma", S1: "literal-entity", S2: "literal-email", S3: "fixture-id", S4: "api-fetch",
  S5: "web-storage", S6: "mockshop-route", S7: "inline-data", S8: "version-label",
};
const ALLOWABLE = new Set(["S1"]);
const EMAIL_EXEMPT = new Set(["support@onyx.app"]); // product copy shown by the Onyx UI
const ENTITY_TOP = ["people", "teams", "sources", "documents", "conversations"];
const ENTITY_APP = ["people", "agents", "sources", "documents", "conversations", "replies", "teams", "llm_providers"];

const RE_PRAGMA = /(?:#|\/\/)\s*lint-allow\s+(S\d)\s*:\s*(.*?)\s*$/;
const RE_API = /fetch\(\s*['"`]\/api|['"`]\/api\/[\w/-]*['"`]\s*\+|\bget\(\s*['"`]\//;
const RE_STORAGE = /\b(?:session|local)Storage\b/;
const RE_MOCK = /\/mockshop\/[\w/-]+/g;
const RE_TOPKEY = /^([a-z_]+):/;
const RE_EMAIL = /(?<![\w.{])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,}\b/g;
const RE_NUMID = /(?:agent-row-actions|edit-agent)-\d+\b|\/(?:persona|connector|user-group|mcp\/servers?|projects?|cc-pair|document-set|chat-session|credential)\/\d+\b|\[\s*\d+(?:\s*,\s*\d+){2,}\s*\]/g;
const RE_VERSION = /\bv\d+\.\d+\.\d+\b/g;
const RE_FIXTURE_LINE = /^\s+["']?(?:GET|POST|PUT|PATCH|DELETE) \/[^\s"':]*["']?\s*:/;

const stripTemplates = (s) => s.replace(/\{\{.*?\}\}/g, " ");
const all = (re, s) => [...s.matchAll(re)].map((m) => m[0]);

function globYaml(dir, recursive) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return recursive ? globYaml(p, true) : [];
    return /\.ya?ml$/.test(e.name) ? [p] : [];
  });
}

// Every script the repo ships: plugin scripts, reference examples and docs examples.
export function scriptPaths(root) {
  const dirs = [path.join(root, "docs/examples")];
  for (const base of ["plugins", "reference-examples/plugins"]) {
    const b = path.join(root, base);
    if (fs.existsSync(b)) for (const p of fs.readdirSync(b)) dirs.push(path.join(b, p, "scripts"));
  }
  return [...new Set(dirs.flatMap((d) => globYaml(d, false)))].sort();
}

// World-driven scripts: no `world:` line, so the same script must run unchanged in any world.
export const isWorldDriven = (file) => !/^world:/m.test(fs.readFileSync(file, "utf8"));

// Literal display names and titles of world entities (shared worlds), longest first.
export function worldNames(root) {
  const files = [...globYaml(path.join(root, "reference-examples/worlds"), true), ...globYaml(path.join(root, "worlds"), true)]
    .filter((f) => !f.split(path.sep).includes("snapshots"));
  const names = new Set();
  const add = (v) => {
    if (typeof v === "string" && !v.includes("{{") && v.length >= 6 && /[A-Za-z]{3}/.test(v) && v.trim().includes(" ")) names.add(v.trim());
  };
  const recs = (d) => (d && typeof d === "object" && !Array.isArray(d) ? Object.values(d) : []);
  const take = (r) => { if (r && typeof r === "object" && !Array.isArray(r)) { add(r.name); add(r.title); } };
  for (const f of files) {
    let doc;
    try { doc = YAML.parse(fs.readFileSync(f, "utf8"), { merge: true, uniqueKeys: false, maxAliasCount: -1 }); } catch { continue; }
    if (!doc || typeof doc !== "object") continue;
    for (const k of ENTITY_TOP) recs(doc[k]).forEach(take);
    const apps = doc.apps && typeof doc.apps === "object" ? Object.values(doc.apps) : [];
    for (const app of apps) if (app && typeof app === "object") for (const k of ENTITY_APP) recs(app[k]).forEach(take);
  }
  return [...names].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

// Lint one script's text. Returns { violations: [{line, rule, message}], allowed: [{line, rule, reason, what}] }.
export function lintText(text, names = []) {
  const out = [], allowed = [];
  let top = null, inEval = false, evalIndent = 0, contentSub = null;
  text.split("\n").forEach((raw, idx) => {
    const line = idx + 1;
    const m = RE_TOPKEY.exec(raw);
    if (m) { top = m[1]; contentSub = null; }
    if (/^\s*#/.test(raw) || !raw.trim()) return;
    const em = /^(\s*)- eval:\s*[|>]?/.exec(raw);
    if (em) { inEval = true; evalIndent = em[1].length; }
    else if (inEval && /^\s*\S/.test(raw) && /^\s*/.exec(raw)[0].length <= evalIndent) inEval = false;
    const pragma = RE_PRAGMA.exec(raw);
    const code = pragma ? raw.slice(0, pragma.index) : raw;
    let lit = stripTemplates(code);
    let hits = [];
    if (top === "content" && !m) {
      const sm = /^ {2}([\w-]+):/.exec(raw);
      if (sm) contentSub = sm[1];
      if (contentSub && contentSub !== "includes" && sm) hits.push(["S7", `content.${contentSub} carries data in the script (move it to a world; only includes: is allowed)`]);
      else if (contentSub !== "includes" && RE_FIXTURE_LINE.test(raw)) hits.push(["S7", "inline response body"]);
      if (contentSub === "includes") return; // include paths name worlds, not data
    }
    for (const n of names) if (lit.includes(n)) { hits.push(["S1", `literal entity text '${n}'`]); lit = lit.split(n).join(" "); }
    for (const e of all(RE_EMAIL, lit)) if (!EMAIL_EXEMPT.has(e.toLowerCase())) hits.push(["S2", `literal email ${e}`]);
    for (const x of all(RE_NUMID, lit)) hits.push(["S3", `fixture id ${x}`]);
    if (inEval && RE_API.test(lit)) hits.push(["S4", "eval reads the backend via /api (use assert_state/snapshot_state)"]);
    if (RE_STORAGE.test(lit)) hits.push(["S5", "web storage used to seed/thread state"]);
    for (const x of all(RE_MOCK, lit)) hits.push(["S6", `mock-only route ${x} (use a world state flag)`]);
    for (const x of all(RE_VERSION, lit)) hits.push(["S8", `version label ${x}`]);
    if (pragma) {
      const [, rule, reason] = pragma;
      if (!ALLOWABLE.has(rule)) out.push({ line, rule: "S0", message: `lint-allow ${rule} is not allowed (only S1, for UI copy)` });
      else if (reason.length < 10) out.push({ line, rule: "S0", message: "lint-allow needs a reason (>= 10 chars)" });
      else {
        const keep = [];
        for (const h of hits) { if (h[0] === rule) allowed.push({ line, rule, reason, what: h[1] }); else keep.push(h); }
        if (keep.length === hits.length) out.push({ line, rule: "S0", message: `unused lint-allow ${rule}` });
        hits = keep;
      }
    }
    for (const [rule, message] of hits) out.push({ line, rule, message });
  });
  return { violations: out, allowed };
}

// Lint files. Returns a summary with per-file results.
export function lintFiles(files, { root, names = worldNames(root) } = {}) {
  const perFile = [], byRule = Object.fromEntries(Object.keys(RULES).map((r) => [r, 0]));
  let violations = 0, allowlisted = 0;
  for (const f of files) {
    const r = lintText(fs.readFileSync(f, "utf8"), names);
    for (const v of r.violations) byRule[v.rule]++;
    violations += r.violations.length; allowlisted += r.allowed.length;
    perFile.push({ file: path.relative(root, path.resolve(f)), ...r });
  }
  return {
    violations, allowlisted, files: perFile.length, clean: perFile.filter((p) => !p.violations.length).length,
    byRule: Object.fromEntries(Object.entries(byRule).filter(([, n]) => n).map(([r, n]) => [`${r} ${RULES[r]}`, n])),
    perFile,
  };
}
