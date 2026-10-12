// Mockshop CLI. See README.md. Usage: ./mockshop [--plugin <name>] <command> [args]
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { ROOT, DEFAULT_PLUGIN, listPlugins, loadPlugin } from "./plugin.mjs";
import YAML from "yaml";
import { build, builtEdition, ensureToolchain, fetchUpstream, toolchainEnv, verify } from "./build.mjs";
import { isoLocal } from "./time.mjs";
import { cacheRoot, listCache, verifyCache } from "./cache.mjs";

const HELP = `Mockshop: screenshot real web UIs against a scripted mock backend.

  ./mockshop [--plugin <p>] <command> [args]        (default plugin: ${DEFAULT_PLUGIN})

  plugins                       list plugins
  fetch   [p] [--force]         (debug) export the pinned source + patches into plugins/<p>/work/ only
  build   [p] [--keep-work] [--<edition> | --edition <name>]
                                fetch pinned source -> install -> build -> assemble runtime/ -> delete work/
                                (plugins with editions: e.g. onyx --enterprise | --community; default from README "Editions")
  verify  [p]                   check runtime/ matches the pin + its file hashes (exit 1 on mismatch)
  cache list                    list preserved plugin pins, file counts and bytes
  cache verify [p]              re-hash cached blobs against their manifests
  pin     [p]                   show pin + build stamp
  up | down | restart | status  [p]   start/stop the plugin's mock + web servers
  switch  [p] [overlay...]      swap fixture overlays on the running mock (none = base), keeping in-run state; reload the page
  shot <target>...              run scripts -> out/<p>/<script>/*.png
       --locale <code>          override script locale (plugin-supported languages)
       targets: onyx/omzo-incident | omzo-incident (default plugin) | onyx --all | --all | path/to/x.yaml
  clip <target>...              record the same scripts as human-paced MP4s -> out/<p>/clips/<script>.mp4
                                (script-level \`clip:\` options set pacing; see README "Clips"); also writes <script>.timeline.json/.vtt
       --profile <file>         select presentation defaults instead of the script profile
       --render-overrides <file> override presentation by script, scene ID, or step ID
  explain <clip.timeline.json> --at <seconds|mm:ss>
                                locate the scene, step, and authoring source in that exact render
  validate [target]...          check script YAML (and plugin.yaml, vocabulary.yaml) against schema/*.json + the plugin's web routes
       targets: path/to/x.yaml | onyx/omzo-incident | onyx | --all | path/to/plugin.yaml | path/to/vocabulary.yaml
  live [p] [--clip] [--locale code] [--name n] [--save file.yaml]
                                stdio JSON-lines control: one step per line in, one result per line out (docs/agent-guide.md)
`;

const log = (...a) => console.log("[mockshop]", ...a);

// Optional plugin hooks module (manifest `hooks: hooks.mjs`) may export fetch(m, ctx) / build(m, ctx)
// to replace the default source-build steps (e.g. unpack a captured front end instead of git export).
async function hook(m, name, fallback, opts) {
  if (m.hooks) {
    const mod = await import(path.resolve(m.dir, m.hooks));
    if (typeof mod[name] === "function") return mod[name](m, { ...opts, defaults: { fetchUpstream, build, ensureToolchain, toolchainEnv }, log });
  }
  return fallback(m, opts);
}
let args = process.argv.slice(2);
let pluginName = DEFAULT_PLUGIN;
const pi = args.findIndex((a) => a === "--plugin" || a === "-p");
if (pi >= 0) { pluginName = args[pi + 1]; args.splice(pi, 2); }
const cmd = args.shift();
const ei = args.indexOf("--edition");
const editionArg = ei >= 0 ? args.splice(ei, 2)[1] : null;
const li = args.indexOf("--locale");
const localeArg = li >= 0 ? args.splice(li, 2)[1] : null;
if (li >= 0 && (!localeArg || localeArg.startsWith('--'))) throw new Error('--locale requires a language code');
function optionValue(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(i, 2);
  return value;
}
const profileArg = optionValue("--profile");
const renderOverridesArg = optionValue("--render-overrides");
const atArg = optionValue("--at");
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const plugins = listPlugins();
if (positional[0] && plugins.includes(positional[0]) && cmd !== "shot" && cmd !== "clip" && cmd !== "validate") pluginName = positional.shift();

