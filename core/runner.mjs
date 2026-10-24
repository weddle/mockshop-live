// Mockshop script runner (Playwright): <plugin>/scripts/*.yaml -> out/<plugin>/<script>/NN-<shot>.png + report.json
// Clip mode (runScripts(..., {clip:true})): same steps, human pacing, cursor overlay, CDP screencast -> MP4
// at out/<plugin>/clips/<script>.mp4 (see core/clip.mjs).
import fs from "node:fs";
import path from "node:path";
import { routeCaptured } from "./captured.mjs";
import { chromium } from "playwright-core";
import { isoLocal } from "./time.mjs";
import { resolveLocale } from "./locale.mjs";
import { cardInit, Recorder, showCard, encodeClip, clipType, freezeFrame, fadeFrom, fadeOut } from "./clip.mjs";
import { mergeCursor, resolveLook, installCursorOverlay, glideTo } from "./cursor.mjs";
import { attachDomRecorder, writeDomRecording, buildReplayHtml, inlineStylesheets } from "./dom.mjs";
import { META_KEYS, Timeline } from "./timeline.mjs";
import { prepareScript, resolveScriptName } from "./script.mjs";
import { stepPresentation } from "./presentation.mjs";
import { stateReader } from "./state-api.mjs";
import { assertState, checkStep, snapshot } from "./state-assert.mjs";

const CHROME = process.env.CHROME_PATH || ["/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A locator spec can be a string (text) or an object.
function loc(page, spec) {
  if (typeof spec === "string") return page.getByText(spec, { exact: false }).filter({ visible: true }).first();
  let l;
  if (spec.testid) l = page.getByTestId(spec.testid);
  else if (spec.role) l = page.getByRole(spec.role, spec.name ? { name: spec.name, exact: !!spec.exact } : {});
  else if (spec.placeholder) l = page.getByPlaceholder(spec.placeholder);
  else if (spec.label) l = page.getByLabel(spec.label);
  else if (spec.selector) l = page.locator(spec.selector);
  else if (spec.text) l = page.getByText(spec.text, { exact: !!spec.exact });
  else throw new Error(`bad locator: ${JSON.stringify(spec)}`);
  if (spec.has_text) l = l.filter({ hasText: spec.has_text });
  if (!spec.selector && !spec.any_visibility) l = l.filter({ visible: true });
  return spec.nth !== undefined ? l.nth(spec.nth) : spec.last ? l.last() : l.first();
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const rectOf = (b) => [b.x, b.y, b.width, b.height];
const centerOf = (b) => [b.x + b.width / 2, b.y + b.height / 2];
const insideBox = ([x, y], b) => !!b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;

// Runs in the element's own frame: true when the element's centre is not on screen (clipped by an overflow
// ancestor or outside the viewport) or less than half of it is.
function needsScroll(el) {
  const doc = el.ownerDocument, win = doc.defaultView, r = el.getBoundingClientRect();
  let { left, top, right, bottom } = r;
  for (let n = el.parentElement; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
    const o = win.getComputedStyle(n);
    if (o.overflowX === "visible" && o.overflowY === "visible") continue;
    const p = n.getBoundingClientRect();
    left = Math.max(left, p.left); top = Math.max(top, p.top); right = Math.min(right, p.right); bottom = Math.min(bottom, p.bottom);
  }
  left = Math.max(left, 0); top = Math.max(top, 0); right = Math.min(right, win.innerWidth); bottom = Math.min(bottom, win.innerHeight);
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  return cx < left || cx > right || cy < top || cy > bottom || Math.max(0, right - left) * Math.max(0, bottom - top) < 0.5 * r.width * r.height;
}

// Runs in the page: the visible [x, y, w, h] of the largest scrollable element under the viewport centre (the document
// itself when it scrolls), or null. Never the sidebar: it does not contain the centre.
function mainScrollArea() {
  const scrolls = (n) => n.scrollHeight > n.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY);
  let best = null, bestArea = 0;
  for (const n of document.elementsFromPoint(innerWidth / 2, innerHeight / 2)) {
    if (n === document.body) continue;
    const root = n === document.documentElement;
    if (!(root ? document.scrollingElement.scrollHeight > innerHeight + 1 && getComputedStyle(n).overflowY !== "hidden" : scrolls(n))) continue;
    const r = root ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : n.getBoundingClientRect();
    const left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    const area = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (area > bestArea) { best = [left, top, right - left, bottom - top]; bestArea = area; }
  }
  return best;
}

// Click an actual visible fragment, not the union-box gap of a wrapped inline link.
// Overlay links / wrappers above that point still receive a real mouse click.
// Clip mode first scrolls an off-screen target into view smoothly, then glides the cursor there (config `cur`);
// screenshot mode just records the pointer position. onDown() runs at mousedown (the timeline's click_ms).
async function userClick(page, l, clip, cur, cs, onDown) {
  await l.waitFor({ state: "visible", timeout: 10000 });
  if (!clip) await l.scrollIntoViewIfNeeded().catch(() => {});
  else if (await l.evaluate(needsScroll).catch(() => false)) {
    await l.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })).catch(() => {});
    await page.waitForTimeout(700);
    // The animation can outlast the wait on a long scroll: measure only once the target has stopped moving.
    for (let k = 0, y = (await l.boundingBox())?.y; k < 10; k++) { await page.waitForTimeout(100); const now = (await l.boundingBox())?.y; if (now === y) break; y = now; }
  }
  let b = await l.boundingBox();
  if (!b) { onDown?.(); return l.click({ timeout: 5000 }); }
  const fragment = await l.evaluate((el) => {
    const union = el.getBoundingClientRect();
    for (const r of el.getClientRects()) {
      const left = Math.max(0, r.left), top = Math.max(0, r.top);
      const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
      if (right > left && bottom > top) return { x: left - union.left, y: top - union.top, width: right - left, height: bottom - top };
    }
    return null;
  });
  // Playwright's box is main-frame relative; fragment offsets preserve iframe coordinates.
  if (fragment) b = { x: b.x + fragment.x, y: b.y + fragment.y, width: fragment.width, height: fragment.height };
  const [x, y] = centerOf(b);
  if (clip) { await glideTo(page, cur, cs, x, y, rectOf(b)); await page.waitForTimeout(cur.pre_click_ms ?? clip.pre_click_ms); }
  else cs.pos = [x, y];
  if (clip) { await page.mouse.move(x, y); await page.mouse.down(); onDown?.(); await page.waitForTimeout(90); await page.mouse.up(); }
  else { onDown?.(); await page.mouse.click(x, y); }
}

