// Mockshop clip recording: human-paced replay of a script, a visible cursor overlay, and a CDP screencast
// (JPEG frames with arrival times) encoded to H.264 MP4 with ffmpeg. Used by runner.mjs in clip mode.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

let seed = 7;

// Script-level `clip:` options (all optional).
export function clipDefaults(o = {}) {
  seed = 7; // same jitter on every recording
  return {
    viewport: null,          // [w, h]; default = script/manifest viewport (1440x900). [1920,1080] also works
    type_delay_ms: 55,       // per keystroke when type_ms is null
    type_ms: 2500,           // fixed total time per `type` step when type_cps is null (text is inserted in small bursts); null = per-keystroke
    type_cps: 32,            // typing speed (characters/second): a `type` step takes length / type_cps seconds, clamped to 700..3200 ms; null = fixed type_ms
    nav_fade: 450,           // ms crossfade between page navigations (load time is cut from the clip); 0 = hard cut
    fade_ms: 450,            // crossfade for click steps marked `fade: true` (e.g. a side panel opening)
    after_type_ms: 700,      // beat after typing finishes
    // move_ms: set it to force a fixed cursor glide time (see the script `cursor:` block, docs/cursor.md)
    pre_click_ms: 220,       // hover before clicking (cursor.pre_click_ms overrides)
    after_click_ms: 600,     // beat after each click (plus normal settle)
    settle_cap_ms: 300,      // clip mode caps script `settle:` waits (screenshots keep the full value)
    idle_timeout_ms: 1500,   // clip mode: max wait for network idle after a click/settle (screenshots: 8000)
    hold_ms: 2200,           // how long a `shot` step holds in the clip
    end_hold_ms: 2500,       // hold on the final frame
    title: null,             // { title, subtitle } card over the first page, or a string
    title_ms: 3200,
    cursor: true,            // false hides the overlay; the script `cursor:` block configures it
    fps: 30, crf: 18, preset: "slow",
    ...o,
    title: typeof o.title === "string" ? { title: o.title } : o.title ?? null,
  };
}

