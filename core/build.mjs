// Upstream pinning for source-build plugins: fetch (export pinned commit + patches + overlay),
// build (install + build commands with the pinned toolchain), verify (does the copy match the pin?).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { ROOT, toolchainBin, loadPlugin } from "./plugin.mjs";
import { isoLocal } from "./time.mjs";
import { restorePin, seedPin } from "./cache.mjs";

const PIN = ".mockshop-pin.json";
const FILES = ".mockshop-files.json";
const BUILD = ".mockshop-build.json";
const log = (...a) => console.log("[mockshop]", ...a);
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 1 << 28, ...opts });
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

export function toolchainEnv(m, extra = {}) {
  const bin = toolchainBin(m);
  return { ...process.env, ...(bin ? { PATH: `${bin}:${process.env.PATH}` } : {}), ...extra };
}

export function ensureToolchain(m) {
  const v = m.toolchain?.node;
  if (!v) return;
  const dir = path.join(ROOT, ".toolchains", `node-${v}`);
  if (fs.existsSync(path.join(dir, "bin", "node"))) return;
  log(`installing Node ${v} into .toolchains/`);
  fs.mkdirSync(dir, { recursive: true });
  sh(`curl -fsSL https://nodejs.org/dist/v${v}/node-v${v}-linux-x64.tar.gz | tar -xz -C "${dir}" --strip-components=1`, { stdio: "inherit" });
}

function patchFiles(m) {
  if (!m.patchesDir || !fs.existsSync(m.patchesDir)) return [];
  return fs.readdirSync(m.patchesDir).filter((f) => f.endsWith(".patch")).sort().map((f) => path.join(m.patchesDir, f));
}
function walk(dir, base = dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p));
  }
  return out.sort();
}
// Digest of everything we layer on top of upstream (patches + overlay), so edits to either are detected.
export function customizationDigest(m) {
  const h = crypto.createHash("sha256");
  for (const f of patchFiles(m)) h.update(`patch:${path.basename(f)}\0`).update(fs.readFileSync(f));
  for (const f of walk(m.overlayDir)) h.update(`overlay:${f}\0`).update(fs.readFileSync(path.join(m.overlayDir, f)));
  return h.digest("hex");
}

function hasCommit(repo, sha) {
  try { sh(`git -C "${repo}" cat-file -e ${sha}^{commit}`); return true; } catch { return false; }
}

// Where to `git archive` from: the local mirror if it has the commit, else a shallow fetch of just that commit.
function sourceRepo(m) {
  const { repo, commit, local_mirror } = m.upstream;
  if (local_mirror && fs.existsSync(local_mirror) && hasCommit(local_mirror, commit)) return { git: local_mirror, how: `local mirror ${local_mirror}` };
  const bare = path.join(m.dir, "work", "upstream.git");
  if (!fs.existsSync(bare)) sh(`git init -q --bare "${bare}"`);
  if (!hasCommit(bare, commit)) {
    log(`fetching ${commit.slice(0, 9)} from ${repo} (shallow)`);
    sh(`git -C "${bare}" fetch -q --depth 1 "${repo}" ${commit}`, { stdio: "inherit" });
  }
  return { git: bare, how: `shallow clone ${repo} -> ${path.relative(ROOT, bare)}` };
}

function hashTracked(dir, files) {
  const out = {};
  for (const f of files) { const p = path.join(dir, f); out[f] = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null; }
  return out;
}

