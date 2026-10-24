// DOM recording (`--dom`): every top-level document of a run records its DOM, mutations, scrolls, inputs and pointer
// events with rrweb (core/vendor/rrweb/), so a demo can be replayed as live HTML/CSS instead of pixels. The stream is
// written as <name>.rrweb.json next to the run's other outputs and `replay` turns it into one self-contained HTML
// page: rrweb-player inlined, chapters from the run's shots or beats, and a drawn pointer (clip cursor colours) with a
// click ripple. The run's own cursor canvas (#__ms-cursor) is blocked from the recording; the replay draws its own.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VENDOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor", "rrweb");
const read = (f) => fs.readFileSync(path.join(VENDOR, f), "utf8");

// Attach the recorder to a Playwright context before its first page. Returns the collector: `events` (rrweb
// events, in arrival order) and `mark(name, meta)` to add a chapter at the current wall-clock time.
export async function attachDomRecorder(ctx) {
  // Segments. Each beat is its own recording: a cut stops the page's rrweb session and starts a fresh one (new full
  // snapshot), so every segment stands alone and plays from its own first frame to its own last. Cuts come from the
  // script: mark steps, shot.beat, and the Onyx adapter's send (after submit, and after the answer has settled).
  const rec = { segments: [{ name: null, events: [] }], scenes: [], scene: null, current: null, t0: null,
    get events() { return rec.segments.flatMap((g) => g.events); },
    // Close the current segment under `name` and start the next. Called between steps (page may be mid-navigation).
    async cut(page, name, meta = {}) {
      rec.finish(name, meta);
      await page.evaluate(() => window.__msDomCut?.()).catch(() => {});   // restart the session: fresh snapshot
    },
    finish(name, meta = {}) {
      const seg = rec.segments[rec.segments.length - 1];
      Object.assign(seg, { name, ...(rec.current || {}), ...meta });
      rec.segments.push({ name: null, events: [] });
    },
    scene_start(id) { rec.scene = id; rec.scenes.push({ id, segment: rec.segments.length - 1 }); }
  };
  await ctx.exposeBinding("__msDomEvent", (_source, ev) => { rec.t0 ??= Date.now(); rec.segments[rec.segments.length - 1].events.push(ev); });
  await ctx.addInitScript(({ src }) => {
    if (window.top !== window || !window.__msDomEvent) return;
    try { (0, eval)(src); } catch { return; }
    let stop = null;
    // Start at `load`, when linked stylesheets are readable and can be inlined into the snapshot; the load itself
    // is cut from clips anyway. Stylesheets that arrive later are inlined when the recording is written.
    const start = () => { stop = window.rrweb?.record({
      emit: (ev) => window.__msDomEvent(ev),
      blockSelector: "#__ms-cursor",      // the run's cursor canvas; the replay draws its own pointer
      inlineStylesheet: true, inlineImages: true, collectFonts: true,
      sampling: { mousemove: 16, scroll: 50, input: "last" },
    }) || null; };
    window.__msDomCut = () => { try { stop?.(); } catch {} start(); };
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
  }, { src: read("rrweb.umd.min.cjs") });
  return rec;
}

// Inline every stylesheet <link> the recorder could not (sheets that loaded after the snapshot): fetch the CSS while
// the server is still up and store it the way rrweb's own inliner does (`_cssText`), so the replay never fetches.
export async function inlineStylesheets(events, fetchText = (u) => fetch(u).then((r) => (r.ok ? r.text() : null))) {
  let base = null, done = 0;
  const cache = new Map();
  const visit = async (node) => {
    if (!node || typeof node !== "object") return;
    const a = node.attributes;
    if (node.tagName === "link" && a && /stylesheet/i.test(a.rel || "") && a.href && !a._cssText) {
      const url = (() => { try { return new URL(a.href, base || undefined).href; } catch { return null; } })();
      if (url) {
        if (!cache.has(url)) cache.set(url, fetchText(url).catch(() => null));
        const css = await cache.get(url);
        if (css !== null && css !== undefined) { a._cssText = css; done++; }
      }
    }
    for (const c of node.childNodes || []) await visit(c);
  };
  for (const ev of events) {
    if (ev.type === 4 && ev.data?.href) base = ev.data.href;              // Meta: the document's URL
    else if (ev.type === 2) await visit(ev.data?.node);                   // FullSnapshot
    else if (ev.type === 3 && ev.data?.source === 0) for (const add of ev.data.adds || []) await visit(add.node); // Mutation adds
  }
  return done;
}