// Runs inside the page (addInitScript): title-card styles. The cursor overlay is core/cursor.mjs.
export function cardInit() {
  if (window.__msCardInstalled) return;
  window.__msCardInstalled = true;
  const mount = () => {
    if (document.getElementById("__ms-card-style")) return;
    const st = document.createElement("style");
    st.id = "__ms-card-style";
    st.textContent = `#__ms-card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(15,17,21,.97);color:#fff;font:600 44px/1.2 Inter,system-ui,sans-serif;letter-spacing:-.01em;opacity:0;transition:opacity .45s ease;pointer-events:none;text-align:center;padding:0 10%}
#__ms-card small{display:block;margin-top:16px;font:400 22px/1.4 Inter,system-ui,sans-serif;color:#c9ced8}`;
    document.documentElement.appendChild(st);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
}

// Deterministic jitter so re-recordings match.
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Total time to type `value` in clip mode: the step's `clip_ms`, else length / type_cps (clamped 700..3200 ms), else type_ms.
export const typeTotalMs = (value, clip, ms) => ms ?? (clip.type_cps ? Math.min(3200, Math.max(700, (String(value).length / clip.type_cps) * 1000)) : clip.type_ms);

// Type `value` into the focused field in typeTotalMs(): small bursts of 1-3 characters via insertText
// (one input event per burst), so long questions read as typing without taking 10 s.
export async function clipType(page, value, clip, ms) {
  const total = typeTotalMs(value, clip, ms);
  if (!total) return false;
  const bursts = [];
  for (let i = 0; i < value.length; ) { const k = 1 + Math.floor(rnd() * 3); bursts.push(value.slice(i, i + k)); i += k; }
  const per = Math.max(8, total / bursts.length);
  for (const b of bursts) { await page.keyboard.insertText(b); await page.waitForTimeout(per * (0.6 + rnd() * 0.8)); }
  return true;
}

// Crossfade: put a still of the current screen over the page (below the cursor), let the caller change the
// page underneath (time cut from the clip), then fade the still out. The real UI is untouched.
export async function freezeFrame(page) {
  return (await page.screenshot({ type: "jpeg", quality: 92 })).toString("base64");
}
export async function fadeFrom(page, b64, ms) {
  await page.evaluate(({ b64, ms }) => {
    const img = document.createElement("img");
    img.id = "__ms-fade";
    img.src = "data:image/jpeg;base64," + b64;
    img.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483640;pointer-events:none;opacity:1;transition:opacity ${ms}ms ease`;
    document.documentElement.appendChild(img);
    return new Promise((r) => (img.complete ? r() : (img.onload = r)));
  }, { b64, ms });
}
export async function fadeOut(page, ms) {
  await page.evaluate((ms) => {
    const img = document.getElementById("__ms-fade");
    if (!img) return;
    requestAnimationFrame(() => requestAnimationFrame(() => (img.style.opacity = "0")));
    setTimeout(() => img.remove(), ms + 50);
  }, ms);
  await page.waitForTimeout(ms + 80);
}

export async function showCard(page, card, ms) {
  await page.evaluate(({ title, subtitle }) => {
    let el = document.getElementById("__ms-card");
    if (!el) { el = document.createElement("div"); el.id = "__ms-card"; document.documentElement.appendChild(el); }
    el.innerHTML = "";
    el.append(document.createTextNode(title || ""));
    if (subtitle) { const s = document.createElement("small"); s.textContent = subtitle; el.append(s); }
    requestAnimationFrame(() => (el.style.opacity = "1"));
  }, card);
  await page.waitForTimeout(ms);
  if (card.keep) return;   // leave it up (e.g. so the next navigation crossfades out of the card)
  await page.evaluate(() => { const el = document.getElementById("__ms-card"); if (el) { el.style.opacity = "0"; setTimeout(() => el.remove(), 600); } });
  await page.waitForTimeout(650);
}

// CDP screencast -> numbered JPEGs + host arrival times (frames only arrive when pixels change).
// CDP screencast -> numbered JPEGs + host arrival times (frames only arrive when pixels change).
// cutStart()/cutEnd() drop frames in between and remove that wall time from the clip timeline.
export class Recorder {
  constructor(page, dir, [w, h]) { this.page = page; this.dir = path.join(dir, "frames"); this.w = w; this.h = h; this.frames = []; this.started = false; this.cut = 0; this.cutAt = null; }
  async start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (f) => {
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      if (this.cutAt !== null) return;
      const t = Date.now() - this.cut;
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(6, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ file, t });
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: this.w, maxHeight: this.h, everyNthFrame: 1 });
    this.started = true;
    this.t0 = Date.now();
  }
  // Current position on the video timeline in seconds (0 = first frame; cut time excluded). Read-only.
  videoTime() { if (!this.frames.length) return 0; const now = (this.cutAt ?? Date.now()) - this.cut; return Math.max(0, Math.round((now - this.frames[0].t) / 10) / 100); }
  cutStart() { if (this.started && this.cutAt === null) this.cutAt = Date.now(); }
  cutEnd() { if (this.cutAt !== null) { this.cut += Date.now() - this.cutAt; this.cutAt = null; } }
  async stop() {
    this.cutEnd();
    this.t1 = Date.now() - this.cut;
    if (this.cdp) await this.cdp.send("Page.stopScreencast").catch(() => {});
  }
}

// Resample the variable-rate screencast to constant fps ourselves (for each output tick, the latest frame at or
// before it) and pipe the JPEGs to ffmpeg. (The concat demuxer stretches frames shorter than its 40 ms default,
// which slowed down fast-changing parts such as a streaming answer.)
export async function encodeClip(rec, mp4, clip) {
  const fr = rec.frames;
  if (!fr.length) throw new Error("clip: no frames captured");
  const t0 = fr[0].t, total = rec.t1 - t0, n = Math.max(1, Math.round((total / 1000) * clip.fps));
  fs.mkdirSync(path.dirname(mp4), { recursive: true });
  const W = rec.w - (rec.w % 2), H = rec.h - (rec.h % 2);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(clip.fps), "-c:v", "mjpeg", "-i", "-",
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos:in_range=pc:out_range=tv,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p`,
    "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:v", "libx264", "-preset", clip.preset, "-crf", String(clip.crf), "-tune", "stillimage", "-r", String(clip.fps), "-movflags", "+faststart", mp4], { stdio: ["pipe", "inherit", "pipe"] });
  let err = ""; ff.stderr.on("data", (d) => (err += d));
  ff.stdin.on("error", () => {}); // a dying ffmpeg (EPIPE) reports through `done`
  const done = new Promise((res, rej) => { ff.on("error", rej); ff.on("close", (c) => (c ? rej(new Error(`ffmpeg failed: ${err.slice(0, 400)}`)) : res())); });
  done.catch(() => {}); // awaited below; never an unhandled rejection if writing fails first
  try {
    let j = 0, cache = { i: -1, buf: null };
    for (let k = 0; k < n; k++) {
      const t = t0 + (k * 1000) / clip.fps;
      while (j + 1 < fr.length && fr[j + 1].t <= t) j++;
      if (cache.i !== j) cache = { i: j, buf: fs.readFileSync(fr[j].file) };
      if (!ff.stdin.write(cache.buf)) await Promise.race([new Promise((r) => ff.stdin.once("drain", r)), done]);
    }
    ff.stdin.end();
    await done;
  } catch (e) { ff.kill("SIGKILL"); throw e; }
  const duration_s = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" }).trim());
  return { duration_s, frames: fr.length, out_frames: n, size: [W, H], bytes: fs.statSync(mp4).size };
}
