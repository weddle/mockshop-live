// In-page cursor player. Port of @trycua/cursor-motion (MIT, Copyright (c) 2025 Cua AI, Inc.; see ./LICENSE)
// at commit 5e638b2113f7105b93e0cccf4477e4080995f717: Trajectory.sampleAt/velocityAt (plan.ts), the effect
// geometry (effects.ts: glow, trail, magnet, ripple, squish, linger, effectRgb) and the canvas painting
// (render.ts: drawEffectsUnder/Over, the body glow layers, the idle float), merged into one self-contained
// function so Playwright can inject it (addInitScript / evaluate). Changes from upstream: the cursor body is
// any SVG path passed in `cfg.look` (Mockshop's own shapes, core/cursor.mjs) instead of the Cua artwork, plus
// a configurable effect colour, outline, drop shadow, size, opacity and rotation, a page-wide canvas, and
// frozen ripples for screenshots.
//
// Page API: __msCursor(x, y) place; __msPlay(traj) play a planned move; __msClick(x, y, fx?) click effects;
// __msCursorLook(look) restyle; __msStill({ ripple, squish, magnet }) freeze effects for a screenshot;
// __msCursorHide(bool).
export function installCursorOverlay(cfg) {
  if (window.__msCursorInstalled) return;
  window.__msCursorInstalled = true;
  const REST = Math.PI / 4, ANCHOR = 16, MAGNET_SECS = 0.7, MAGNET_INFLATE = 6, RIPPLE_SECS = 0.52, CLICK_FX_SECS = 0.55, SQUISH = 0.12, FLOAT_SECS = 4;
  const GLOW_LAYERS = [[44, 0.02], [36, 0.024], [29, 0.03], [23, 0.038], [18, 0.048], [14, 0.06], [10, 0.075], [7, 0.095]];
  const store = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const load = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; } };
  let look = load("__msCursorLook") || cfg.look;
  let pos = load("__msCursor") || [cfg.w * 0.55, cfg.h * 0.6];
  let heading = REST, traj = null, t0 = 0, clickAge = null, clickAt = [0, 0], clickFx = { ripple: true, squish: true }, clickLook = null, clickColor = null, still = null, hidden = load("__msCursorHidden") ?? !!cfg.hidden, last = 0, idle = 0;
  let fx = cfg.effects || { ripple: true };
  let body = null, canvas = null, g = null, raf = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (a) => { let r = a % (2 * Math.PI); if (r > Math.PI) r -= 2 * Math.PI; if (r < -Math.PI) r += 2 * Math.PI; return r; };
  const hexRgb = (hex) => { const h = String(hex).replace("#", ""); const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lift = (c) => c.map((v) => Math.round(v + (255 - v) * 0.45)); // effectRgb
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.min(Math.max(a, 0), 1)})`;
  const effectColor = (l = look) => l.effect_color ? hexRgb(l.effect_color) : lift(hexRgb(l.fill === "none" ? l.stroke : l.fill));

  // ---- Trajectory playback (plan.ts) ----
  const duration = (tr) => tr.samples[tr.samples.length - 1].t;
  function sampleAt(tr, t) {
    const S = tr.samples, first = S[0], end = S[S.length - 1];
    if (t <= first.t) return first;
    if (t >= end.t) return end;
    let lo = 0, hi = S.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (S[mid].t <= t) lo = mid + 1; else hi = mid; }
    const a = S[lo - 1], b = S[lo], f = (t - a.t) / (b.t - a.t);
    return { t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), heading: a.heading + wrap(b.heading - a.heading) * f };
  }
  function velocityAt(tr, t) {
    const h = 0.008;
    if (t > duration(tr) + h) return [0, 0];
    const a = sampleAt(tr, t - h), b = sampleAt(tr, t + h);
    return [(b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h)];
  }
  const headOf = (s) => (look.rotate ? s.heading : REST);

  // ---- Effect geometry (effects.ts) ----
  function glow(tr, t, p) {
    if (t >= duration(tr)) return null;
    const [vx, vy] = velocityAt(tr, t), speed = Math.hypot(vx, vy);
    const alpha = Math.min(speed * 0.00014, 0.42) * (tr.glow ?? 1);
    if (alpha <= 0.02) return null;
    const off = Math.min(speed * 0.009, 18);
    return { x: p[0] - (vx / speed) * off, y: p[1] - (vy / speed) * off, r: 30 * (1 + Math.min(speed * 0.00024, 0.44)), alpha };
  }
  function trail(tr, t) {
    const spec = tr.trail, steps = Math.max(spec.steps, 1), pts = [];
    for (let i = 0; i <= steps; i++) {
      const s = sampleAt(tr, t - spec.secs + spec.secs * (i / steps)), h = headOf(s);
      pts.push([s.x + Math.cos(h) * spec.anchorOffset, s.y + Math.sin(h) * spec.anchorOffset]);
    }
    let length = 0;
    for (let i = 1; i <= steps; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const fade = Math.min(length / spec.fadeLen, 1), out = [];
    for (let i = 1; i <= steps; i++) {
      const a = pts[i - 1], b = pts[i], k = i / steps;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3) out.push({ a, b, width: spec.tailWidth + (spec.headWidth - spec.tailWidth) * k, alpha: spec.alpha * k * k * fade });
    }
    return out;
  }
  function magnet(tr, t) {
    if (tr.snapT === null || tr.snapT === undefined) return null;
    const age = t - tr.snapT;
    if (!(age >= 0 && age < MAGNET_SECS)) return null;
    const end = tr.samples[tr.samples.length - 1];
    return { rect: tr.targetKnown ? tr.target : [end.x - 12, end.y - 12, 24, 24], glow: 1 - age / MAGNET_SECS };
  }
  function ripple(age, p, l = look, color = effectColor(l)) {
    if (age >= RIPPLE_SECS) return null;
    const k = age / RIPPLE_SECS, easeOut = 1 - (1 - k) ** 3, sc = l.ripple_scale ?? 1;
    return { x: p[0], y: p[1], r: (8 + 44 * easeOut) * sc, width: 4 * (1 - k) + 1, alpha: 0.75 * (1 - k), color, fill: l.ripple_fill };
  }
  function squish(age) {
    const PRESS = 0.09;
    if (age < PRESS) return SQUISH * Math.min(age / 0.05, 1);
    const after = age - PRESS;
    return SQUISH * Math.max(Math.cos(Math.min(after / 0.22, 1) * Math.PI * 1.5), 0) * Math.max(1 - after / 0.22, 0);
  }
  function linger(tr) {
    let end = duration(tr);
    if (tr.effects.trail) end += tr.trail.secs;
    if (tr.effects.magnet && tr.snapT != null) end = Math.max(end, tr.snapT + MAGNET_SECS);
    return end;
  }
  function frame(now) {
    const f = { glow: null, trail: [], magnet: null, ripple: null, squish: 0 };
    if (traj) {
      const t = (now - t0) / 1000, h = heading;
      if (traj.effects.glow) f.glow = glow(traj, t, [pos[0] + Math.cos(h) * ANCHOR, pos[1] + Math.sin(h) * ANCHOR]);
      if (traj.effects.trail) f.trail = trail(traj, t);
      if (traj.effects.magnet) f.magnet = magnet(traj, t);
    }
    if (clickAge !== null) { if (clickFx.ripple) f.ripple = ripple(clickAge, clickAt, clickLook, clickColor); if (clickFx.squish) f.squish = squish(clickAge); }
    if (still) {
      if (still.ripple != null && still.ripple !== false) f.ripple = ripple(RIPPLE_SECS * (still.ripple === true ? 0.3 : still.ripple), still.at || pos);
      if (still.squish) f.squish = SQUISH * (still.squish === true ? 1 : still.squish);
      if (still.magnet) f.magnet = { rect: still.magnet, glow: still.magnet_glow ?? 0.8 };
    }
    return f;
  }

  // ---- Painting (render.ts) ----
  function drawUnder(f, c) {
    if (f.glow) {
      const gr = g.createRadialGradient(f.glow.x, f.glow.y, 0, f.glow.x, f.glow.y, f.glow.r);
      gr.addColorStop(0, rgba(c, f.glow.alpha)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(f.glow.x, f.glow.y, f.glow.r, 0, 2 * Math.PI); g.fill();
    }
    g.lineCap = "round";
    for (const s of f.trail) { g.strokeStyle = rgba(c, s.alpha); g.lineWidth = s.width; g.beginPath(); g.moveTo(s.a[0], s.a[1]); g.lineTo(s.b[0], s.b[1]); g.stroke(); }
    if (f.magnet) {
      const [x, y, w, h] = f.magnet.rect, i = MAGNET_INFLATE;
      for (const [width, a] of [[14, 0.1], [8, 0.22], [3, 0.9]]) {
        g.strokeStyle = rgba(c, a * f.magnet.glow); g.lineWidth = width; g.beginPath();
        g.roundRect(x - i, y - i, w + 2 * i, h + 2 * i, Math.min(8, (w + 2 * i) / 2, (h + 2 * i) / 2)); g.stroke();
      }
    }
  }
  function drawOver(f) {
    if (!f.ripple) return;
    const c = f.ripple.color;
    if (f.ripple.fill) { g.fillStyle = rgba(c, f.ripple.alpha * 0.3); g.beginPath(); g.arc(f.ripple.x, f.ripple.y, f.ripple.r, 0, 2 * Math.PI); g.fill(); }
    g.strokeStyle = rgba(c, f.ripple.alpha); g.lineWidth = f.ripple.width; g.beginPath(); g.arc(f.ripple.x, f.ripple.y, f.ripple.r, 0, 2 * Math.PI); g.stroke();
  }
  function drawBody(x, y, h, sq, floatT) {
    const [vw, vh] = look.viewbox, s = (look.size / vh) * (1 - sq);
    let fx = 0, fy = 0, fr = 0;
    if (floatT != null) { const a = ((floatT % FLOAT_SECS) / FLOAT_SECS) * 2 * Math.PI; fx = Math.sin(a) * 5; fy = 6 * Math.cos(a) - 5; fr = ((2.5 * Math.PI) / 180) * Math.cos(a); }
    body ??= new Path2D(look.path);
    g.save();
    g.globalAlpha = look.opacity ?? 1;
    g.translate(x + fx * (look.size / 42), y + fy * (look.size / 42));
    if (look.rotate) g.rotate(h - REST + fr);
    g.scale(s, s);
    g.translate(-look.hotspot[0], -look.hotspot[1]);
    g.lineCap = "round"; g.lineJoin = "round";
    if (look.halo) {
      const c = effectColor();
      // upstream widths are 128-unit canvas units at 42 pt; convert to on-screen px, then to this viewbox
      for (const [width, op] of GLOW_LAYERS) { g.globalAlpha = (look.opacity ?? 1) * op * 2; g.strokeStyle = rgba(c, 1); g.lineWidth = ((width * 42) / 128) * (look.size / 42) / s; g.stroke(body); }
      g.globalAlpha = look.opacity ?? 1;
    }
    if (look.shadow) { g.shadowColor = look.shadow_color || "rgba(0,0,0,.35)"; g.shadowBlur = look.shadow_blur ?? 4; g.shadowOffsetY = look.shadow_y ?? 1.5; }
    if (look.fill !== "none") { g.fillStyle = look.fill; g.fill(body); }
    g.shadowColor = "transparent";
    if (look.stroke_width) { g.strokeStyle = look.stroke; g.lineWidth = look.stroke_width; g.stroke(body); }
    g.restore();
  }
  function paint(now) {
    const dpr = window.devicePixelRatio || 1, W = innerWidth, H = innerHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (hidden) return;
    const f = frame(now), c = effectColor();
    drawUnder(f, c);
    drawBody(pos[0], pos[1], heading, f.squish, look.float ? idle : null);
    drawOver(f);
  }
  function tick(now) {
    raf = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    let busy = !!look.float;
    if (traj) {
      const t = (now - t0) / 1000, s = sampleAt(traj, t);
      pos = [s.x, s.y]; heading = headOf(s);
      if (t >= linger(traj)) { traj = null; store("__msCursor", pos); } else busy = true;
    }
    idle += dt;
    if (clickAge !== null && !still) { clickAge += dt; if (clickAge >= CLICK_FX_SECS) clickAge = null; else busy = true; }
    if (canvas) paint(now);
    if (busy) raf = requestAnimationFrame(tick); else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  const mount = () => {
    if (document.getElementById("__ms-cursor")) return;
    canvas = document.createElement("canvas");
    canvas.id = "__ms-cursor";
    canvas.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none";
    g = canvas.getContext("2d");
    document.documentElement.appendChild(canvas);
    kick();
  };
  window.__msCursor = (x, y) => { pos = [x, y]; if (!traj) heading = REST; store("__msCursor", pos); kick(); };
  window.__msPlay = (tr) => { traj = tr; t0 = performance.now(); idle = 0; if (tr.effects) fx = tr.effects; heading = headOf(tr.samples[0]); kick(); };
  // Keep the click's appearance while its pulse fades, even if the step restores the cursor body look.
  window.__msClick = (x, y, e) => { const use = e || fx; if (!use.ripple && !use.squish) return; clickAge = 0; clickAt = [x, y]; clickFx = use; clickLook = look; clickColor = use.ripple ? effectColor() : null; kick(); };
  window.__msCursorLook = (l) => { look = l; body = null; store("__msCursorLook", l); kick(); };
  window.__msStill = (s) => { still = s; if (s?.at) pos = s.at; kick(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); };
  window.__msCursorHide = (h) => { hidden = !!h; store("__msCursorHidden", hidden); kick(); };
  if (cfg.follow) {
    addEventListener("mousemove", (e) => { if (!traj) window.__msCursor(e.clientX, e.clientY); }, true);
    addEventListener("mousedown", (e) => window.__msClick(e.clientX, e.clientY), true);
  }
  const boot = () => { mount(); new MutationObserver(() => { if (!document.getElementById("__ms-cursor") && document.body) mount(); }).observe(document.documentElement, { childList: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}