// Wheel-scroll `by` px at the pointer. Clip mode first glides the pointer to `at` (a locator) or, by default, to the
// main content area (never the sidebar), so the viewer sees what scrolls. Shot mode: `at` moves the pointer, else 60% across.
async function wheelScroll(page, by, at, clip, cur, cs, [w, h]) {
  if (!clip && at === undefined) { await page.mouse.move(w * 0.6, h / 2); await page.mouse.wheel(0, by); return; }
  let box = null;
  if (at !== undefined) {
    const l = loc(page, at);
    await l.waitFor({ state: "visible", timeout: 10000 });
    const b = await l.boundingBox();
    if (!b) throw new Error("scroll at: target has no box");
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    box = { x, y, width: Math.max(1, Math.min(w, b.x + b.width) - x), height: Math.max(1, Math.min(h, b.y + b.height) - y) };
  } else {
    const area = await page.evaluate(mainScrollArea);
    if (area) box = { x: area[0], y: area[1], width: area[2], height: area[3] };
  }
  const [x, y] = box ? centerOf(box) : [w * 0.6, h / 2];
  if (!clip) { await page.mouse.move(x, y); cs.pos = [x, y]; await page.mouse.wheel(0, by); return; }
  if (insideBox(cs.pos, box)) await page.mouse.move(...cs.pos); else await glideTo(page, cur, cs, x, y, box ? rectOf(box) : null);
  await page.waitForTimeout(200);
  const n = Math.max(6, Math.round(Math.abs(by) / 40)); // smooth wheel in small increments
  for (let k = 0; k < n; k++) { await page.mouse.wheel(0, by / n); await page.waitForTimeout(25); }
}