// Write the recording: { version, script, recorded_at, viewport, cursor, chapters, segments }. Each segment is one beat's
// own rrweb stream ({ name, scene, step_id, events }); it plays from its first frame to its last and the presenter
// stops there. `chapters` narrates: { title, subtitle, intro, outro, scenes: [{ id, title, text, viewer, segments:
// [index...] }] }. Demo tooling may replace `chapters` wholesale (`replay --chapters`); the shape stays the same.
export function writeDomRecording(rec, file, { viewport, cursor, script, title } = {}) {
  // The trailing open segment holds whatever came after the last cut (usually nothing of interest); keep it only if
  // it has more than a snapshot, named after the last beat so the presenter can see the run out.
  // A segment with nothing but its opening snapshot is a cut that landed on another cut (phases that appear in the
  // same mutation, say): not a beat.
  const active = (g) => g.events.some((e) => e.type === 3);
  const segs = rec.segments.filter(active);
  if (!segs.length) throw new Error("dom: nothing recorded");
  const last = segs[segs.length - 1]; if (!last.name) { last.name = "end"; last.scene = rec.scene; }
  const scenesIn = rec.scenes.length ? rec.scenes : [{ id: script || "replay", segment: 0 }];
  const scenes = scenesIn.map(({ id }) => ({ id, title: id, text: "", viewer: null, segments: [] }));
  segs.forEach((g, k) => { const sc = scenes.find((x) => x.id === g.scene) || scenes[0]; sc.segments.push(k); });
  const chapters = { title: title || script || "replay", subtitle: "", intro: null, outro: null, scenes: scenes.filter((x) => x.segments.length) };
  const out = { version: 4, script, recorded_at: new Date(rec.t0 ?? Date.now()).toISOString(), viewport, cursor, chapters,
    segments: segs.map(({ name, scene, step_id, events }) => ({ name, scene, step_id, events })) };
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON inside <script>: the only sequence that can end the element early.
const scriptSafe = (json) => json.replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");

// Pointer drawn by the replay: the clip cursor's colours when known, else a blue arrowhead easy to spot on a share.
export function pointerSvg({ fill = "#0B5CFF", stroke = "#ffffff" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 2l7.5 18 2.4-7.1L20 10.5z" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

// The replay page. The whole window is the recorded browser: no chrome by default. A pill (bottom right; `c` or `?`)
// opens the panel: scenes and beats, step or continuous mode, speed, pointer, interstitials. Step mode (default)
// plays to the next beat and waits for Space or the right arrow, so a presenter paces the demo; interstitials
// (intro, one per scene, outro) come from `chapters` and are shown by the page, not recorded. The pointer fades out
// after it stops moving and reappears on the next move.
export function buildReplayHtml(recording, { title, subtitle } = {}) {
  const look = recording.cursor || {};
  const [w, h] = recording.viewport || [1440, 900];
  const ch = recording.chapters?.scenes ? recording.chapters : { title: recording.script || "replay", subtitle: "", intro: null, outro: null, scenes: [] };
  if (title) ch.title = title;
  if (subtitle !== undefined) ch.subtitle = subtitle;
  const segs = (recording.segments || []).map(({ name, scene, step_id, events }) => ({ name, scene, step_id, events }));
  const data = scriptSafe(JSON.stringify({ segments: segs, viewport: [w, h] }));
  const chapters = scriptSafe(JSON.stringify(ch, null, 1));
  const pointerDefault = JSON.stringify({ fill: look.fill || "#0B5CFF", stroke: look.stroke || "#ffffff", size: look.size || 36, effect: look.effect_color || look.fill || "#0B5CFF" });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(ch.title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light}
html,body{margin:0;height:100%;background:#000;overflow:hidden;font:14px/1.45 Inter,system-ui,sans-serif;color:#e6e8ee}
body:focus{outline:none}
#stage{position:fixed;inset:0}
#frame{position:relative;background:#fff;overflow:hidden;transform-origin:top left}
#frame iframe{border:0;display:block;pointer-events:none}
body.select #frame iframe{pointer-events:auto}
.replayer-wrapper{position:relative}
.replayer-mouse{position:absolute;width:var(--ptr-size);height:var(--ptr-size);margin-left:-3px;margin-top:-2px;background:var(--ptr) no-repeat;background-size:contain;filter:drop-shadow(0 1.5px 3px rgba(0,0,0,.45));transition:opacity .6s;pointer-events:none;z-index:2147483647}
.replayer-mouse.ms-hidden{opacity:0}
.replayer-mouse::after{content:"";position:absolute;left:3px;top:2px;width:var(--ptr-size);height:var(--ptr-size);border-radius:50%;background:var(--ptr-effect);opacity:0;transform:translate(-50%,-50%) scale(.2)}
.replayer-mouse.active::after{animation:msripple .55s ease-out}
@keyframes msripple{0%{opacity:.55;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.4)}}
.replayer-mouse-tail{display:none!important}
#pill{position:fixed;right:18px;bottom:18px;z-index:10;display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:rgba(15,17,23,.82);backdrop-filter:blur(8px);color:#fff;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35);user-select:none;font-size:13px}
#pill b{font-weight:600}#pill .dot{width:8px;height:8px;border-radius:50%;background:#0B5CFF}#pill.paused .dot{background:#f5a524}
#pill.hidden{display:none}
#panel{position:fixed;right:18px;bottom:64px;z-index:11;width:360px;max-height:calc(100vh - 100px);overflow:auto;background:rgba(15,17,23,.94);backdrop-filter:blur(10px);border:1px solid #2a2f3b;border-radius:14px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);display:none}
#panel.open{display:block}
#panel h2{font-size:13px;margin:10px 0 6px;color:#9aa1b2;text-transform:uppercase;letter-spacing:.06em}
#panel .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0}
#panel button{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid #2f3545;background:#1b1f2a;color:#e6e8ee;cursor:pointer}
#panel button.on{background:#0B5CFF;border-color:#0B5CFF;color:#fff}
#scenes{list-style:none;margin:0;padding:0}#scenes>li{margin:6px 0}
#scenes .sc{padding:7px 9px;border-radius:8px;cursor:pointer;color:#fff;font-weight:600}#scenes .sc:hover{background:#1b1f2a}#scenes .sc.on{background:#0B5CFF}
#scenes ul{list-style:none;margin:2px 0 0 10px;padding:0}#scenes ul li{padding:3px 9px;border-radius:6px;cursor:pointer;color:#c9ced8;font-size:12px}#scenes ul li:hover{background:#1b1f2a}#scenes ul li.on{color:#fff;background:#243049}
#beats{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9;display:flex;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(15,17,23,.7);backdrop-filter:blur(8px)}
#beats i{width:9px;height:9px;border-radius:50%;background:#4a5060;cursor:pointer;display:block}#beats i.done{background:#8fb3ff}#beats i.on{background:#0B5CFF;transform:scale(1.35)}#beats i.scene{width:11px;height:11px;border:2px solid #cfd6e4;box-sizing:border-box}
#beats.hidden{display:none}
#toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%) translateY(8px);z-index:9;padding:8px 14px;border-radius:10px;background:rgba(15,17,23,.86);color:#fff;font-size:13px;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
#inter{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(10,12,18,.92);color:#fff;text-align:center;padding:40px}
#inter.open{display:flex}#inter .box{max-width:860px}
#inter .kicker{color:#8fb3ff;letter-spacing:.08em;text-transform:uppercase;font-size:13px;margin-bottom:14px}
#inter h1{font-size:44px;margin:0 0 18px;font-weight:700;line-height:1.15}
#inter p{font-size:21px;line-height:1.5;color:#d7dbe6;margin:0 auto 22px;max-width:760px}
#inter .viewer{display:inline-flex;align-items:center;gap:12px;background:#1b1f2a;border-radius:999px;padding:8px 18px 8px 8px;font-size:17px}
#inter .viewer img,#inter .cast img{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#333}
#inter .cast{display:flex;gap:22px;justify-content:center;flex-wrap:wrap;margin-top:12px}#inter .cast div{width:150px;font-size:14px;color:#d7dbe6}#inter .cast img{width:72px;height:72px;margin-bottom:8px}#inter .cast b{display:block;color:#fff}
#inter .hint{margin-top:28px;color:#8a92a6;font-size:13px}
#selbar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:12;display:none;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:#0B5CFF;color:#fff;font-size:13px;box-shadow:0 4px 18px rgba(0,0,0,.35)}
body.select #selbar{display:flex}#selbar button{font:inherit;border:0;border-radius:8px;padding:4px 10px;background:#fff;color:#0B5CFF;cursor:pointer}
kbd{font:12px ui-monospace,monospace;background:#2a2f3b;border-radius:4px;padding:1px 6px;color:#fff}
</style></head>
<body>
<div id="stage"><div id="frame"></div></div>
<div id="inter"><div class="box"></div></div>
<div id="beats"></div>
<div id="toast"></div>
<div id="selbar">Selection mode: text in the page can be selected and copied <button id="selDone">Back to presenting</button></div>
<div id="pill"><span class="dot"></span><b id="pill-title"></b><span id="pill-where"></span><span style="opacity:.6">⌨ ?</span></div>
<div id="panel">
  <div class="row"><button id="b-play">Play</button><button id="b-prev">◀ beat</button><button id="b-next">beat ▶</button><span style="flex:1"></span><span id="p-time" style="color:#9aa1b2;font-size:12px"></span></div>
  <h2>Mode</h2><div class="row"><button data-mode="step" class="mode">Step: stop after each beat</button><button data-mode="continuous" class="mode">Continuous</button></div>
  <h2>Speed</h2><div class="row"><button data-speed="1" class="speed">1×</button><button data-speed="1.5" class="speed">1.5×</button><button data-speed="2" class="speed">2×</button></div>
  <h2>Narration</h2><div class="row"><button id="b-inter">Interstitials</button><button id="b-beats">Beat bar</button><button id="b-pill">Hide pill (<kbd>h</kbd> brings it back)</button></div>
  <h2>Text</h2><div class="row"><button id="b-select">Selection mode (<kbd>s</kbd>)</button></div>
  <h2>Pointer</h2><div class="row"><button id="b-ptr">Pointer</button><button data-ptr="small" class="ptrsize">Small</button><button data-ptr="normal" class="ptrsize">Normal</button><button data-ptr="large" class="ptrsize">Large</button><input id="ptr-color" type="color" title="Pointer colour"></div>
  <h2>Scenes</h2><ul id="scenes"></ul>
  <h2>Keys</h2><div style="color:#9aa1b2;font-size:12px;line-height:1.8"><kbd>Space</kbd>/<kbd>→</kbd> next beat · <kbd>←</kbd> previous · <kbd>Enter</kbd> dismiss a card · <kbd>c</kbd> or <kbd>?</kbd> this panel · <kbd>h</kbd> pill · <kbd>i</kbd> interstitials · <kbd>m</kbd> mode · <kbd>p</kbd> pointer · <kbd>s</kbd> select text · <kbd>f</kbd> fullscreen</div>
</div>
<!-- Narration lives here and nowhere else: titles, texts, viewers and cast per scene; "segments" lists which beats
     (by index) belong to each scene. Edit by hand, or regenerate with
     ./mockshop replay <file.rrweb.json> --chapters chapters.json -->
<script id="chapter-data" type="application/json">${chapters}</script>
<script id="data" type="application/json">${data}</script>
<script>${scriptSafe(read("rrweb.umd.min.cjs"))}</script>
<script>
(() => {
  const d = JSON.parse(document.getElementById("data").textContent);
  const ch = JSON.parse(document.getElementById("chapter-data").textContent);
  const [W, H] = d.viewport;
  const $ = (s) => document.querySelector(s);
  // Defaults come from chapters.defaults ({mode, pill, beats, inter, ...}); what the presenter changed is stored per recording.
  const storeKey = "ms-replay-prefs:" + (ch.title || "");
  const prefs = Object.assign({ mode: "step", speed: 1, inter: true, beats: true, pill: true, pointer: true, ptrSize: "normal", ptrColor: null }, ch.defaults || {}, JSON.parse(localStorage.getItem(storeKey) || "{}"));
  const save = () => localStorage.setItem(storeKey, JSON.stringify(prefs));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Beats: one per segment, in order; each knows its scene and whether it opens that scene.
  const sceneOf = {}; ch.scenes.forEach((sc) => sc.segments.forEach((k, n) => { sceneOf[k] = { scene: sc, first: n === 0 }; }));
  const beats = d.segments.map((g, k) => ({ k, name: g.name || ("beat " + (k + 1)), events: g.events, scene: sceneOf[k]?.scene || null, opens: !!sceneOf[k]?.first }));

  // Pointer.
  const ptrDefault = ${pointerDefault};
  const svg = (fill, stroke) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 2l7.5 18 2.4-7.1L20 10.5z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  const applyPointer = () => {
    const fill = prefs.ptrColor || ptrDefault.fill, size = { small: 26, normal: ptrDefault.size, large: Math.round(ptrDefault.size * 1.5) }[prefs.ptrSize];
    const r = document.documentElement.style; r.setProperty("--ptr", 'url("' + svg(fill, ptrDefault.stroke) + '")'); r.setProperty("--ptr-size", size + "px"); r.setProperty("--ptr-effect", prefs.ptrColor || ptrDefault.effect);
    $("#ptr-color").value = fill; document.querySelectorAll(".ptrsize").forEach((b) => b.classList.toggle("on", b.dataset.ptr === prefs.ptrSize));
    $("#b-ptr").classList.toggle("on", prefs.pointer);
    const m = document.querySelector(".replayer-mouse"); if (m) m.style.display = prefs.pointer ? "" : "none";
  };
  let ptrTimer = 0;
  new MutationObserver(() => { const m = document.querySelector(".replayer-mouse"); if (!m) return; if (m.classList.contains("ms-hidden")) m.classList.remove("ms-hidden"); clearTimeout(ptrTimer); ptrTimer = setTimeout(() => m.classList.add("ms-hidden"), 2200); })
    .observe($("#frame"), { attributes: true, subtree: true, attributeFilter: ["style"] });

  // The stage: one Replayer per segment. Building a segment shows its first frame; play() runs it to its last.
  let replayer = null, cur = -1, playing = false, finished = false;
  const fit = () => { const s = Math.min(innerWidth / W, innerHeight / H); const f = $("#frame"); f.style.width = W + "px"; f.style.height = H + "px"; f.style.transform = "scale(" + s + ")"; f.style.marginLeft = ((innerWidth - W * s) / 2) + "px"; f.style.marginTop = ((innerHeight - H * s) / 2) + "px"; };
  addEventListener("resize", fit); fit();
  const setPlaying = (on) => { playing = on; $("#pill").classList.toggle("paused", !on); $("#b-play").textContent = on ? "Pause" : "Play"; };
  const load = (k, { atEnd = false } = {}) => {
    if (replayer) { try { replayer.pause(); } catch {} $("#frame").innerHTML = ""; replayer = null; }
    cur = k; finished = false;
    const b = beats[k];
    replayer = new rrweb.Replayer(b.events, { root: $("#frame"), mouseTail: false, skipInactive: false, speed: prefs.speed, showWarning: false, showDebug: false, insertStyleRules: ["html > canvas { display: none !important; }"] });
    replayer.on("finish", () => { finished = true; setPlaying(false); onFinish(); });
    replayer.pause(atEnd ? replayer.getMetaData().totalTime : 0);
    setPlaying(false); applyPointer(); ui();
  };
  const play = () => { if (!replayer || finished) return; replayer.play(replayer.getCurrentTime()); setPlaying(true); ui(); };
  const pause = () => { if (!replayer) return; replayer.pause(); setPlaying(false); ui(); };

  // Narration cards. Enter/Space/→ dismisses; continuous mode auto-dismisses.
  let interTimer = 0, onDismiss = null;
  const card = (html, then) => {
    if (!prefs.inter) { then(); return; }
    if (playing) pause();
    $("#inter .box").innerHTML = html + '<div class="hint">' + (prefs.mode === "step" ? "Press <kbd>Space</kbd> to continue" : "Continuing…") + "</div>"; $("#inter").classList.add("open");
    onDismiss = () => { clearTimeout(interTimer); $("#inter").classList.remove("open"); onDismiss = null; then(); };
    if (prefs.mode === "continuous") interTimer = setTimeout(() => onDismiss && onDismiss(), 4500);
  };
  const viewerHtml = (v) => v ? '<div class="viewer">' + (v.photo ? '<img src="' + v.photo + '" alt="">' : "") + "<span><b>" + esc(v.name) + "</b>" + (v.title ? " · " + esc(v.title) : "") + "</span></div>" : "";
  const sceneCard = (sc) => '<div class="kicker">Scene ' + (ch.scenes.indexOf(sc) + 1) + " of " + ch.scenes.length + "</div><h1>" + esc(sc.title) + "</h1>" + (sc.text ? "<p>" + esc(sc.text) + "</p>" : "") + viewerHtml(sc.viewer);
  const introCard = (it) => '<div class="kicker">' + esc(ch.subtitle || "Demo") + "</div><h1>" + esc(it.title || ch.title) + "</h1>" + (it.text ? "<p>" + esc(it.text) + "</p>" : "") +
    (it.cast?.length ? '<div class="cast">' + it.cast.map((c) => "<div>" + (c.photo ? '<img src="' + c.photo + '" alt="">' : "") + "<b>" + esc(c.name) + "</b>" + esc(c.title || "") + (c.role ? "<br><span style='color:#8fb3ff'>" + esc(c.role) + "</span>" : "") + "</div>").join("") + "</div>" : "");
  const outroCard = (o) => '<div class="kicker">What you saw</div><h1>' + esc(o.title || ch.title) + "</h1>" + (o.text ? "<p>" + esc(o.text) + "</p>" : "") + (o.points?.length ? "<p>" + o.points.map(esc).join("<br>") + "</p>" : "");

  // Stepping. A beat is a segment: Space loads the next segment (its card first if it opens a scene) and plays it to
  // its end, where it stops. Continuous mode chains segments.
  let toastTimer = 0;
  const toast = (text) => { const t = $("#toast"); t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200); };
  const start = (k) => { load(k); play(); };
  const next = () => {
    if (onDismiss) { onDismiss(); return; }
    if (playing) return;                                   // never skip a stop
    const k = cur + 1;
    if (k >= beats.length) { if (ch.outro) card(outroCard(ch.outro), () => {}); return; }
    const b = beats[k];
    if (b.opens && b.scene) { load(k); card(sceneCard(b.scene), () => play()); } else start(k);
  };
  const onFinish = () => {
    const b = beats[cur]; toast(b.name + " · " + (cur + 1) + "/" + beats.length + (prefs.mode === "step" ? " · Space to continue" : ""));
    ui();
    if (prefs.mode === "continuous") setTimeout(() => { if (!playing && cur + 1 < beats.length) next(); else if (cur + 1 >= beats.length && ch.outro) card(outroCard(ch.outro), () => {}); }, 900);
  };
  const prev = () => { if (onDismiss) onDismiss(); load(Math.max(0, cur - 1), { atEnd: true }); };
  const seek = (k) => { if (onDismiss) onDismiss(); load(k, { atEnd: true }); };
  const fmt = (ms) => { const t = Math.round(ms / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  const ui = () => {
    const b = beats[cur];
    $("#pill-title").textContent = ch.intro?.title || ch.title; $("#pill-where").textContent = b ? ((b.scene ? b.scene.title + " · " : "") + b.name) : "";
    $("#p-time").textContent = (cur + 1) + " / " + beats.length + (replayer ? "  " + fmt(replayer.getCurrentTime()) + " / " + fmt(replayer.getMetaData().totalTime) : "");
    document.querySelectorAll("#beats i").forEach((el, k) => { el.classList.toggle("on", k === cur); el.classList.toggle("done", k < cur); });
    document.querySelectorAll("#scenes .sc").forEach((el) => el.classList.toggle("on", b && b.scene && el.dataset.id === b.scene.id));
    document.querySelectorAll("#scenes ul li").forEach((el) => el.classList.toggle("on", +el.dataset.k === cur));
    document.querySelectorAll(".mode").forEach((el) => el.classList.toggle("on", el.dataset.mode === prefs.mode));
    document.querySelectorAll(".speed").forEach((el) => el.classList.toggle("on", +el.dataset.speed === prefs.speed));
    $("#b-inter").classList.toggle("on", prefs.inter); $("#b-beats").classList.toggle("on", prefs.beats); $("#beats").classList.toggle("hidden", !prefs.beats); $("#pill").classList.toggle("hidden", !prefs.pill);
  };

  // Controls.
  const bar = $("#beats");
  beats.forEach((b, k) => { const i = document.createElement("i"); if (b.opens) i.classList.add("scene"); i.title = (b.scene ? b.scene.title + " · " : "") + b.name; i.onclick = () => seek(k); bar.appendChild(i); });
  const list = $("#scenes");
  ch.scenes.forEach((sc) => { const li = document.createElement("li"); const h = document.createElement("div"); h.className = "sc"; h.dataset.id = sc.id; h.textContent = sc.title; h.onclick = () => seek(sc.segments[0]); li.appendChild(h);
    const ul = document.createElement("ul"); sc.segments.forEach((k) => { const x = document.createElement("li"); x.dataset.k = k; x.textContent = beats[k].name; x.onclick = () => seek(k); ul.appendChild(x); }); li.appendChild(ul); list.appendChild(li); });
  const togglePanel = (on) => $("#panel").classList.toggle("open", on);
  $("#pill").onclick = () => togglePanel(!$("#panel").classList.contains("open"));
  $("#b-play").onclick = () => playing ? pause() : (finished ? next() : play());
  $("#b-prev").onclick = prev; $("#b-next").onclick = next;
  document.querySelectorAll(".mode").forEach((b) => b.onclick = () => { prefs.mode = b.dataset.mode; save(); ui(); });
  document.querySelectorAll(".speed").forEach((b) => b.onclick = () => { prefs.speed = +b.dataset.speed; save(); replayer?.setConfig({ speed: prefs.speed }); ui(); });
  $("#b-inter").onclick = () => { prefs.inter = !prefs.inter; save(); ui(); };
  $("#b-beats").onclick = () => { prefs.beats = !prefs.beats; save(); ui(); };
  $("#b-pill").onclick = () => { prefs.pill = false; save(); togglePanel(false); ui(); };
  $("#b-select").onclick = () => { togglePanel(false); selectMode(true); };
  $("#b-ptr").onclick = () => { prefs.pointer = !prefs.pointer; save(); applyPointer(); };
  document.querySelectorAll(".ptrsize").forEach((b) => b.onclick = () => { prefs.ptrSize = b.dataset.ptr; save(); applyPointer(); });
  $("#ptr-color").oninput = (e) => { prefs.ptrColor = e.target.value; save(); applyPointer(); };
  // Selection mode (key s): the iframe takes the pointer so text can be selected; a visible button hands control back.
  // rrweb's iframe is sandboxed without scripts, so no key listener can run inside it: otherwise it must never hold focus.
  const unfocus = () => { if (document.body.classList.contains("select")) return; const f = $("#frame iframe"); if (f && document.activeElement === f) { f.blur(); document.body.focus(); } };
  const selectMode = (on) => { document.body.classList.toggle("select", on); if (!on) { const f = $("#frame iframe"); f && f.blur(); document.body.focus(); } };
  $("#selDone").onclick = () => selectMode(false);
  setInterval(unfocus, 200); addEventListener("blur", () => setTimeout(unfocus, 0));
  document.body.tabIndex = -1; document.body.focus();
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = e.key;
    if (k === " " || k === "ArrowRight") { e.preventDefault(); if (onDismiss) onDismiss(); else if (playing) { if (prefs.mode === "continuous") pause(); } else next(); }
    else if (k === "Enter") { if (onDismiss) onDismiss(); }
    else if (k === "ArrowLeft") prev();
    else if (k === "c" || k === "?") togglePanel(!$("#panel").classList.contains("open"));
    else if (k === "h") { prefs.pill = !prefs.pill; save(); ui(); }
    else if (k === "i") { prefs.inter = !prefs.inter; save(); ui(); }
    else if (k === "m") { prefs.mode = prefs.mode === "step" ? "continuous" : "step"; save(); ui(); }
    else if (k === "p") { prefs.pointer = !prefs.pointer; save(); applyPointer(); }
    else if (k === "s") selectMode(!document.body.classList.contains("select"));
    else if (k === "f") { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    else if (k === "Escape") { togglePanel(false); selectMode(false); }
  });

  // Start on the first frame of the first beat; the intro card (if any) sits over it.
  if (beats.length) load(0);
  const begin = () => { cur = -1; next(); };
  if (ch.intro) card(introCard(ch.intro), begin); else if (prefs.mode === "continuous") begin();
  window.__replay = { get replayer() { return replayer; }, beats, next, prev, seek, prefs, get cur() { return cur; }, get playing() { return playing; }, get finished() { return finished; } };
})();
</script>
</body></html>`;
}

export function replayFile(recordingFile, outFile, opts = {}) {
  const recording = JSON.parse(fs.readFileSync(recordingFile, "utf8"));
  if (opts.chapters) recording.chapters = JSON.parse(fs.readFileSync(opts.chapters, "utf8"));
  const html = buildReplayHtml(recording, opts);
  fs.writeFileSync(outFile, html);
  return { out: outFile, events: recording.segments.reduce((n, g) => n + g.events.length, 0), scenes: recording.chapters.scenes.length, beats: recording.segments.length, bytes: html.length };
}
