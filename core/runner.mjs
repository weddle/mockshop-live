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
import { META_KEYS, Timeline } from "./timeline.mjs";
import { prepareScript } from "./script.mjs";
import { stepPresentation } from "./presentation.mjs";

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

// Click an actual visible fragment, not the union-box gap of a wrapped inline link.
// Overlay links / wrappers above that point still receive a real mouse click.
// Clip mode glides the cursor there first (config `cur`); screenshot mode just records the pointer position.
async function userClick(page, l, clip, cur, cs) {
  await l.waitFor({ state: "visible", timeout: 10000 });
  await l.scrollIntoViewIfNeeded().catch(() => {});
  let b = await l.boundingBox();
  if (!b) return l.click({ timeout: 5000 });
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
  await page.mouse.click(x, y, clip ? { delay: 90 } : {});
}

async function settle(page, ms = 400, idleTimeout = 8000) {
  await page.waitForLoadState("networkidle", { timeout: idleTimeout }).catch(() => {});
  // wait for common Onyx loaders/skeletons to disappear
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .animate-pulse'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// opts.script: script object instead of a file. opts.steps: (async) iterable of steps instead of sc.steps.
// opts.live: { after(info) } called after every step (used by `mockshop live`, see core/live.mjs).
export async function runScript(m, file, browser, opts = {}) {
  const R = m.runner || {};
  const BASE = process.env.MOCKSHOP_URL || R.base_url || `http://127.0.0.1:${m.ports.web}`;
  const MOCK = `http://127.0.0.1:${m.ports.mock}`;
  const sc = await prepareScript(m, file, opts);
  const strict = sc.strict ?? R.strict ?? false;
  const selector = [...(R.cookies || []), ...(sc.cookies || [])].findLast(c=>c.name===m.localization?.cookie);
  const locale = resolveLocale(m, opts.locale || sc.locale || R.locale || selector?.value);
  const name = sc.name;
  const baseClip = opts.clip ? sc._presentation.clip : null;
  let clip = baseClip;
  const outDir = clip ? path.join(m.outDir, "clips", `.${name}`) : path.join(m.outDir, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(clip ? path.join(m.outDir, "clips", `${name}.resolved.json`) : path.join(outDir, "resolved.json"), JSON.stringify(sc, null, 2));
  // Demo anchor = script/recording start: fixture times ({{ago:2h}}) resolve against it so on-screen
  // relative times are the same on every run. Records below use absolute local ISO times.
  // Fixed anchor (script `demo_anchor`, else manifest runner.demo_anchor) -> identical on-screen times on every run;
  // without one, the anchor is the real start time.
  const startedAt = new Date();
  const anchorSpec = sc.demo_anchor ?? R.demo_anchor ?? null;
  const anchor = anchorSpec ? new Date(anchorSpec) : startedAt;
  const clockOffset = anchor.getTime() - startedAt.getTime();
  if (Number.isNaN(anchor.getTime())) throw new Error(`${name}: bad demo_anchor ${JSON.stringify(anchorSpec)}`);
  const reset = await fetch(`${MOCK}/__mockshop/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ overlays: sc.overlays || [], resetChats: true, anchor: anchor.toISOString(), locale: locale.code, strict }) });
  if (!reset.ok) throw new Error(`${name}: mock state reset failed (${reset.status}): ${await reset.text()}`);

  const [w, h] = clip?.viewport || sc.viewport || R.viewport || [1440, 900];
  const ctx = await browser.newContext({ ...(m.kind === "captured-frontend" ? { serviceWorkers: "block" } : {}), viewport: { width: w, height: h }, deviceScaleFactor: sc.scale || 1, colorScheme: sc.theme === "dark" ? "dark" : "light", locale: locale.code, extraHTTPHeaders: { 'Accept-Language': locale.code }, timezoneId: sc.timezone || R.timezone || "America/New_York" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([
    ...(R.cookies || []).map((c) => ({ domain: host, path: "/", ...c })),
    ...(sc.cookies || []).map((c) => ({ domain: host, path: "/", ...c })),
    ...(locale.cookie ? [{domain:host,path:'/',name:locale.cookie,value:locale.appLocale}] : []),
  ]);
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
  const page = await ctx.newPage();
  const applyCursor = (config) => page.evaluate(({ look, hide }) => {
    window.__msCursorLook?.(look); window.__msCursorHide?.(hide);
  }, { look: resolveLook(config.look), hide: hiddenNow(config) }).catch(() => {});
  const problems = [];
  const rec = clip ? new Recorder(page, outDir, [w, h]) : null;
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
            await page.mouse.click(cs.pos[0], cs.pos[1], { delay: 90 });
            await page.waitForTimeout(300);           // let the click ripple show
            rec.cutStart(); await settle(page, arg.settle ?? 500); rec.cutEnd();
            await fadeOut(page, clip.fade_ms);
            await page.waitForTimeout(clip.after_click_ms);
            break;
          }
          await userClick(page, loc(page, arg), clip, c, cs);
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
          if (clip && clip.type_ms !== null && arg.clip_ms !== null) { await l.focus(); await clipType(page, arg.value, clip, arg.clip_ms); }
          else await l.pressSequentially(arg.value, { delay: clip ? (arg.clip_delay ?? clip.type_delay_ms) : (arg.delay ?? 15) });
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
        case "scroll":
          if (typeof arg === "object" && !Array.isArray(arg)) {
            if (clip) { await loc(page, arg).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await page.waitForTimeout(900); }
            else await loc(page, arg).scrollIntoViewIfNeeded();
          } else if (clip) { // smooth wheel in small increments
            const n = Math.max(6, Math.round(Math.abs(Number(arg)) / 40));
            for (let k = 0; k < n; k++) { await page.mouse.wheel(0, Number(arg) / n); await page.waitForTimeout(25); }
          } else { await page.mouse.move(w * 0.6, h / 2); await page.mouse.wheel(0, Number(arg)); }
          await page.waitForTimeout(500);
          break;
        case "shot": {
          const s = typeof arg === "string" ? { name: arg } : arg;
          if (clip) { // a shot is a beat: glide to the hover target (if any) and hold
            if (s.hover) { const b = await loc(page, s.hover).boundingBox().catch(() => null); if (b) await glideTo(page, c, cs, ...centerOf(b), rectOf(b)); }
            const beatT = rec.videoTime();             // read-only: where this beat starts in the video
            await page.waitForTimeout(s.hold ?? clip.hold_ms);
            shots.push(s.name);
            beatLog.push({ beat: s.name, step: i, step_id: step.author_id || step.id, scene: step.scene, origin: step.origin, t_s: beatT, hold_s: (s.hold ?? clip.hold_ms) / 1000 });
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
          for (const t of R.crash_text || []) if (await page.getByText(t).count()) problems.push(`STEP ${i} shot ${s.name}: APP CRASHED ("${t}"): a fixture shape is likely wrong`);
          shots.push(f);
          break;
        }
        case "mark": case "keyframe": tl?.mark(arg, i, op); break;  // timeline label only; no browser action
        case "state": { // Fixture, armed-turn, and screen state retain the current session unless explicitly reset.
          const { cursor: _cursor, ...state } = arg;
          // A fresh in-script reset clears mutable state, not the script's selected world.
          // Explicit overlay changes still win; keep-only switches retain the server's current selection.
          const overlays = state.overlays ?? (state.keep === false ? sc.overlays || [] : undefined);
          const r = await fetch(`${MOCK}/__mockshop/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state, overlays, url: page.url(), keep: state.keep ?? true, resetChats: state.resetChats ?? false }) });
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
  if (clip) {
    await page.waitForTimeout(clip.end_hold_ms);
    await rec.stop();
    await ctx.close();
    const mp4 = path.join(m.outDir, "clips", `${name}.mp4`);
    const info = await encodeClip(rec, mp4, clip);
    tl.write(path.join(m.outDir, "clips", name), { clip: path.basename(mp4), duration_ms: Math.round(info.duration_s * 1000), viewport: [w, h] });
    fs.writeFileSync(path.join(m.outDir, "clips", `${name}.report.json`), JSON.stringify({
      script: name, locale: locale.code, mp4, recorded_at: isoLocal(startedAt), finished_at: isoLocal(), demo_anchor: isoLocal(anchor, { ms: !anchorSpec }),
      ...info, beats: shots, beat_times: beatLog, time_note: "beat_times[].t_s = seconds from the start of the video", problems, known_problems: known }, null, 2));
    if (!process.env.MOCKSHOP_KEEP_FRAMES) fs.rmSync(outDir, { recursive: true, force: true });
    return { name, shots: [mp4], problems, known, info, strict };
  }
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

// Run script files for one plugin; returns the number of scripts with failed steps.
export async function runScripts(m, files, opts = {}) {
  const browser = await launchBrowser();
  let failed = 0;
  try {
    for (const f of files) {
      const t0 = Date.now();
      const r = await runScript(m, f, browser, opts);
      const stepFail = r.strict ? r.problems.length > 0 : r.problems.some((p) => p.startsWith("STEP"));
      if (stepFail) failed++;
      if (r.info) console.log(`${stepFail ? "✗" : "✓"} ${m.name}/${r.name}: clip ${r.info.duration_s.toFixed(1)}s (${r.info.frames} frames) in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${r.shots[0]}`);
      else console.log(`${stepFail ? "✗" : "✓"} ${m.name}/${r.name}: ${r.shots.length} shot(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.join(m.outDir, r.name)}/`);
      for (const p of r.problems) console.log(`    ${p}`);
      for (const k of r.known || []) console.log(`    · known (${k.reason}): ${k.problem}`);
    }
  } finally { await browser.close(); }
  return failed;
}
