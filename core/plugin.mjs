// Plugin discovery + manifest loading. A plugin is a directory plugins/<name>/ with plugin.yaml.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGINS = path.join(ROOT, "plugins");
export const DEFAULT_PLUGIN = process.env.MOCKSHOP_PLUGIN || "onyx";

const pluginRoots = () => [PLUGINS, ...(process.env.MOCKSHOP_PLUGIN_PATH || "").split(path.delimiter).filter(Boolean).map((p) => path.resolve(p))];
export function listPlugins() {
  return [...new Set(pluginRoots().flatMap((root) => fs.existsSync(root) ? fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "plugin.yaml"))) : []))].sort();
}

// Replace {{ports.web}} style references with manifest values.
function expand(val, ctx) {
  if (typeof val === "string") return val.replace(/\{\{([\w.]+)\}\}/g, (m, k) => {
    const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), ctx);
    return v == null ? m : String(v);
  });
  if (Array.isArray(val)) return val.map((v) => expand(v, ctx));
  if (val && typeof val === "object") return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, expand(v, ctx)]));
  return val;
}

// Edition (optional manifest feature: `edition` default + `editions: {name: {build_env, fixtures}}`).
// Highest wins: explicit (CLI flag) > MOCKSHOP_<PLUGIN>_EDITION > mockshop.local.yaml `<plugin>: {edition}` > manifest `edition`.
function resolveEdition(raw, name, explicit) {
  const names = Object.keys(raw.editions);
  let local = null;
  const localFile = path.join(ROOT, "mockshop.local.yaml");
  if (fs.existsSync(localFile)) local = YAML.parse(fs.readFileSync(localFile, "utf8"))?.[name]?.edition ?? null;
  const picks = [
    [explicit, "command line"],
    [process.env[`MOCKSHOP_${name.toUpperCase()}_EDITION`], `MOCKSHOP_${name.toUpperCase()}_EDITION`],
    [local, "mockshop.local.yaml"],
    [raw.edition, "plugin.yaml"],
  ];
  const [edition, source] = picks.find(([v]) => v) || [names[0], "first listed"];
  if (!names.includes(edition)) throw new Error(`${name}: unknown edition "${edition}" (from ${source}); valid: ${names.join(", ")}`);
  return { edition, editionSource: source };
}

// Ports: manifest default + MOCKSHOP_PORT_OFFSET (integer, shifts every port so concurrent sessions can share a box), unless
// MOCKSHOP_<PLUGIN>_WEB_PORT / _MOCK_PORT names that port absolutely. The one place ports are resolved: cli, server, runner, handlers
// (`core.plugin.ports`) and `{{ports.*}}` templating in the manifest all read the result.
export function resolvePorts(declared, name, env = process.env) {
  const raw = env.MOCKSHOP_PORT_OFFSET;
  const offset = raw === undefined || raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(offset)) throw new Error(`MOCKSHOP_PORT_OFFSET must be an integer, got "${raw}"`);
  const ports = { ...(declared || {}) };
  for (const k of Object.keys(ports)) {
    const explicit = env[`MOCKSHOP_${name.toUpperCase()}_${k.toUpperCase()}_PORT`];
    const port = explicit ? Number(explicit) : ports[k] + offset;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}: ports.${k} resolves to ${port}, outside 1-65535 (MOCKSHOP_PORT_OFFSET=${offset})`);
    ports[k] = port;
  }
  return ports;
}

export function loadPlugin(name = DEFAULT_PLUGIN, { edition } = {}) {
  const dir = pluginRoots().map((root) => path.join(root, name)).find((dir) => fs.existsSync(path.join(dir, "plugin.yaml"))) || path.join(PLUGINS, name);
  const file = path.join(dir, "plugin.yaml");
  if (!fs.existsSync(file)) throw new Error(`unknown plugin "${name}" (have: ${listPlugins().join(", ") || "none"})`);
  const raw = YAML.parse(fs.readFileSync(file, "utf8"));
  if (raw.name !== name) throw new Error(`plugins/${name}/plugin.yaml: name must be "${name}"`);
  const ports = resolvePorts(raw.ports, name);
  const m = expand({ ...raw, ports }, { ports });
  if (m.upstream) { // local_mirror: env MOCKSHOP_<PLUGIN>_MIRROR wins; "~" = home; relative = against the Mockshop root
    const lm = process.env[`MOCKSHOP_${name.toUpperCase()}_MIRROR`] || m.upstream.local_mirror;
    if (lm) m.upstream.local_mirror = path.resolve(ROOT, lm.replace(/^~(?=$|\/)/, os.homedir()));
  }
  const rel = (p) => (p ? path.resolve(dir, p) : null);
  const ed = raw.editions ? resolveEdition(raw, name, edition) : {};
  if (ed.edition && m.editions[ed.edition]?.build_env) m.build = { ...m.build, env: { ...m.build?.env, ...m.editions[ed.edition].build_env } };
  return {
    ...m,
    ...ed,
    dir,
    workdir: rel(m.workdir),
    runtimeDir: rel(m.runtime?.dir),
    fixturesDir: rel(m.mock?.fixtures || "fixtures"),
    scriptsDir: rel("scripts"),
    handlersFile: m.mock?.handlers ? rel(m.mock.handlers) : null,
    patchesDir: rel(m.build?.patches),
    overlayDir: rel(m.build?.overlay),
    logsDir: path.join(ROOT, "logs", name),
    outDir: path.join(ROOT, "out", name),
  };
}

export function toolchainBin(manifest) {
  const v = manifest.toolchain?.node;
  return v ? path.join(ROOT, ".toolchains", `node-${v}`, "bin") : null;
}