const pidOn = (port) => {
  try {
    // lsof is on stock macOS; ss (iproute2) is Linux-only.
    if (process.platform === "darwin") return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf8" }).split("\n")[0] || null;
    return execSync(`ss -ltnpH "sport = :${port}"`, { encoding: "utf8" }).match(/pid=(\d+)/)?.[1] || null;
  } catch { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, tries = 120) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.status < 500) return true; } catch {} await sleep(500); }
  throw new Error(`timeout waiting for ${url}`);
}
function startDetached(command, cwd, env, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `# ${isoLocal()} start (cwd ${cwd}): ${command}\n`);
  const fd = fs.openSync(logFile, "a");
  const child = spawn("bash", ["-c", `exec ${command}`], { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
}

function printVerify(m, v) {
  for (const p of v.problems) console.log(`  ✗ ${p}`);
  for (const i of v.info) console.log(`  · ${i}`);
}

// Script `requires: <edition>` (or a list): the edition the runtime must have been built as.
const asList = (v) => (v == null ? [] : [].concat(v));
const buildHint = (m, ed) => `./mockshop build ${m.name} --${ed}`;
// Scripts in `files` whose requirement isn't met by the built edition (fallback: the selected one).
function editionMisses(m, files) {
  if (!m.editions) return [];
  const have = builtEdition(m) || m.edition;
  return files.flatMap((f) => {
    const sc = YAML.parse(fs.readFileSync(f, "utf8")) || {};
    const need = asList(sc.requires);
    return need.length && !need.includes(have) ? [{ file: f, name: sc.name || path.basename(f).replace(/\.ya?ml$/, ""), need, have }] : [];
  });
}
function warnEditionMisses(m, misses) {
  if (!misses.length) return;
  const need = [...new Set(misses.flatMap((x) => x.need))];
  log(`${m.name}: WARNING, ${misses.length} script(s) need the ${need.join(" or ")} edition but the built edition is ${misses[0].have} (${misses.map((x) => x.name).join(", ")}); shot/clip will skip them. Build with ${buildHint(m, need[0])}`);
}

async function up(m, files = null) {
  const v = verify(m);
  if (!v.ok) { log(`${m.name}: WARNING, the copy doesn't match the pin:`); printVerify(m, v); }
  warnEditionMisses(m, editionMisses(m, files || (fs.existsSync(m.scriptsDir) ? fs.readdirSync(m.scriptsDir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("_")).sort().map((f) => path.join(m.scriptsDir, f)) : [])));
  ensureToolchain(m);
  const artifact = m.runtime?.artifact ? path.join(m.runtimeDir, m.runtime.artifact) : m.build?.artifact ? path.join(m.workdir, m.build.artifact) : null;
  if (artifact && !fs.existsSync(artifact)) await hook(m, "build", build, {});
  fs.mkdirSync(m.logsDir, { recursive: true });
  const env = toolchainEnv(m);
  if (!pidOn(m.ports.mock)) startDetached(`node "${path.join(ROOT, "core", "server.mjs")}" ${m.name}`, ROOT, env, path.join(m.logsDir, "mock.log"));
  if (m.start && !pidOn(m.ports.web)) startDetached(m.start.command, path.join(m.runtimeDir || m.workdir, m.start.cwd || "."), toolchainEnv(m, m.start.env || {}), path.join(m.logsDir, "web.log"));
  await waitHttp(`http://127.0.0.1:${m.ports.mock}/__mockshop/health`);
  if (m.start) await waitHttp(`http://127.0.0.1:${m.ports.web}${m.start.ready || "/"}`);
  log(`${m.name} up:${m.ports.web ? ` web http://127.0.0.1:${m.ports.web} ` : ""} mock http://127.0.0.1:${m.ports.mock}`);
}
async function down(m) {
  for (const [k, port] of Object.entries(m.ports)) {
    const pid = pidOn(port);
    if (pid) { process.kill(Number(pid)); log(`stopped ${m.name} ${k} :${port} (pid ${pid})`); }
  }
  for (let i = 0; i < 20 && Object.values(m.ports).some(pidOn); i++) await sleep(250);
}
function editionLine(m) {
  if (!m.editions) return null;
  const built = builtEdition(m);
  return `edition ${built || "unknown (built before editions, or not built)"}${built && built === m.edition ? "" : ` (selected: ${m.edition}, via ${m.editionSource})`}`;
}
function status(m) {
  const ed = editionLine(m);
  if (ed) console.log(`${m.name.padEnd(8)} ${ed}`);
  for (const [k, port] of Object.entries(m.ports)) {
    const pid = pidOn(port);
    console.log(`${m.name.padEnd(8)} ${k.padEnd(5)} :${port} ${pid ? `running (pid ${pid})` : "stopped"}`);
  }
}

// shot targets -> [{plugin, files}]
function resolveTargets(list) {
  const jobs = new Map();
  const add = (p, f) => { if (!jobs.has(p)) jobs.set(p, []); if (f) jobs.get(p).push(f); };
  const all = (p) => {
    const m = loadPlugin(p);
    fs.readdirSync(m.scriptsDir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith("_")).sort().forEach((f) => add(p, path.join(m.scriptsDir, f)));
  };
  if (!list.length || (list.length === 0 && flags.has("--all"))) { all(pluginName); return jobs; }
  for (const t of list) {
    if (plugins.includes(t)) { all(t); continue; }
    if (fs.existsSync(t) && fs.statSync(t).isFile()) {
      const abs = path.resolve(t);
      const declared = YAML.parse(fs.readFileSync(abs, "utf8"))?.plugin;
      const owner = declared || plugins.find((p) => abs.startsWith(loadPlugin(p).dir + path.sep)) || pluginName;
      if (!plugins.includes(owner)) throw new Error(`${t}: unknown plugin "${owner}"`);
      add(owner, abs); continue;
    }
    const [p, s] = t.includes("/") ? t.split("/", 2) : [pluginName, t];
    const m = loadPlugin(p);
    const f = [s, `${s}.yaml`, `${s}.yml`].map((x) => path.join(m.scriptsDir, x)).find((x) => fs.existsSync(x) && fs.statSync(x).isFile());
    if (!f) throw new Error(`script not found: ${t} (looked in ${path.relative(ROOT, m.scriptsDir)}/)`);
    add(p, f);
  }
  return jobs;
}

async function main() {
  switch (cmd) {
    case "explain": {
      if (positional.length !== 1 || atArg === undefined) throw new Error("usage: ./mockshop explain <clip.timeline.json> --at <seconds|mm:ss>");
      const { parseAt } = await import("./timeline.mjs");
      const ms = parseAt(atArg);
      if (ms === null || ms < 0) throw new Error(`invalid clip time: ${atArg}`);
      const file = path.resolve(positional[0]);
      const timeline = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(timeline.actions)) throw new Error(`${file}: not a clip timeline`);
      const actions = timeline.actions.filter((a) => a.start_ms <= ms && a.end_ms > ms);
      if (!actions.length) throw new Error(`${file}: no recorded step at ${atArg}`);
      console.log(JSON.stringify({ timeline: file, script: timeline.script, at_ms: ms, actions }, null, 2));
      return 0;
    }
    case "cache": {
      const action=positional[0],p=positional[1];
      if (!['list','verify'].includes(action)) throw new Error('usage: ./mockshop cache list | cache verify [plugin]');
      const rows=action==='verify'?verifyCache(p):listCache(p);
      console.log(`Pin cache: ${cacheRoot()}`);
      let bad=0,total=0;
      for (const row of rows) {
        total+=row.size;
        console.log(`${row.plugin} ${row.pin}: ${row.files} files, ${row.size} bytes${action==='verify'?(row.problems.length?' FAIL':' OK'):''}`);
        for(const problem of row.problems || []) {console.log(`  ✗ ${problem}`);bad++;}
      }
      console.log(`${rows.length} pin(s), ${total} bytes`);
      if (action==='verify' && !rows.length) throw new Error('no cached pins to verify');
      return bad?1:0;
    }
    case "plugins": for (const p of plugins) { const m = loadPlugin(p); console.log(`${p.padEnd(10)} ${m.kind || ""}  ${m.title || ""}${m.upstream ? `  @ ${m.upstream.commit.slice(0, 9)}` : ""}`); } return 0;
    case "fetch": await hook(loadPlugin(pluginName), "fetch", fetchUpstream, { force: flags.has("--force") }); return 0;
    case "build": {
      const names = Object.keys(loadPlugin(pluginName).editions || {});
      const picked = [editionArg, ...names.filter((n) => flags.has(`--${n}`))].filter(Boolean);
      if (new Set(picked).size > 1) throw new Error(`conflicting edition flags: ${picked.join(", ")}`);
      if (picked.length && !names.length) throw new Error(`${pluginName} has no editions`);
      const m = loadPlugin(pluginName, { edition: picked[0] });
      if (m.edition) log(`${m.name}: building the ${m.edition} edition (selected via ${m.editionSource})`);
      const running = Object.values(m.ports).some(pidOn);
      if (running) { log(`${m.name} is running; stopping it so the runtime can be swapped`); await down(m); }
      await hook(m, "build", build, { ...(flags.has("--keep-work") ? { keepWork: true } : {}), updatePin: flags.has("--update-pin") });
      if (running) await up(loadPlugin(pluginName, { edition: picked[0] }));
      return 0;
    }
    case "verify":
    case "pin": {
      const m = loadPlugin(pluginName);
      const v = verify(m);
      if (cmd === "pin") {
        const { files, ...rt } = v.runtime || {};
        console.log(JSON.stringify({ manifest: { repo: m.upstream?.repo, commit: m.upstream?.commit, subdir: m.upstream?.subdir, toolchain: m.toolchain, ...(m.editions ? { edition: m.edition, edition_source: m.editionSource } : {}) }, runtime: v.runtime ? rt : null }, null, 2));
      }
      const pin = m.pin ?? m.synora;
      console.log(m.kind === "captured-frontend" ? `${m.name}: ${v.ok ? "✓ matches captured pin" : "✗ does NOT match captured pin"} ${pin?.version ?? pin?.portal ?? pin?.shell}` : !m.upstream ? `${m.name}: no upstream pin (nothing to verify)` : v.ok ? `${m.name}: ✓ matches pin ${m.upstream.commit.slice(0, 9)}` : `${m.name}: ✗ does NOT match pin`);
      const ed = editionLine(m);
      if (ed && cmd === "pin") console.log(`  · ${ed}`);
      printVerify(m, v);
      return v.ok ? 0 : 1;
    }
    case "up": await up(loadPlugin(pluginName)); return 0;
    case "down": await down(loadPlugin(pluginName)); return 0;
    case "restart": { const m = loadPlugin(pluginName); await down(m); await up(m); return 0; }
    case "switch": { // live overlay switch on the running mock: keeps in-run state, demo clock and locale
      const m = loadPlugin(pluginName);
      const bad = positional.filter((o) => !fs.existsSync(path.join(m.fixturesDir, o)));
      if (bad.length) { log(`no such overlay in ${path.relative(ROOT, m.fixturesDir)}/: ${bad.join(", ")}`); return 1; }
      const r = await fetch(`http://127.0.0.1:${m.ports.mock}/__mockshop/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overlays: positional, keep: true, resetChats: false }) });
      const s = await r.json();
      log(`${m.name} :${m.ports.mock} overlays: ${s.overlays.join(", ") || "none (base)"} · locale ${s.locale} · demo anchor ${s.demo_anchor}. Reload the page to see it.`);
      return 0;
    }
    case "status": for (const p of (positional.length || args.includes(pluginName) ? [pluginName] : plugins)) status(loadPlugin(p)); return 0;
    case "validate": { // schema + plugin-aware checks; no browser, no servers
      const { validateScriptFile, validateManifest, validateVocabulary, printResult } = await import("./validate.mjs");
      let bad = 0;
      const special = (t) => fs.existsSync(t) && ["plugin.yaml", "vocabulary.yaml"].includes(path.basename(t));
      const vocab = (m, label) => { const f = path.join(m.dir, "vocabulary.yaml"); if (!fs.existsSync(f)) return; const r = validateVocabulary(f, m); printResult(label, r); if (!r.ok) bad++; };
      for (const t of positional) if (special(t)) {
        const abs = path.resolve(t);
        if (path.basename(t) === "plugin.yaml") { const r = validateManifest(abs); printResult(t, r); if (!r.ok) bad++; }
        else { const owner = plugins.find((p) => loadPlugin(p).dir === path.dirname(abs)); if (owner) vocab(loadPlugin(owner), t); else { console.log(`✗ ${t}: not inside a plugin dir`); bad++; } }
      }
      const files = positional.filter((t) => !special(t));
      if (files.length || !positional.length) for (const [p, fs_] of resolveTargets(files)) {
        const m = loadPlugin(p);
        if (!files.length || files.includes(p)) { const r = validateManifest(path.join(m.dir, "plugin.yaml")); printResult(`${p}/plugin.yaml`, r); if (!r.ok) bad++; vocab(m, `${p}/vocabulary.yaml`); }
        for (const f of fs_) {
          const r = await validateScriptFile(f, m, { profile: profileArg, renderOverrides: renderOverridesArg });
          printResult(`${p}/${path.basename(f)}`, r); if (!r.ok) bad++;
        }
      }
      return bad ? 1 : 0;
    }
    case "live": {
      const { runLive } = await import("./live.mjs");
      const m = loadPlugin(pluginName);
      const L = console.log; console.log = console.error; // keep stdout pure JSON lines
      try { await up(m); } finally { console.log = L; }
      return runLive(m, { locale: localeArg, clip: flags.has("--clip"), name: args.find((a, i) => args[i - 1] === "--name") || "live", save: args.find((a, i) => args[i - 1] === "--save") });
    }
    case "shot":
    case "clip": {
      const jobs = resolveTargets(positional);
      const { runScripts } = await import("./runner.mjs");
      let failed = 0;
      for (const [p, files] of jobs) {
        const m = loadPlugin(p);
        const misses = editionMisses(m, files);
        for (const x of misses) console.log(`skip ${m.name}/${x.name}: needs the ${x.need.join(" or ")} edition (built: ${x.have}). Build with ${buildHint(m, x.need[0])}`);
        const run = files.filter((f) => !misses.some((x) => x.file === f));
        if (!run.length) continue;
        await up(m, files);
        failed += await runScripts(m, run, { clip: cmd === "clip", locale: localeArg, profile: profileArg, renderOverrides: renderOverridesArg });
      }
      return failed ? 1 : 0;
    }
    default: process.stdout.write(HELP); return cmd && cmd !== "help" && cmd !== "--help" ? 2 : 0;
  }
}
main().then((c) => process.exit(c), (e) => { console.error(`[mockshop] error: ${e.message}`); process.exit(1); });