const MIME = { ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".html": "text/html", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

// `upload` files -> Playwright file payloads: `text` becomes an in-memory buffer, `path` is read relative to `dir` (the script's folder).
export function uploadPayloads(files, dir) {
  return files.map((f) => {
    const name = f.name ?? path.basename(f.path);
    const buffer = f.text !== undefined ? Buffer.from(f.text) : fs.readFileSync(path.resolve(dir, f.path));
    return { name, mimeType: MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream", buffer };
  });
}

// Ordered cursor waypoints ([x, y] or locator) for one `type` step. Clip: real glides; shot: the pointer ends at each.
async function followPath(page, points, clip, cur, cs) {
  for (const [k, to] of points.entries()) {
    let x, y, rect = null;
    if (Array.isArray(to)) [x, y] = to;
    else { const b = await loc(page, to).boundingBox(); if (!b) throw new Error(`cursor_path[${k}]: target has no box`); [x, y] = centerOf(b); rect = rectOf(b); }
    if (clip) await glideTo(page, cur, cs, x, y, rect); else { await page.mouse.move(x, y); cs.pos = [x, y]; }
  }
}

// Await every concurrent part of one step, then report the first failure (in argument order).
async function together(...parts) {
  const failed = (await Promise.allSettled(parts)).find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}

// Runs in the element's own frame: move its native scroller (the element itself, else the nearest scrollable
// ancestor, else that frame's document) to the top or bottom edge.
function scrollEdge(el, { edge, behavior }) {
  const doc = el.ownerDocument, root = (n) => n === doc.body || n === doc.documentElement;
  const scrolls = (n) => n.scrollHeight > n.clientHeight && /(auto|scroll|overlay)/.test(doc.defaultView.getComputedStyle(n).overflowY);
  let n = el;
  while (n && !root(n) && !scrolls(n)) n = n.parentElement || n.getRootNode().host;
  const box = n && !root(n) ? n : doc.scrollingElement || doc.documentElement;
  box.scrollTo({ top: edge === "top" ? 0 : box.scrollHeight, behavior });
}

async function settle(page, ms = 400, idleTimeout = 8000) {
  await page.waitForLoadState("networkidle", { timeout: idleTimeout }).catch(() => {});
  // wait for common Onyx loaders/skeletons to disappear
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// One take's complete clip file set for a script name under `dir`.
const clipFiles = (dir, name, dom = false) => [".mp4", ".report.json", ".resolved.json", ".timeline.json", ".vtt", ...(dom ? [".rrweb.json", ".replay.html"] : [])].map((ext) => path.join(dir, `${name}${ext}`));
// Final clip outputs for one script name (all under out/<plugin>/clips/).
export const clipOutputs = (m, name, dom = false) => clipFiles(path.join(m.outDir, "clips"), name, dom);

// A run fails on any failed step; a strict run also fails on any unexpected problem. Failed clips are never published.
export const runFailed = (r) => r.strict ? r.problems.length > 0 : r.problems.some((p) => p.startsWith("STEP"));

// Read-only batch preflight, before any server, browser or recording starts. Returns the problems that refuse the batch:
// two requested script files resolving to the same final output (always, even with force, including the same file
// requested twice and world-templated names), and existing final clip outputs (clip mode without force).
export function preflightOutputs(m, files, { clip = false, force = false } = {}) {
  const owners = new Map(), problems = [];
  for (const f of files) {
    const name = resolveScriptName(m, f);
    const out = path.resolve(clip ? clipOutputs(m, name)[0] : path.join(m.outDir, name));
    // Refuse case-only/Unicode-normalization aliases on every host so batches are safe on case-insensitive filesystems.
    const key = out.normalize("NFC").toLowerCase();
    if (owners.has(key)) problems.push(`${out}: written by both ${owners.get(key)} and ${f}`);
    else owners.set(key, f);
    if (clip && !force) problems.push(...clipOutputs(m, name).filter((p) => fs.existsSync(p)).map((p) => `${p}: exists (pass --force to replace it)`));
  }
  return problems;
}

// Run-owned clip staging directories still in use. Best effort: removed if the process exits mid-recording
// (Playwright's Ctrl-C handler closes Chrome and calls process.exit). SIGKILL, a crash or power loss can leave one behind.
const staging = new Set();
let exitCleanup = false;
function holdStage(dir) {
  if (!exitCleanup) { exitCleanup = true; process.on("exit", () => { if (!process.env.MOCKSHOP_KEEP_FRAMES) for (const d of staging) fs.rmSync(d, { recursive: true, force: true }); }); }
  staging.add(dir);
  return () => staging.delete(dir);
}

// Move a complete staged take over the final flat paths. Previous finals move aside into the stage first and are restored
// if any rename fails, so a failed publication leaves the previous set in place. Each rename is atomic; the set is not:
// a concurrent reader can see a mix while this synchronous block runs, and SIGKILL in it can leave the previous files
// under the stage's `previous/`.
function publishClip(stage, staged, finals, force) {
  const existing = finals.filter((p) => fs.existsSync(p));
  if (existing.length && !force) throw new Error(`refusing to overwrite clip output created during recording without force: ${existing.join(", ")}`);
  const previous = path.join(stage, "previous");
  fs.mkdirSync(previous);
  const undo = []; // [from, to] renames that reverse what was done so far
  try {
    for (const p of existing) { const aside = path.join(previous, path.basename(p)); fs.renameSync(p, aside); undo.push([aside, p]); }
    for (const [k, p] of finals.entries()) { fs.renameSync(staged[k], p); undo.push([p, staged[k]]); }
  } catch (e) {
    const stuck = [];
    for (const [from, to] of undo.reverse()) { try { fs.renameSync(from, to); } catch { stuck.push(`${from} -> ${to}`); } }
    throw new Error(`publishing failed (${e.message})${stuck.length ? `; could not restore: ${stuck.join(", ")}` : "; previous output restored"}`);
  }
  fs.rmSync(previous, { recursive: true, force: true });
}

// opts.script: script object instead of a file. opts.steps: (async) iterable of steps instead of sc.steps.
// opts.live: { after(info) } called after every step (used by `mockshop live`, see core/live.mjs).
// Clip mode records every output into a directory this run owns and publishes the complete set over the flat final paths
// only when the run passes (see runFailed). It refuses existing final outputs unless opts.force. A failed run returns
// no shots and `evidence`: the kept stage with its report, resolved script, timeline, MP4 and FAILED-step stills.
export async function runScript(m, file, browser, opts = {}) {
  const sc = await prepareScript(m, file, opts);
  if (!opts.clip) {
    const outDir = path.join(m.outDir, sc.name);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    return record(m, sc, browser, opts, outDir);
  }
  const finals = clipOutputs(m, sc.name, !!opts.dom);
  const existing = finals.filter((p) => fs.existsSync(p));
  if (existing.length && !opts.force) throw new Error(`${sc.name}: refusing to overwrite existing clip output without force: ${existing.join(", ")}`);
  const clips = path.join(m.outDir, "clips");
  fs.mkdirSync(clips, { recursive: true });
  // Other runs' (or kept) directories are never removed.
  const stage = fs.mkdtempSync(path.join(clips, `.${sc.name}-`));
  const release = holdStage(stage);
  const keep = !!process.env.MOCKSHOP_KEEP_FRAMES;
  let r;
  try { r = await record(m, sc, browser, opts, stage); }
  catch (e) { release(); if (!keep) fs.rmSync(stage, { recursive: true, force: true }); throw e; }
  if (!keep) fs.rmSync(path.join(stage, "frames"), { recursive: true, force: true });
  if (runFailed(r)) { release(); return { ...r, shots: [], evidence: stage }; }
  try { publishClip(stage, clipFiles(stage, sc.name, !!opts.dom), finals, opts.force); }
  catch (e) {
    release();
    try {
      const [mp4, reportFile] = clipFiles(stage, sc.name);
      const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
      report.mp4 = mp4;
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    } catch (metadataError) { e = new Error(`${e.message}; could not annotate kept evidence: ${metadataError.message}`); }
    throw new Error(`${sc.name}: ${e.message}; the new take is kept in ${stage}`);
  }
  release();
  if (!keep) fs.rmSync(stage, { recursive: true, force: true });
  return { ...r, shots: [finals[0]] };
}

// Closes the run's browser context (and with it any CDP screencast session) even when a step outside the per-step
// failure handling, encoding or metadata generation throws. Closing an already closed context is a no-op.
async function record(m, sc, browser, opts, outDir) {
  const owned = {};
  try { return await recordSession(m, sc, browser, opts, outDir, owned); }
  finally { await owned.ctx?.close().catch(() => {}); }
}

// Clip mode writes every output as <name>.<ext> in outDir (the run's stage); runScript publishes them.
async function recordSession(m, sc, browser, opts, outDir, owned) {
  const R = m.runner || {};
  const BASE = process.env.MOCKSHOP_URL || R.base_url || `http://127.0.0.1:${m.ports.web}`;
  const MOCK = `http://127.0.0.1:${m.ports.mock}`;
  const strict = sc.strict ?? R.strict ?? false;
  const selector = [...(R.cookies || []), ...(sc.cookies || [])].findLast(c=>c.name===m.localization?.cookie);
  const locale = resolveLocale(m, opts.locale || sc.locale || R.locale || selector?.value);
  const name = sc.name;
  // `upload` file paths resolve against the script's own folder (the working directory for a live script).
  const source = sc._resolved?.source;
  const scriptDir = source && source !== "<live>" ? path.dirname(source) : process.cwd();
  const baseClip = opts.clip ? sc._presentation.clip : null;
  let clip = baseClip;
  fs.writeFileSync(path.join(outDir, clip ? `${name}.resolved.json` : "resolved.json"), JSON.stringify(sc, null, 2));
  // Demo anchor = script/recording start: fixture times ({{ago:2h}}) resolve against it so on-screen
  // relative times are the same on every run. Records below use absolute local ISO times.
  // Fixed anchor (script `demo_anchor`, else manifest runner.demo_anchor) -> identical on-screen times on every run;
  // without one, the anchor is the real start time.
  const startedAt = new Date();
  const anchorSpec = sc.demo_anchor ?? R.demo_anchor ?? null;
  const anchor = anchorSpec ? new Date(anchorSpec) : startedAt;
  const clockOffset = anchor.getTime() - startedAt.getTime();
  if (Number.isNaN(anchor.getTime())) throw new Error(`${name}: bad demo_anchor ${JSON.stringify(anchorSpec)}`);
  // Only an explicitly authored theme reaches the mock (core.state.theme); omitting it clears an earlier one.
  const theme = sc._presentation.authored_theme;
  const reset = await fetch(`${MOCK}/__mockshop/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overlays: sc.overlays || [], resetChats: true, anchor: anchor.toISOString(), locale: locale.code, strict, ...(theme ? { theme } : {}) }) });
  if (!reset.ok) throw new Error(`${name}: mock state reset failed (${reset.status}): ${await reset.text()}`);

  // assert_state / snapshot_state read the mock through its runner-only state API; snapshots live for this run only.
  const readState = stateReader(m), snapshots = new Map();
  // World-owned browser storage (the plugin's `browser` state: local_storage / session_storage, lists of {key, value}), seeded before any page script runs.
  const storage = m.state_api ? await readState("/browser") : undefined;

  const [w, h] = clip?.viewport || sc.viewport || R.viewport || [1440, 900];
  const ctx = owned.ctx = await browser.newContext({ ...(m.kind === "captured-frontend" ? { serviceWorkers: "block" } : {}), viewport: { width: w, height: h }, deviceScaleFactor: sc.scale || 1, colorScheme: sc.theme === "dark" ? "dark" : "light", locale: locale.code, extraHTTPHeaders: { 'Accept-Language': locale.code }, timezoneId: sc.timezone || R.timezone || "America/New_York" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([
    ...(R.cookies || []).map((c) => ({ domain: host, path: "/", ...c })),
    ...(sc.cookies || []).map((c) => ({ domain: host, path: "/", ...c })),
    ...(locale.cookie ? [{domain:host,path:'/',name:locale.cookie,value:locale.appLocale}] : []),
  ]);
  for (const [kind, area] of [["local_storage", "localStorage"], ["session_storage", "sessionStorage"]]) if (storage?.[kind]?.length) await ctx.addInitScript(({ area, items }) => {
    try { for (const { key, value } of items) window[area].setItem(key, value); } catch { /* opaque origins (about:blank) have no storage */ }
  }, { area, items: storage[kind] });
  // No red spell-check squiggles in screenshots.
  await ctx.addInitScript(() => {
    const off = () => document.querySelectorAll("textarea,input,[contenteditable]").forEach((el) => el.setAttribute("spellcheck", "false"));
    document.addEventListener("DOMContentLoaded", () => { off(); new MutationObserver(off).observe(document.documentElement, { subtree: true, childList: true }); });
  });
  // Shift the page's wall clock (Date only; timers, animation frames and performance.now are untouched, so pacing is
  // unchanged) so it reads the demo anchor at script start and runs in real time from there.
  if (anchorSpec) await ctx.addInitScript(({ offset }) => {
    const D = Date, now = () => D.now() + offset;
    function MDate(...a) { if (!new.target) return new D(now()).toString(); return a.length ? new D(...a) : new D(now()); }
    MDate.prototype = D.prototype; MDate.now = now; MDate.parse = D.parse; MDate.UTC = D.UTC;
    Object.defineProperty(D.prototype, "constructor", { value: MDate, writable: true, configurable: true });
    globalThis.Date = MDate;
  }, { offset: clockOffset });
  // Cursor (core/cursor.mjs, docs/cursor.md): clips install it even when initially hidden, so cursor-only
  // steps can enable it later. Screenshots inject only with cursor.screenshots or an explicit cursor step.
  let cur = sc._presentation.cursor;
  const cs = { pos: [w * 0.55, h * 0.6], moves: 0, seed: name };
  const overlay = !!clip || !!opts.live || cur.screenshots || (sc.steps || []).some((s) => isObj(s.shot) && s.shot.cursor !== undefined || s.cursor !== undefined || s._presentation?.scene?.cursor !== undefined || s._presentation?.step?.cursor !== undefined);
  const hiddenNow = (config = cur) => !config.enabled || (!clip && !config.screenshots);
  if (clip) await ctx.addInitScript(cardInit);
  if (overlay) await ctx.addInitScript(installCursorOverlay, { look: resolveLook(cur.look), w, h, follow: !!clip, hidden: hiddenNow() });
  // opts.dom: record the DOM with rrweb (core/dom.mjs) -> <name>.rrweb.json + <name>.replay.html (clips) or
  // dom.rrweb.json + replay.html (screenshots). Chapters come from shots (screenshots) or beats (clips).
  const dom = opts.dom ? await attachDomRecorder(ctx) : null;
  const page = await ctx.newPage();
  const applyCursor = (config) => page.evaluate(({ look, hide }) => {
    window.__msCursorLook?.(look); window.__msCursorHide?.(hide);
  }, { look: resolveLook(config.look), hide: hiddenNow(config) }).catch(() => {});
  const problems = [];
  // Record device pixels (viewport x deviceScaleFactor); cursor, locators and the timeline stay in CSS px.
  const rec = clip ? new Recorder(page, outDir, [w, h].map((v) => Math.round(v * (sc.scale || 1)))) : null;
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const sourceUrl = msg.location().url;
    problems.push(`console: ${msg.text().slice(0, 300)}${sourceUrl ? ` [source: ${sourceUrl}]` : ""}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("favicon")) problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`); });
  // Keep local app and built-in PDF viewer resources; block outbound web noise.
  const allow = ["http://127.0.0.1", "http://localhost", "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/", "chrome://resources/", ...(R.allow_hosts || []).map((h) => `https://${h}`)];
  if (m.kind === "captured-frontend") await routeCaptured(ctx, m, { anchor: anchor.getTime(), clockOffset, mockUrl: MOCK, strict });
  else await page.route(new RegExp(`^(?!${allow.map(escapeRx).join("|")}).*`), (r) => r.abort());

  const shots = [], shotLog = [], beatLog = [];
  const t00 = Date.now();
  const tl = clip || opts.live ? new Timeline({ script: name, plugin: m.name, source: sc._resolved.source, inputs: sc._resolved.inputs, scenes: sc._resolved.scenes, now: clip ? () => rec.videoTime() * 1000 : () => Date.now() - t00, ready: () => !clip || rec.started }) : null;
  let i = 0;
  for await (const step of opts.steps ?? sc.steps ?? []) {
    i++;
    let failure = null;
    // Metadata never becomes an operation; cursor alone remains a precise persistent manual instruction.
    const entries = Object.entries(step).filter(([k]) => !META_KEYS.includes(k));
    if (step.only && step.only !== (clip ? "clip" : "shot")) continue;
    if (dom) { dom.current = { scene: step.scene, step_id: step.author_id || step.id }; if (step.scene && step.scene !== dom.scene) dom.scene_start(step.scene); }
    const [op, arg] = entries.length ? entries[0] : step.cursor !== undefined ? ["cursor", step.cursor] : [Object.keys(step)[0], undefined];
    const settings = stepPresentation(sc, step, cur);
    clip = opts.clip ? settings.clip : null;
    const stepCursor = op === "cursor" ? undefined : step.cursor !== undefined ? step.cursor : isObj(arg) ? arg.cursor : undefined;
    const c = stepCursor === undefined ? settings.cursor : mergeCursor(settings.cursor, stepCursor);
    if (overlay) await applyCursor(c);
    try {
      await tl?.begin({ i, op, arg, step, page, loc: (s) => loc(page, s), cursor: cs, presentation: { ...settings, cursor: c } });
      switch (op) {
        case "goto": {
          // clip: after the first page, crossfade from the old screen and cut the load time
          const fade = clip && rec.started && clip.nav_fade ? await freezeFrame(page) : null;
          if (fade) rec.cutStart();
          await page.goto(BASE + arg, { waitUntil: "domcontentloaded" }); await settle(page, 600);
          if (overlay) await applyCursor(c);
          if (fade) { await fadeFrom(page, fade, clip.nav_fade); rec.cutEnd(); await page.evaluate(([x, y]) => window.__msCursor?.(x, y), cs.pos).catch(() => {}); await fadeOut(page, clip.nav_fade); }
          if (clip) { await page.evaluate(([x, y]) => window.__msCursor?.(x, y), cs.pos).catch(() => {}); if (!rec.started) { await rec.start(); if (clip.title) await showCard(page, clip.title, clip.title_ms); } }
          break;
        }
        case "click":
          if (clip && arg.fade) { // crossfade the state change (e.g. a panel opening) instead of a hard snap
            const l = loc(page, arg);
            await l.waitFor({ state: "visible", timeout: 10000 });
            const b = await l.boundingBox();
            await glideTo(page, c, cs, ...centerOf(b), rectOf(b));
            await page.waitForTimeout(c.pre_click_ms ?? clip.pre_click_ms);
            const still = await freezeFrame(page);
            await fadeFrom(page, still, clip.fade_ms);
            tl?.clickAt();
            await page.mouse.click(cs.pos[0], cs.pos[1], { delay: 90 });
            await page.waitForTimeout(300);           // let the click ripple show
            rec.cutStart(); await settle(page, arg.settle ?? 500); rec.cutEnd();
            await fadeOut(page, clip.fade_ms);
            await page.waitForTimeout(clip.after_click_ms);
            break;
          }
          await userClick(page, loc(page, arg), clip, c, cs, () => tl?.clickAt());
          if (clip) { await settle(page, 150, clip.idle_timeout_ms); await page.waitForTimeout(clip.after_click_ms); } else if (arg.settle !== 0) await settle(page);
          break;
        case "hover": {
          const l = loc(page, arg);
          if (clip) { await l.waitFor({ state: "visible", timeout: 10000 }); const b = await l.boundingBox(); if (b) await glideTo(page, c, cs, ...centerOf(b), rectOf(b)); }
          else { await l.hover({ timeout: 10000 }); const b = await l.boundingBox().catch(() => null); if (b) cs.pos = centerOf(b); }
          await page.waitForTimeout(clip ? clip.hold_ms : 500); break;
        }
        case "move": { // clip-friendly: glide the cursor to a locator, [x, y] or { to: [x, y] } without clicking
          let x, y, rect = null;
          const to = isObj(arg) && arg.to ? arg.to : arg;
          if (Array.isArray(to)) [x, y] = to; else { const b = await loc(page, to).boundingBox(); if (!b) break; [x, y] = centerOf(b); rect = rectOf(b); }
          if (clip) await glideTo(page, c, cs, x, y, rect); else { await page.mouse.move(x, y); cs.pos = [x, y]; }
          if (clip && arg.hold) await page.waitForTimeout(arg.hold);
          break;
        }
        case "cursor": { // Precise manual changes persist; natural scene/step overrides never mutate them.
          cur = mergeCursor(cur, arg);
          if (overlay) await applyCursor(stepPresentation(sc, step, cur).cursor);
          break;
        }
        case "pause": await page.waitForTimeout(clip ? Number(arg) : 0); break;  // pacing beat; no-op for screenshots
        case "card": if (clip) await showCard(page, typeof arg === "string" ? { title: arg } : arg, arg.ms ?? clip.title_ms); break;
        case "fill": await loc(page, arg).fill(arg.value, { timeout: 10000 }); break;
        case "type": {
          const l = loc(page, arg);
          // Clip: a real click on the field first (glide, hover, press) unless the pointer is already on it or `click: false`.
          if (clip && arg.click !== false && !insideBox(cs.pos, await l.boundingBox({ timeout: 10000 }))) { await userClick(page, l, clip, c, cs); await page.waitForTimeout(200); }
          const typing = clip && clip.type_ms !== null && arg.clip_ms !== null
            ? l.focus().then(() => clipType(page, arg.value, clip, arg.clip_ms))
            : l.pressSequentially(arg.value, { delay: clip ? (arg.clip_delay ?? clip.type_delay_ms) : (arg.delay ?? 15) });
          // Still one typing operation; an optional cursor path moves alongside it and both finish before the step does.
          await together(typing, arg.cursor_path ? followPath(page, arg.cursor_path, clip, c, cs) : null);
          if (clip) await page.waitForTimeout(clip.after_type_ms);
          break;
        }
        case "press": await page.keyboard.press(arg); await settle(page, 200); break;
        case "wait":
          if (typeof arg === "number") await page.waitForTimeout(arg);
          else await loc(page, arg).waitFor({ state: arg.state || "visible", timeout: arg.timeout || 20000 });
          break;
        case "wait_gone": await loc(page, arg).waitFor({ state: "hidden", timeout: arg.timeout || 20000 }); break;
        case "settle": if (clip) await settle(page, Math.min(arg || 600, clip.settle_cap_ms), clip.idle_timeout_ms); else await settle(page, arg || 600); break;
        case "eval": await page.evaluate(arg); break;
        case "assert_state": case "snapshot_state": {
          const [problem] = checkStep(op, arg, { known: new Set(snapshots.keys()) });
          if (problem) throw new Error(`${op}${problem.path ? `.${problem.path}` : ""}: ${problem.message}`);
          await (op === "assert_state" ? assertState : snapshot)(arg, readState, snapshots);
          break;
        }
        case "scroll":
          if (isObj(arg) && arg.by === undefined) {
            // Locator: scroll that anchor into view (any frame). `edge`: move the anchor's own native scroller instead.
            if (arg.edge) { await loc(page, arg).evaluate(scrollEdge, { edge: arg.edge, behavior: clip ? "smooth" : "instant" }); if (clip) await page.waitForTimeout(900); }
            else if (clip) { await loc(page, arg).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await page.waitForTimeout(900); }
            else await loc(page, arg).scrollIntoViewIfNeeded();
          } else await wheelScroll(page, Number(isObj(arg) ? arg.by : arg), isObj(arg) ? arg.at : undefined, clip, c, cs, [w, h]);
          await page.waitForTimeout(500);
          break;
        case "upload": { // click the visible control that opens the native file chooser, then hand it the files
          const files = uploadPayloads(arg.files, scriptDir);
          const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
          try { await userClick(page, loc(page, arg.click), clip, c, cs, () => tl?.clickAt()); }
          catch (e) { chooser.catch(() => {}); throw e; }
          await (await chooser).setFiles(files);
          if (clip) { await settle(page, 150, clip.idle_timeout_ms); await page.waitForTimeout(clip.after_click_ms); } else await settle(page);
          break;
        }
        case "shot": {
          const s = typeof arg === "string" ? { name: arg } : arg;
          if (clip) { // a shot is a beat: glide to the hover target (if any) and hold
            if (s.hover) { const b = await loc(page, s.hover).boundingBox().catch(() => null); if (b) await glideTo(page, c, cs, ...centerOf(b), rectOf(b)); }
            const beatT = rec.videoTime();             // read-only: where this beat starts in the video
            await page.waitForTimeout(s.hold ?? clip.hold_ms);
            shots.push(s.name);
            beatLog.push({ beat: s.name, step: i, step_id: step.author_id || step.id, scene: step.scene, origin: step.origin, t_s: beatT, hold_s: (s.hold ?? clip.hold_ms) / 1000 });
            if (s.beat && dom) await dom.cut(page, s.name);
            break;
          }
          await page.mouse.move(s.mouse?.[0] ?? w - 5, s.mouse?.[1] ?? h - 5).catch(() => {});
          let hoverBox = null;
          if (s.hover) { await loc(page, s.hover).hover().catch(() => {}); hoverBox = await loc(page, s.hover).boundingBox().catch(() => null); }
          // Cursor in the still: shown when cursor.screenshots is on or the shot has a `cursor:` object; `cursor: false`
          // hides it. at: locator | [x, y] (default: hover target, else the last click/hover/move point);
          // ripple: true | 0..1 (frozen ripple; the number is how far it has expanded); squish; magnet: true | [x, y, w, h].
          const so = c;
          const showCursor = overlay && c.enabled && stepCursor !== false && (c.screenshots || isObj(stepCursor) || stepCursor === true);
          if (overlay) {
            let at = cs.pos, rect = null;
            if (so.at) { if (Array.isArray(so.at)) at = so.at; else { const b = await loc(page, so.at).boundingBox(); if (b) { at = centerOf(b); rect = rectOf(b); } } }
            else if (hoverBox) { at = centerOf(hoverBox); rect = rectOf(hoverBox); }
            const magnet = Array.isArray(so.magnet) ? so.magnet : so.magnet ? rect ?? [at[0] - 12, at[1] - 12, 24, 24] : null;
            await page.evaluate(({ hide, still }) => { window.__msCursorHide?.(hide); return window.__msStill?.(still); },
              { hide: !showCursor, still: { at, ripple: so.ripple ?? false, squish: so.squish ?? false, magnet } }).catch(() => {});
          }
          await page.waitForTimeout(s.delay ?? 300);
          const f = path.join(outDir, `${String(shots.length + 1).padStart(2, "0")}-${s.name}.png`);
          await page.screenshot({ path: f, fullPage: !!s.full_page, ...(s.clip ? { clip: s.clip } : {}) });
          if (overlay) {
            await page.evaluate((hide) => { window.__msStill?.(null); window.__msCursorHide?.(hide); }, hiddenNow(c)).catch(() => {});
          }
          shotLog.push({ shot: path.basename(f), at: isoLocal(), step_id: step.author_id || step.id, scene: step.scene, origin: step.origin });
          if (s.beat && dom) await dom.cut(page, s.name);
          for (const t of R.crash_text || []) if (await page.getByText(t).count()) problems.push(`STEP ${i} shot ${s.name}: APP CRASHED ("${t}"): a fixture shape is likely wrong`);
          shots.push(f);
          break;
        }
        case "mark": case "keyframe": tl?.mark(arg, i, op); if (dom) await dom.cut(page, typeof arg === "string" ? arg : arg.name); break;  // no browser action
        case "state": { // Fixture, armed-turn, and screen state retain the current session unless explicitly reset.
          const { cursor: _cursor, ...state } = arg;
          // A fresh in-script reset clears mutable state, not the script's selected world.
          // Explicit overlay changes still win; keep-only switches retain the server's current selection.
          const overlays = state.overlays ?? (state.keep === false ? sc.overlays || [] : undefined);
          // Likewise a fresh reset re-sends the script's authored theme; keep-only switches retain the server's.
          const theme = state.keep === false ? sc._presentation.authored_theme : undefined;
          const r = await fetch(`${MOCK}/__mockshop/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state, overlays, theme, url: page.url(), keep: state.keep ?? true, resetChats: state.resetChats ?? false }) });
          if (!r.ok) throw new Error(`mock state switch failed (${r.status})`);
          break;
        }
        default: throw new Error(`unknown step op "${op}"`);
      }
    } catch (e) {
      failure = e;
      const f = path.join(outDir, `FAILED-step${i}-${op}.png`);
      await page.screenshot({ path: f }).catch(() => {});
      problems.push(`STEP ${i} ${op} ${JSON.stringify(arg)} failed: ${e.message.split("\n")[0]}`);
    }
    if (overlay) await applyCursor(stepPresentation(sc, step, cur, { includeStep: false }).cursor);
    await tl?.end(failure);
    await opts.live?.after({ i, op, arg, step, page, shots, outDir, problems, error: failure, timeline: tl });
    if (failure && !sc.continue_on_error) break;
  }
  clip = baseClip;
  if (overlay) await applyCursor(cur);
  // SSR misses may be swallowed by the front end without any browser response error.
  // Read only this script's server-side misses, never historical log lines.
  if (strict) {
    const response = await fetch(`${MOCK}/__mockshop/state`);
    if (!response.ok) problems.push(`mock strict state failed (${response.status})`);
    else problems.push(...(await response.json()).strict_misses);
  }
  // Known errors (manifest runner.known_errors + script known_errors): matched problems are reported apart and never fail strict.
  const { unexpected, known } = splitKnown(problems, [...(R.known_errors || []), ...(sc.known_errors || [])]);
  problems.length = 0; problems.push(...unexpected);
  const writeDom = async (base) => {
    if (!dom) return;
    await page.waitForTimeout(250); // let the last emitted events cross the binding
    for (const g of dom.segments) await inlineStylesheets(g.events, (u) => page.request.get(u).then((r) => (r.ok() ? r.text() : null)));
    const recording = writeDomRecording(dom, `${base}.rrweb.json`, { viewport: [w, h], cursor: resolveLook(cur.look), script: name, title: sc.title || name });
    fs.writeFileSync(`${base}.replay.html`, buildReplayHtml(recording));
  };
  if (clip) {
    await page.waitForTimeout(clip.end_hold_ms);
    await rec.stop();
    await writeDom(path.join(outDir, name));
    await ctx.close();
    const mp4 = path.join(outDir, `${name}.mp4`);
    const info = await encodeClip(rec, mp4, clip);
    tl.write(path.join(outDir, name), { clip: path.basename(mp4), duration_ms: Math.round(info.duration_s * 1000), viewport: [w, h] });
    // The report names the MP4 where it will be read: the published flat path, or the kept stage of a failed take.
    const reported = runFailed({ strict, problems }) ? mp4 : path.join(m.outDir, "clips", `${name}.mp4`);
    fs.writeFileSync(path.join(outDir, `${name}.report.json`), JSON.stringify({
      script: name, locale: locale.code, mp4: reported, recorded_at: isoLocal(startedAt), finished_at: isoLocal(), demo_anchor: isoLocal(anchor, { ms: !anchorSpec }),
      ...info, beats: shots, beat_times: beatLog, time_note: "beat_times[].t_s = seconds from the start of the video", problems, known_problems: known }, null, 2));
    return { name, problems, known, info, strict };
  }
  await writeDom(path.join(outDir, "dom"));
  await ctx.close();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({
    script: name, locale: locale.code, started_at: isoLocal(startedAt), finished_at: isoLocal(), demo_anchor: isoLocal(anchor, { ms: !anchorSpec }),
    shots, shot_times: shotLog, problems, known_problems: known }, null, 2));
  return { name, shots, problems, known, strict };
}


// Split runner problems by a known-error allowlist [{match, reason}]. `match` is a substring, or /regex/flags.
// Failed steps (STEP ...) are never allowlisted. Returns { unexpected: [string], known: [{problem, reason}] }.
export function splitKnown(problems, list = []) {
  const rx = list.map((k) => { const r = /^\/(.*)\/([a-z]*)$/.exec(k.match); return { test: r ? (p) => new RegExp(r[1], r[2]).test(p) : (p) => p.includes(k.match), reason: k.reason }; });
  const unexpected = [], known = [];
  for (const p of problems) {
    const hit = !p.startsWith("STEP") && rx.find((k) => k.test(p));
    if (hit) known.push({ problem: p, reason: hit.reason }); else unexpected.push(p);
  }
  return { unexpected, known };
}

export async function launchBrowser() {
  if (!CHROME) throw new Error("no Chrome/Chromium found; set CHROME_PATH");
  return chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--disable-spell-checking"] });
}

// Run script files for one plugin; returns the number of failed scripts (runFailed).
export async function runScripts(m, files, opts = {}) {
  // Preflight the whole set so a mixed target list can never partly overwrite earlier output.
  const conflicts = preflightOutputs(m, files, opts);
  if (conflicts.length) throw new Error(`refusing to run ${m.name}:\n  ${conflicts.join("\n  ")}`);
  const browser = await launchBrowser();
  let failed = 0;
  try {
    for (const f of files) {
      const t0 = Date.now();
      const r = await runScript(m, f, browser, opts);
      const stepFail = runFailed(r);
      if (stepFail) failed++;
      const took = `in ${((Date.now() - t0) / 1000).toFixed(1)}s`;
      if (r.evidence) console.log(`✗ ${m.name}/${r.name}: clip not published (existing output unchanged) ${took}; failed take kept in ${r.evidence}/`);
      else if (r.info) console.log(`${stepFail ? "✗" : "✓"} ${m.name}/${r.name}: clip ${r.info.duration_s.toFixed(1)}s (${r.info.frames} frames) ${took} -> ${r.shots[0]}`);
      else console.log(`${stepFail ? "✗" : "✓"} ${m.name}/${r.name}: ${r.shots.length} shot(s) ${took} -> ${path.join(m.outDir, r.name)}/`);
      for (const p of r.problems) console.log(`    ${p}`);
      for (const k of r.known || []) console.log(`    · known (${k.reason}): ${k.problem}`);
    }
  } finally { await browser.close(); }
  return failed;
}