export function fetchUpstream(m, { force = false } = {}) {
  if (!m.upstream) { log(`${m.name}: no upstream (nothing to fetch)`); return; }
  const { commit, subdir = "" } = m.upstream;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${m.name}: upstream.commit must be a full 40-char SHA`);
  const pin = readJson(path.join(m.workdir, PIN));
  if (pin && !force && pin.commit === commit && pin.customization_digest === customizationDigest(m)) {
    log(`${m.name}: ${path.relative(ROOT, m.workdir)} already at ${commit.slice(0, 9)} (use --force to re-export)`);
    return;
  }
  if (fs.existsSync(m.workdir) && !force) throw new Error(`${m.workdir} exists but doesn't match the pin; re-run with --force to replace it`);
  const src = sourceRepo(m);
  const treeish = subdir ? `${commit}:${subdir}` : commit;
  const tree = sh(`git -C "${src.git}" rev-parse ${subdir ? treeish : `${commit}^{tree}`}`).trim();
  const tmp = `${m.workdir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  log(`exporting ${treeish} (${src.how})`);
  sh(`git -C "${src.git}" archive --format=tar ${treeish} | tar -x -C "${tmp}"`);
  const tracked = sh(`git -C "${src.git}" ls-tree -r --name-only ${treeish}`).split("\n").filter(Boolean);
  for (const p of patchFiles(m)) {
    log(`applying ${path.relative(m.dir, p)}`);
    const r = spawnSync("patch", ["-p1", "--forward", "--batch", "--no-backup-if-mismatch", "-i", p], { cwd: tmp, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`patch failed: ${path.basename(p)}\n${r.stdout}${r.stderr}\n(the upstream file probably changed: refresh the patch)`);
  }
  if (m.overlayDir && fs.existsSync(m.overlayDir)) { log(`copying overlay ${path.relative(m.dir, m.overlayDir)}/`); fs.cpSync(m.overlayDir, tmp, { recursive: true }); }
  const files = [...new Set([...tracked, ...walk(m.overlayDir)])].sort();
  fs.writeFileSync(path.join(tmp, FILES), JSON.stringify(hashTracked(tmp, files)));
  fs.writeFileSync(path.join(tmp, PIN), JSON.stringify({
    plugin: m.name, repo: m.upstream.repo, commit, subdir, tree, source: src.how,
    patches: patchFiles(m).map((p) => ({ file: path.basename(p), sha256: sha256(fs.readFileSync(p)) })),
    customization_digest: customizationDigest(m), fetched_at: isoLocal(),
  }, null, 2));
  // keep installed deps/build output from the old copy? No: a clean export is the point. Swap atomically.
  if (fs.existsSync(m.workdir)) fs.rmSync(m.workdir, { recursive: true, force: true });
  fs.renameSync(tmp, m.workdir);
  log(`${m.name}: ${path.relative(ROOT, m.workdir)} = ${commit.slice(0, 9)} + ${patchFiles(m).length} patch(es)`);
}

function run(cmd, cwd, env, logFile) {
  fs.appendFileSync(logFile, `# ${isoLocal()} start: ${cmd}\n`);
  log(`$ ${cmd}   (cwd ${path.relative(ROOT, cwd) || "."}, log ${path.relative(ROOT, logFile)})`);
  const fd = fs.openSync(logFile, "a");
  const r = spawnSync("bash", ["-c", cmd], { cwd, env, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  fs.appendFileSync(logFile, `# ${isoLocal()} exit ${r.status}: ${cmd}\n`);
  if (r.status !== 0) throw new Error(`command failed (exit ${r.status}): ${cmd}\nsee ${logFile}`);
}

const RUNTIME = ".mockshop-runtime.json";

// Edition the current runtime was built as (null: not built, or built before editions existed).
export const builtEdition = (m) => (m.runtimeDir && readJson(path.join(m.runtimeDir, RUNTIME))?.edition) || null;

// Hash every file in a runtime dir (symlinks hashed by their target string). Skips runtime-written paths.
function hashTree(dir, skip = []) {
  const files = {};
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (rel === RUNTIME || skip.some((s) => rel === s.replace(/\/$/, "") || rel.startsWith(s))) continue;
      if (e.isSymbolicLink()) files[rel] = "link:" + fs.readlinkSync(p);
      else if (e.isDirectory()) visit(p);
      else files[rel] = sha256(fs.readFileSync(p));
    }
  };
  visit(dir);
  return files;
}
const totalDigest = (files) => sha256(Object.keys(files).sort().map((f) => `${f}\0${files[f]}\n`).join(""));
const duBytes = (dir) => { try { return Number(sh(`du -sb "${dir}"`).split(/\s/)[0]); } catch { return null; } };
const mb = (b) => (b == null ? "?" : `${(b / 1048576).toFixed(0)} MB`);

