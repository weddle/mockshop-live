// Identity literals: the names, emails and titles a plugin's worlds give their entities. A world-swappable script (one with no
// `world:` line, run under MOCKSHOP_WORLD) must reach them through {{refs}}; a literal copy pins it to one world.
import fs from "node:fs";
import path from "node:path";
import { loadContent, contentRefs } from "../core/content.mjs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Where identities live in a composed world, and which fields of each entity are identities.
const SHARED = { people: ["name", "email"], teams: ["name"], sources: ["name"], documents: ["title"] };
const APP = { agents: ["name"], replies: ["question", "title"], llm_providers: ["name"] };
const MIN = 3;

// identity text -> ["<world>: <path>", ...] across every world.yaml under <plugin>/worlds/.
export function worldIdentities(m) {
  const found = new Map();
  const root = path.join(m.dir, "worlds");
  const add = (value, where) => {
    if (typeof value !== "string" || value.length < MIN || value.includes("{{")) return;
    found.set(value, [...(found.get(value) || []), where]);
  };
  const worlds = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "world.yaml"))).sort() : [];
  for (const w of worlds) {
    const { content } = loadContent(path.join(root, w, "world.yaml"), { refs: contentRefs(m) });
    add(content.company?.name, `${w}: company.name`);
    add(content.company?.domain, `${w}: company.domain`);
    const scan = (entities, fields, prefix) => {
      for (const [key, entity] of Object.entries(isObject(entities) ? entities : {})) for (const f of fields) add(entity?.[f], `${w}: ${prefix}.${key}.${f}`);
    };
    for (const [coll, fields] of Object.entries(SHARED)) scan(content[coll], fields, coll);
    const app = content.apps?.[m.name] || {};
    for (const [coll, fields] of Object.entries(APP)) scan(app[coll], fields, `apps.${m.name}.${coll}`);
    for (const [key, provider] of Object.entries(isObject(app.llm_providers) ? app.llm_providers : {})) scan(provider?.models, ["display_name"], `apps.${m.name}.llm_providers.${key}.models`);
  }
  return found;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Literal identity hits in script text: [{line, literal, where}]. {{...}} spans are references, never hits; a hit must not sit
// inside a longer word (so "Sam" does not match "Sample").
export function lintIdentityLiterals(text, identities) {
  const hits = [];
  const lines = text.split("\n").map((l) => l.replace(/\{\{[^{}]*\}\}/g, (ref) => " ".repeat(ref.length)));
  const patterns = [...identities.keys()].sort((a, b) => b.length - a.length).map((literal) => [literal, new RegExp(`(?<![\\p{L}\\p{N}_])${escape(literal)}(?![\\p{L}\\p{N}_])`, "u")]);
  lines.forEach((line, i) => {
    let rest = line;
    for (const [literal, rx] of patterns) {
      if (!rx.test(rest)) continue;
      hits.push({ line: i + 1, literal, where: identities.get(literal) });
      rest = rest.replace(new RegExp(rx.source, "gu"), (s) => " ".repeat(s.length));
    }
  });
  return hits;
}