// build = fetch pinned source into workdir -> install -> build -> assemble runtime/ -> delete work/ (unless keepWork)
export function build(m, { keepWork = m.build?.keep_work ?? false, updatePin = false } = {}) {
  if (!m.build) { log(`${m.name}: no build step`); return; }
  if (!updatePin && !keepWork && restorePin(m)) return;
  if (m.kind === "captured-frontend") {
    const result = spawnSync(process.execPath, [path.resolve(m.dir, m.build.capture || "capture.mjs"), ...(updatePin ? ["--update-pin"] : [])], { cwd: m.dir, env: process.env, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${m.name}: capture failed (exit ${result.status})`);
    // Captures may refresh the manifest digest (HTML CSP nonces change).
    seedPin(loadPlugin(m.name));
    return;
  }
  ensureToolchain(m);
  const workRoot = path.dirname(m.workdir);
  if (m.upstream) {
    const pin = readJson(path.join(m.workdir, PIN));
    const fresh = pin && pin.commit === m.upstream.commit && pin.customization_digest === customizationDigest(m);
    fetchUpstream(m, { force: !fresh });
  }
  fs.mkdirSync(m.logsDir, { recursive: true });
  const env = toolchainEnv(m, m.build.env || {});
  const installEnv = toolchainEnv(m);
  const t0 = Date.now();
  const logFile = path.join(m.logsDir, "build.log");
  fs.writeFileSync(logFile, `# ${isoLocal()} build ${m.name}\n`);
  if (m.build.install && !fs.existsSync(path.join(m.workdir, "node_modules"))) run(m.build.install, m.workdir, installEnv, logFile);
  if (m.build.command) run(m.build.command, m.workdir, env, logFile);
  for (const c of m.build.after || []) run(c, m.workdir, env, logFile);
  const workBytes = duBytes(workRoot);
  if (m.runtime && m.runtimeDir) {
    const tmp = `${m.runtimeDir}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const a of m.runtime.assemble || []) {
      const from = path.join(m.workdir, a.from), to = path.join(tmp, a.to || ".");
      if (!fs.existsSync(from)) throw new Error(`runtime.assemble: ${a.from} not found in build output`);
      fs.mkdirSync(to, { recursive: true });
      sh(`cp -a "${from}/." "${to}/"`); // -a keeps the relative symlinks of bun's node_modules layout
    }
    const pin = readJson(path.join(m.workdir, PIN));
    const ver = (cmd) => { try { return sh(cmd, { env: installEnv }).trim(); } catch { return null; } };
    const buildIdFile = path.join(tmp, ".next", "BUILD_ID");
    const files = hashTree(tmp, m.runtime.runtime_written || []);
    fs.writeFileSync(path.join(tmp, RUNTIME), JSON.stringify({
      plugin: m.name, ...(m.edition ? { edition: m.edition } : {}),
      repo: pin?.repo ?? null, commit: pin?.commit ?? null, tree: pin?.tree ?? null,
      customization_digest: pin?.customization_digest ?? null, patches: pin?.patches ?? [],
      source_files_digest: totalDigest(readJson(path.join(m.workdir, FILES)) || {}),
      node: ver("node --version"), bun: ver("bun --version"),
      build_id: fs.existsSync(buildIdFile) ? fs.readFileSync(buildIdFile, "utf8").trim() : null,
      built_at: isoLocal(), build_seconds: Math.round((Date.now() - t0) / 1000),
      runtime_written: m.runtime.runtime_written || [],
      file_count: Object.keys(files).length, total_sha256: totalDigest(files), files,
    }, null, 1));
    fs.rmSync(m.runtimeDir, { recursive: true, force: true });
    fs.renameSync(tmp, m.runtimeDir);
    log(`${m.name}: runtime assembled at ${path.relative(ROOT, m.runtimeDir)}/ (${Object.keys(files).length} files, ${mb(duBytes(m.runtimeDir))})`);
  }
  if (!keepWork) {
    fs.rmSync(workRoot, { recursive: true, force: true });
    log(`${m.name}: deleted build dir ${path.relative(ROOT, workRoot)}/ (${mb(workBytes)}); use --keep-work to keep it`);
  }
  log(`${m.name}: build ok in ${Math.round((Date.now() - t0) / 1000)}s`);
  seedPin(m);
}

// Returns { ok, problems, info, runtime }. Problems mean "what would run is not what the manifest pins".
export function verify(m) {
  const problems = [], info = [];
  if (m.kind === "captured-frontend") {
    const file = path.join(m.runtimeDir, "manifest.json");
    const rt = readJson(file);
    if (!rt) problems.push(`not captured: run ./mockshop build ${m.name}`);
    else {
      const pin = m.pin ?? m.synora;
      const version = pin?.version ?? pin?.portal ?? pin?.shell;
      if (String(rt.buildVersion) !== String(version)) problems.push(`captured build ${rt.buildVersion} differs from pin ${version}`);
      if (sha256(fs.readFileSync(file)) !== pin?.manifest_sha256) problems.push("capture manifest differs from pin");
      for (const [app, expected] of Object.entries(pin?.apps || {})) {
        const actual = rt.apps?.[app];
        if (actual?.entry !== expected.entry || actual?.sha256 !== expected.sha256) problems.push(`app drift ${app} ${expected.entry}→${actual?.entry ?? "missing"}`);
      }
      for (const asset of Object.values(rt.assets || {})) {
        const p = path.join(m.runtimeDir, asset.file);
        if (!fs.existsSync(p) || sha256(fs.readFileSync(p)) !== asset.sha256) problems.push(`captured asset changed or missing: ${asset.file}`);
      }
      info.push(`captured build ${rt.buildVersion}, ${Object.keys(rt.assets || {}).length} assets`);
    }
    return { ok: !problems.length, problems, info, runtime: rt };
  }
  if (!m.runtimeDir) return { ok: true, problems, info: ["no runtime artifact configured"] };
  const rt = readJson(path.join(m.runtimeDir, RUNTIME));
  if (!fs.existsSync(m.runtimeDir)) problems.push(`not built: run ./mockshop build ${m.name}`);
  else if (!rt) problems.push(`${path.relative(ROOT, m.runtimeDir)}/ has no ${RUNTIME} (not assembled by build): run ./mockshop build ${m.name}`);
  else {
    if (m.upstream && rt.commit !== m.upstream.commit) problems.push(`runtime was built from ${String(rt.commit).slice(0, 9)} but manifest pins ${m.upstream.commit.slice(0, 9)}: run ./mockshop build ${m.name}`);
    if (rt.customization_digest !== customizationDigest(m)) problems.push(`patches/overlay changed since the runtime was built: run ./mockshop build ${m.name}`);
    if (m.editions) {
      if (!rt.edition) info.push("edition unknown (built before editions)");
      else if (rt.edition !== m.edition) problems.push(`runtime is ${rt.edition}, selected edition is ${m.edition}: run ./mockshop build ${m.name} --${m.edition} (or set MOCKSHOP_${m.name.toUpperCase()}_EDITION=${rt.edition})`);
      else info.push(`edition: ${rt.edition} (selected via ${m.editionSource})`);
    }
    if (m.toolchain?.node && rt.node !== `v${m.toolchain.node}`) problems.push(`runtime built with Node ${rt.node}, manifest says ${m.toolchain.node}`);
    if (m.toolchain?.bun && rt.bun !== m.toolchain.bun) info.push(`built with bun ${rt.bun}, manifest says ${m.toolchain.bun}`);
    const now = hashTree(m.runtimeDir, rt.runtime_written || []);
    const changed = Object.keys(rt.files).filter((f) => now[f] !== rt.files[f]);
    const added = Object.keys(now).filter((f) => !(f in rt.files));
    if (changed.length) problems.push(`${changed.length} runtime file(s) changed or missing since build (e.g. ${changed.slice(0, 3).join(", ")})`);
    if (added.length) problems.push(`${added.length} unexpected file(s) added to the runtime (e.g. ${added.slice(0, 3).join(", ")})`);
    if (!changed.length && !added.length) info.push(`${rt.file_count} runtime files match (sha256 ${rt.total_sha256.slice(0, 12)}…), build ${rt.build_id}`);
  }
  if (fs.existsSync(m.workdir)) info.push(`build dir kept: ${path.relative(ROOT, path.dirname(m.workdir))}/ (${mb(duBytes(path.dirname(m.workdir)))}); safe to delete`);
  const mirror = m.upstream?.local_mirror;
  if (mirror && fs.existsSync(mirror)) {
    try { const head = sh(`git -C "${mirror}" rev-parse HEAD`).trim(); if (head !== m.upstream.commit) info.push(`local mirror HEAD is ${head.slice(0, 9)} (≠ pin ${m.upstream.commit.slice(0, 9)}); the pin is unaffected`); } catch {}
  }
  return { ok: problems.length === 0, problems, info, runtime: rt };
}
