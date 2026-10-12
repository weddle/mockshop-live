// Port of @trycua/cursor-motion (MIT, Copyright (c) 2025 Cua AI, Inc.; see ./LICENSE and ./README.md)
// from https://github.com/trycua/cua libs/typescript/cursor-motion/src at commit 5e638b2113f7105b93e0cccf4477e4080995f717.
// Files merged here, TypeScript types stripped, logic unchanged: geom.ts, rng.ts, ease.ts, path.ts, dubins.ts,
// style.ts, params.ts, spec.ts, plan.ts and the pure parts of effects.ts. Node-side planning only; the in-page
// player is ./overlay.mjs. The Cua cursor artwork (render.ts CURSOR_PATH) is NOT included.

// ---- geom.ts ----
export const pt = (x, y) => ({ x, y });
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPt = (a, b, t) => pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export function unit(a, b) {
  let d = dist(a, b);
  if (d === 0) d = 1;
  return pt((b.x - a.x) / d, (b.y - a.y) / d);
}
export const perp = (u) => pt(-u.y, u.x);
const TAU = 2 * Math.PI;
export function wrapAngle(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}
export const POINTER_ANCHOR_OFFSET = 16;
export function anchorForPointer(x, y, heading) {
  return [x + Math.cos(heading) * POINTER_ANCHOR_OFFSET, y + Math.sin(heading) * POINTER_ANCHOR_OFFSET];
}
export function pointerForAnchor(x, y, heading) {
  return [x - Math.cos(heading) * POINTER_ANCHOR_OFFSET, y - Math.sin(heading) * POINTER_ANCHOR_OFFSET];
}

// ---- rng.ts ----
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export class Rng {
  constructor(seed) { this.state = hashString(seed) || 1; }
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
}

// ---- ease.ts ----
export const EASE_NAMES = ["linear", "min_jerk", "smootherstep", "in_out_cubic", "in_out_sine", "out_cubic"];
export const linear = (t) => t;
export const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
export const smootherstep = (t) => t * t * t * (t * (6 * t - 15) + 10);
export const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const inOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const outCubic = (t) => 1 - (1 - t) ** 3;
export function cubicBezier(x1, y1, x2, y2, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx1 = Math.min(Math.max(x1, 0), 1);
  const cx2 = Math.min(Math.max(x2, 0), 1);
  const coord = (a, b, u) => { const v = 1 - u; return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 52; i++) {
    const mid = 0.5 * (lo + hi);
    if (coord(cx1, cx2, mid) < t) lo = mid;
    else hi = mid;
  }
  return coord(y1, y2, 0.5 * (lo + hi));
}
const NAMED = { linear, min_jerk: minJerk, smootherstep, in_out_cubic: inOutCubic, in_out_sine: inOutSine, out_cubic: outCubic };
export function easeFn(ease) {
  if (typeof ease === "string") return NAMED[ease];
  if (ease.type === "cubic_bezier") { const { x1, y1, x2, y2 } = ease; return (t) => cubicBezier(x1, y1, x2, y2, t); }
  return NAMED[ease.type];
}
export function bumpProfile(base, over, overAt) {
  const a = Math.max(overAt * 10, 1.5);
  const b = Math.max((1 - overAt) * 10, 1.5);
  const peak = (a / (a + b)) ** a * (b / (a + b)) ** b;
  return (tau) => base(tau) + over * ((tau ** a * (1 - tau) ** b) / peak);
}
export function wobbleProfile(base, amp, cycles, decay, start) {
  return (tau) => {
    if (tau <= start) return base(tau);
    const u = (tau - start) / (1 - start);
    const ramp = smootherstep(Math.min(u / 0.18, 1));
    return base(tau) + (amp * ramp * Math.exp(-decay * u) * Math.sin(2 * Math.PI * cycles * u) * (1 - u) ** 2) /
      Math.max(Math.exp(-decay * 0.12) * 0.77, 1e-6);
  };
}

// ---- path.ts ----
export class Path {
  constructor(f, n) {
    this.f = f;
    this.us = new Float64Array(n + 1);
    this.ss = new Float64Array(n + 1);
    let prev = f(0), total = 0;
    for (let i = 1; i <= n; i++) {
      const u = i / n, p = f(u);
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      this.us[i] = u; this.ss[i] = total; prev = p;
    }
    this.length = total;
    this.p0 = f(0); this.p1 = f(1);
    this.t0 = unit(f(1e-3), this.p0);
    this.t1 = unit(f(1 - 1e-3), this.p1);
  }
  atFraction(frac) {
    const len = this.length;
    if (len < 1e-9) return this.f(Math.min(Math.max(frac, 0), 1));
    if (frac > 1) return pt(this.p1.x + this.t1.x * (frac - 1) * len, this.p1.y + this.t1.y * (frac - 1) * len);
    if (frac < 0) return pt(this.p0.x + this.t0.x * -frac * len, this.p0.y + this.t0.y * -frac * len);
    const target = frac * len;
    let lo = 0, hi = this.ss.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.ss[mid] < target) lo = mid; else hi = mid; }
    let span = this.ss[hi] - this.ss[lo];
    if (span === 0) span = 1;
    return this.f(lerp(this.us[lo], this.us[hi], (target - this.ss[lo]) / span));
  }
}
const cubic = (p0, p1, p2, p3) => (u) => {
  const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return pt(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
};
const quad = (p0, p1, p2) => (u) => {
  const v = 1 - u;
  return pt(v * v * p0.x + 2 * v * u * p1.x + u * u * p2.x, v * v * p0.y + 2 * v * u * p1.y + u * u * p2.y);
};
export function cuaPath(a, b, shape) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  const px = -dy / len, py = dx / len;
  const deflection = len * shape.arcSize;
  const flow = (shape.arcFlow + 1) / 2;
  const c1d = deflection * (1 - 0.5 * flow);
  const c2d = deflection * (1 - 0.5 * (1 - flow));
  const c1 = pt(a.x + dx * shape.startHandle + px * c1d, a.y + dy * shape.startHandle + py * c1d);
  const c2 = pt(b.x - dx * shape.endHandle + px * c2d, b.y - dy * shape.endHandle + py * c2d);
  return new Path(cubic(a, c1, c2, b), 256);
}
export function bowPath(a, b, amount) {
  const d = dist(a, b), n = perp(unit(a, b)), m = lerpPt(a, b, 0.5);
  return new Path(quad(a, pt(m.x + n.x * amount * d, m.y + n.y * amount * d), b), 256);
}
export const straightPath = (a, b) => new Path((u) => lerpPt(a, b, u), 8);
export const naturalSide = (a, b) => (unit(a, b).x >= 0 ? -1 : 1);

// ---- dubins.ts ----
function mod2pi(x) { const r = x - TAU * Math.floor(x / TAU); return r < 0 ? r + TAU : r; }
function lsl(d, a, b) {
  const tmp0 = d + Math.sin(a) - Math.sin(b);
  const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b));
  if (p2 < 0) return null;
  const tmp1 = Math.atan2(Math.cos(b) - Math.cos(a), tmp0);
  return { t: mod2pi(-a + tmp1), p: Math.sqrt(p2), q: mod2pi(b - tmp1), types: ["L", "S", "L"] };
}
function rsr(d, a, b) {
  const tmp0 = d - Math.sin(a) + Math.sin(b);
  const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a));
  if (p2 < 0) return null;
  const tmp1 = Math.atan2(Math.cos(a) - Math.cos(b), tmp0);
  return { t: mod2pi(a - tmp1), p: Math.sqrt(p2), q: mod2pi(-b + tmp1), types: ["R", "S", "R"] };
}
function lsr(d, a, b) {
  const p2 = -2 + d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) + Math.sin(b));
  if (p2 < 0) return null;
  const p = Math.sqrt(p2);
  const tmp1 = Math.atan2(-(Math.cos(a) + Math.cos(b)), d + Math.sin(a) + Math.sin(b)) - Math.atan2(-2, p);
  return { t: mod2pi(-a + tmp1), p, q: mod2pi(-mod2pi(b) + tmp1), types: ["L", "S", "R"] };
}
function rsl(d, a, b) {
  const p2 = d * d - 2 + 2 * Math.cos(a - b) - 2 * d * (Math.sin(a) + Math.sin(b));
  if (p2 < 0) return null;
  const p = Math.sqrt(p2);
  const tmp1 = Math.atan2(Math.cos(a) + Math.cos(b), d - Math.sin(a) - Math.sin(b)) - Math.atan2(2, p);
  return { t: mod2pi(a - tmp1), p, q: mod2pi(b - tmp1), types: ["R", "S", "L"] };
}
function rlr(d, a, b) {
  const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(a - Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b)) + p / 2);
  return { t, p, q: mod2pi(a - b - t + p), types: ["R", "L", "R"] };
}
function lrl(d, a, b) {
  const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a))) / 8;
  if (Math.abs(tmp) > 1) return null;
  const p = mod2pi(TAU - Math.acos(tmp));
  const t = mod2pi(-a + Math.atan2(-Math.cos(a) + Math.cos(b), d + Math.sin(a) - Math.sin(b)) + p / 2);
  return { t, p, q: mod2pi(mod2pi(b) - a - t + p), types: ["L", "R", "L"] };
}
export function planDubins(x0, y0, th0, x1, y1, th1, turnRadius) {
  const r = Math.max(turnRadius, 1);
  const dx = x1 - x0, dy = y1 - y0, dd = Math.hypot(dx, dy);
  let best = null;
  if (dd >= 0.5) {
    const d = dd / r;
    const theta = mod2pi(Math.atan2(dy, dx));
    const a = mod2pi(th0 - theta), b = mod2pi(th1 - theta);
    let bestLen = Infinity;
    for (const solver of [lsl, rsr, lsr, rsl, rlr, lrl]) {
      const sol = solver(d, a, b);
      if (!sol) continue;
      const len = sol.t + sol.p + sol.q;
      if (Number.isFinite(len) && len >= 0 && len < bestLen) { bestLen = len; best = sol; }
    }
  }
  if (!best) {
    const length = Math.max(dd, 1);
    return {
      length,
      sample(s) {
        const u = Math.min(Math.max(s / Math.max(length, 1), 0), 1);
        let diff = th1 - th0;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, heading: th0 + diff * u };
      },
    };
  }
  const sol = best, l1 = sol.t * r, l2 = sol.p * r, l3 = sol.q * r;
  return {
    length: (sol.t + sol.p + sol.q) * r,
    sample(sIn) {
      if (sIn <= 0) return { x: x0, y: y0, heading: th0 };
      const s = Math.min(sIn, l1 + l2 + l3);
      let x = x0, y = y0, th = th0;
      const advance = (len, seg) => {
        if (seg === "S") { x += Math.cos(th) * len; y += Math.sin(th) * len; }
        else {
          const dth = (len / r) * (seg === "L" ? 1 : -1);
          const side = seg === "L" ? Math.PI / 2 : -Math.PI / 2;
          const cx = x + Math.cos(th + side) * r, cy = y + Math.sin(th + side) * r;
          const ang = Math.atan2(y - cy, x - cx);
          x = cx + Math.cos(ang + dth) * r; y = cy + Math.sin(ang + dth) * r; th += dth;
        }
      };
      if (s <= l1) { advance(s, sol.types[0]); return { x, y, heading: th }; }
      advance(l1, sol.types[0]);
      if (s <= l1 + l2) { advance(s - l1, sol.types[1]); return { x, y, heading: th }; }
      advance(l2, sol.types[1]);
      advance(s - l1 - l2, sol.types[2]);
      return { x, y, heading: th };
    },
  };
}

// ---- style.ts ----
export const MOTION_STYLES = ["signature_arc", "spring_settle", "magnetic", "comet_swoop", "adaptive", "classic"];
export const MOTION_TIMINGS = ["native", "fitts", "fixed"];
export const EFFECT_NAMES = ["trail", "glow", "magnet", "ripple", "squish"];
export const NO_EFFECTS = Object.freeze({ trail: false, glow: false, magnet: false, ripple: false, squish: false });
export function defaultEffects(style) {
  const on = (...names) => { const out = { ...NO_EFFECTS }; for (const n of names) out[n] = true; return out; };
  switch (style) {
    case "signature_arc": return on("glow", "ripple", "squish");
    case "spring_settle": return on("glow", "squish");
    case "magnetic": return on("magnet", "ripple");
    case "comet_swoop": return on("trail", "ripple");
    case "adaptive": return on("squish");
    default: return on();
  }
}
export function resolveEffects(overrides, base) {
  const out = { ...base };
  for (const n of EFFECT_NAMES) { const v = overrides?.[n]; if (v !== undefined && v !== null) out[n] = v; }
  return out;
}
export const DEFAULT_FIXED_MS = 1430;

// ---- params.ts ----
export const DEFAULT_PARAMS = Object.freeze({
  style: "signature_arc", timing: "native", effects: {},
  startHandle: 0.3, endHandle: 0.3, arcSize: 0.25, arcFlow: 0, spring: 0.72, glideDurationMs: 0,
  peakSpeed: 900, minStartSpeed: 300, minEndSpeed: 200, turnRadius: 80,
});
export const motionParams = (p = {}) => ({ ...DEFAULT_PARAMS, ...p, effects: { ...(p.effects ?? {}) } });
export const resolvedEffects = (p) => resolveEffects(p.effects, defaultEffects(p.style));

// ---- effects.ts (constants) ----
export const DEFAULT_TRAIL = Object.freeze({ secs: 0.18, fadeLen: 60, steps: 26, tailWidth: 2, headWidth: 12, alpha: 0.38, anchorOffset: POINTER_ANCHOR_OFFSET });
export const MAGNET_SECS = 0.7;
export const MAGNET_INFLATE = 6;
export const RIPPLE_SECS = 0.52;
export const CLICK_FX_SECS = 0.55;
export const SQUISH = 0.12;

// ---- spec.ts ----
export const fittsDuration = (scale) => ({ type: "fitts", a: 150, b: 120, minMs: 300, maxMs: 1000, scale });
export function durationMs(d, distance, width) {
  switch (d.type) {
    case "fixed": return d.ms;
    case "fitts": return clamp(d.a + d.b * Math.log2(distance / Math.max(width, 4) + 1), d.minMs, d.maxMs) * d.scale;
    case "distance": return clamp(d.baseMs + d.msPerPt * distance, d.minMs, d.maxMs);
  }
}
export function knobShape(params, arcSize, arcFlow) {
  return {
    startHandle: params.startHandle, endHandle: params.endHandle,
    arcSize: arcSize * (params.arcSize / DEFAULT_PARAMS.arcSize),
    arcFlow: Math.min(Math.max(arcFlow + params.arcFlow, -1), 1),
  };
}
export function specForStyle(style, params = {}) {
  const p = motionParams({ ...params, style });
  const base = (path, ease, settle, duration) => ({ path, ease, settle, duration, heading: "tangent", effects: resolvedEffects(p), trail: { ...DEFAULT_TRAIL } });
  switch (style) {
    case "signature_arc":
      return base({ type: "arc", ...knobShape(p, 0.16, 0.15) }, "min_jerk", { type: "follow_through", amount: 0.018, maxPt: 8, at: 0.82 }, fittsDuration(1.1));
    case "spring_settle":
      return base({ type: "arc", ...knobShape(p, 0.12, 0) }, "min_jerk",
        { type: "spring", amount: 0.05, maxPt: 6, cycles: 1.3, decay: 2.6, start: 0.55, glideEnd: 0.68 }, fittsDuration(1.35));
    case "comet_swoop":
      return base({ type: "arc", ...knobShape(p, 0.24, 0.2) }, "in_out_cubic", { type: "none" }, fittsDuration(1.15));
    default: return null;
  }
}
export const defaultSpec = () => specForStyle("signature_arc");

// ---- plan.ts ----
export const DT_MS = 1000 / 120;
export const DEFAULT_TARGET_PT = 24;
export const REST_HEADING = Math.PI / 4;
const ARRIVAL_TOLERANCE_PT = 1;
const REDUCED_MOTION_MS = 120;

function sampleTimed(pos, ms) {
  const c = Math.ceil(ms / DT_MS);
  const n = Math.max(Number.isFinite(c) && c > 0 ? c : 0, 2);
  const out = [];
  for (let i = 0; i <= n; i++) { const tau = i / n, p = pos(tau); out.push({ t: tau * ms, x: p.x, y: p.y }); }
  return out;
}
function pinEnds(samples, from, aim) {
  if (samples.length) {
    samples[0].x = from.x; samples[0].y = from.y;
    samples[samples.length - 1].x = aim.x; samples[samples.length - 1].y = aim.y;
  }
  return samples;
}
const glide = (from, aim, path, profile, ms) => pinEnds(sampleTimed((tau) => path.atFraction(profile(tau)), ms), from, aim);
function speedShaped(from, aim, path, shape, ms) {
  const N = 600;
  const ts = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) ts[i] = ts[i - 1] + 1 / Math.max(shape((i - 0.5) / N), 1e-3);
  const total = ts[N];
  return pinEnds(sampleTimed((tau) => {
    const target = tau * total;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] < target) lo = mid; else hi = mid; }
    const f = (target - ts[lo]) / Math.max(ts[hi] - ts[lo], 1e-9);
    return path.atFraction((lo + f) / N);
  }, ms), from, aim);
}
const ctxD = (c) => dist(c.from, c.aim);
const targetWidth = (c) => Math.max(Math.min(c.target[2], c.target[3]), 4);
const side = (c) => naturalSide(c.from, c.aim);
export function fittsTimingMs(d, w) { return Math.min(Math.max(150 + 120 * Math.log2(d / Math.max(w, 4) + 1), 300), 1000); }

function generateSpec(spec, c) {
  const s = side(c), sp = spec.path;
  const path = sp.type === "straight" ? straightPath(c.from, c.aim)
    : sp.type === "arc" ? cuaPath(c.from, c.aim, { ...sp, arcSize: sp.arcSize * s })
      : bowPath(c.from, c.aim, sp.amount * s);
  const ease = easeFn(spec.ease);
  const ms = durationMs(spec.duration, ctxD(c), targetWidth(c));
  const st = spec.settle;
  switch (st.type) {
    case "none": return glide(c.from, c.aim, path, ease, ms);
    case "follow_through": {
      const over = Math.min(st.amount, st.maxPt / Math.max(ctxD(c), 1));
      return glide(c.from, c.aim, path, bumpProfile(ease, over, st.at), ms);
    }
    case "spring": {
      const amp = Math.min(st.amount, st.maxPt / Math.max(ctxD(c), 1));
      const glideEnd = st.glideEnd;
      const profile = wobbleProfile((t) => ease(Math.min(t / glideEnd, 1)), amp, st.cycles, st.decay, st.start);
      return glide(c.from, c.aim, path, profile, ms);
    }
  }
}
function magnetic(c) {
  const path = bowPath(c.from, c.aim, 0.04 * side(c));
  const len = path.length, radius = Math.min(40, len * 0.5), pull = 0.45, enterSpeed = 300;
  const out = [{ t: 0, x: c.from.x, y: c.from.y }];
  let s = 0, v = 0, t = 0, snap = null;
  const dt = DT_MS / 1000;
  while (s < len && t < 4) {
    const rem = len - s;
    if (rem > radius) v = Math.min(1500, v + 7000 * dt, enterSpeed + 5.5 * (rem - radius));
    else { if (snap === null) snap = t * 1000; v += 26000 * pull * (radius / Math.max(rem, 6)) * dt; }
    s = Math.min(len, s + v * dt);
    t += dt;
    const q = path.atFraction(s / len);
    out.push({ t: t * 1000, x: q.x, y: q.y });
  }
  return [pinEnds(out, c.from, c.aim), snap ?? t * 1000];
}
const plain = (path, ease, duration) => ({ path, ease, settle: { type: "none" }, duration, heading: "tangent", effects: { ...NO_EFFECTS }, trail: { ...DEFAULT_TRAIL } });
const FITTS_MS = { type: "fitts", a: 50, b: 150, minMs: 180, maxMs: 1400, scale: 1 };
const fittsMinjerk = (c) => generateSpec(plain({ type: "bow", amount: 0.02 }, "min_jerk", FITTS_MS), c);
function keynoteSwoop(c, rng) {
  const arc = rng.range(0.25, 0.35);
  return generateSpec(plain({ type: "arc", startHandle: 0.3, endHandle: 0.3, arcSize: arc, arcFlow: 0.2 }, "in_out_cubic",
    { type: "distance", baseMs: 350, msPerPt: 0.35, minMs: 450, maxMs: 1100 }), c);
}
function preciseClick(c) {
  const fp = 0.15, fs = 0.35;
  const shape = (s) => s < 0.4 ? 0.04 + Math.sin((Math.PI * s) / 0.8)
    : s < 1 - fp ? 1 - (1 - fs) * inOutSine((s - 0.4) / (0.6 - fp)) : 0.02 + fs * Math.sqrt(Math.max((1 - s) / fp, 0));
  const path = bowPath(c.from, c.aim, 0.03 * side(c));
  return speedShaped(c.from, c.aim, path, shape, durationMs(FITTS_MS, ctxD(c), targetWidth(c)) * 1.2);
}
export function adaptivePick(c) {
  if (targetWidth(c) < 16) return "precise_click";
  if (ctxD(c) > 900) return "keynote_swoop";
  return "fitts_minjerk";
}
function retime(samples, targetMs) {
  const total = samples.length ? samples[samples.length - 1].t : 0;
  if (Number.isNaN(total) || total <= 0 || samples.length < 3) return;
  const k = targetMs / total;
  for (const s of samples) s.t *= k;
}
function applyTiming(samples, events, c, timing, fixedMs) {
  const total = samples.length ? samples[samples.length - 1].t : 0;
  let want;
  if (timing === "native") return;
  if (timing === "fixed") want = fixedMs;
  else {
    const last = samples.length ? samples[samples.length - 1] : c.aim;
    want = fittsTimingMs(dist(c.from, pt(last.x, last.y)), Math.min(c.target[2], c.target[3]));
  }
  if (total > 0) {
    retime(samples, want);
    for (let i = 0; i < events.length; i++) events[i] = (events[i] * want) / total;
  }
}

export class Trajectory {
  constructor(samples, arrivalT, snapT, target, targetKnown, effects, trail, style) {
    Object.assign(this, { samples, arrivalT, snapT, target, targetKnown, effects, trail, style });
  }
  duration() { return this.samples.length ? this.samples[this.samples.length - 1].t : 0; }
  end() { return this.samples[this.samples.length - 1]; }
  sampleAt(t) {
    const first = this.samples[0];
    if (t <= first.t) return first;
    const last = this.end();
    if (t >= last.t) return last;
    let lo = 0, hi = this.samples.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.samples[mid].t <= t) lo = mid + 1; else hi = mid; }
    const a = this.samples[lo - 1], b = this.samples[lo];
    const f = (t - a.t) / (b.t - a.t);
    return { t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), heading: a.heading + wrapAngle(b.heading - a.heading) * f };
  }
  velocityAt(t) {
    const h = 0.008;
    if (t > this.duration() + h) return [0, 0];
    const a = this.sampleAt(t - h), b = this.sampleAt(t + h);
    return [(b.x - a.x) / (2 * h), (b.y - a.y) / (2 * h)];
  }
}

const TIP_ANGLE = -0.75 * Math.PI;
function resolve(req) {
  const r = req.target;
  const known = !!r && r.every((v) => Number.isFinite(v)) && r[2] > 0 && r[3] > 0;
  const h = DEFAULT_TARGET_PT / 2;
  return {
    from: req.from, to: req.to,
    fromHeading: req.fromHeading ?? REST_HEADING, endHeading: req.endHeading ?? REST_HEADING,
    target: known ? r : [req.to.x - h, req.to.y - h, DEFAULT_TARGET_PT, DEFAULT_TARGET_PT],
    targetKnown: known, seed: req.seed ?? "",
  };
}
function finish(rawIn, snapMs, q, effects, trail, style, mode) {
  const raw = rawIn.length ? rawIn : [{ t: 0, x: q.to.x, y: q.to.y }];
  const n = raw.length;
  let rot = wrapAngle(q.fromHeading - q.endHeading);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const a = raw[Math.max(i - 2, 0)], b = raw[Math.min(i + 2, n - 1)];
    const dt = Math.max((b.t - a.t) / 1000, 1e-3);
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    let want = 0;
    if (mode === "tangent") { const w = Math.min(Math.max((speed - 40) / 260, 0), 1); want = wrapAngle(Math.atan2(vy, vx) - TIP_ANGLE) * w; }
    const step = i > 0 ? (raw[i].t - raw[i - 1].t) / 1000 : 0;
    const k = 1 - Math.exp(-step * 22);
    rot += wrapAngle(want - rot) * k;
    samples.push({ t: raw[i].t / 1000, x: raw[i].x, y: raw[i].y, heading: q.endHeading + rot });
  }
  const end = samples[samples.length - 1];
  let t = end.t;
  const dt = DT_MS / 1000;
  for (let i = 0; i < 36; i++) {
    if (Math.abs(rot) < 0.002) break;
    t += dt;
    rot -= rot * (1 - Math.exp(-dt * 22));
    samples.push({ ...end, t, heading: q.endHeading + rot });
  }
  samples[samples.length - 1] = { ...samples[samples.length - 1], heading: q.endHeading };
  const hit = samples.find((s) => Math.hypot(s.x - q.to.x, s.y - q.to.y) <= ARRIVAL_TOLERANCE_PT);
  const arrival = hit ? hit.t : samples[samples.length - 1].t;
  return new Trajectory(samples, arrival, snapMs === null ? null : snapMs / 1000, q.target, q.targetKnown, effects, trail, style);
}
function reduced(q, style) {
  const raw = glide(q.from, q.to, straightPath(q.from, q.to), minJerk, REDUCED_MOTION_MS);
  return finish(raw, null, q, { ...NO_EFFECTS }, { ...DEFAULT_TRAIL }, style, "fixed");
}

export function planMove(params, req) {
  const p = motionParams(params);
  const q = resolve(req);
  const c = { from: q.from, aim: q.to, target: q.target };
  const fixedMs = p.glideDurationMs > 0 ? p.glideDurationMs : DEFAULT_FIXED_MS;
  const timing = p.timing === "native" && p.glideDurationMs > 0 ? "fixed" : p.timing;
  if (req.reducedMotion) return reduced(q, p.style);
  if (p.style === "classic") return planClassic(p, q, timing, fixedMs);
  const spec = specForStyle(p.style, p);
  let raw, snap = null;
  if (spec) raw = generateSpec(spec, c);
  else if (p.style === "magnetic") [raw, snap] = magnetic(c);
  else {
    const rng = new Rng(q.seed);
    const pick = adaptivePick(c);
    raw = pick === "precise_click" ? preciseClick(c) : pick === "keynote_swoop" ? keynoteSwoop(c, rng) : fittsMinjerk(c);
  }
  const events = snap === null ? [] : [snap];
  applyTiming(raw, events, c, timing, fixedMs);
  return finish(raw, events.length ? events[0] : null, q, resolvedEffects(p), { ...DEFAULT_TRAIL }, p.style, p.style === "magnetic" ? "fixed" : "tangent");
}

export function planSpec(spec, req) {
  const q = resolve(req);
  if (req.reducedMotion) return reduced(q, null);
  const raw = generateSpec(spec, { from: q.from, aim: q.to, target: q.target });
  return finish(raw, null, q, { ...spec.effects }, { ...spec.trail }, null, spec.heading);
}

function planClassic(p, q, timing, fixedMs) {
  const K = 400, OVERSHOOT = 0.8;
  const springC = (17 * p.spring) / 0.72;
  const dt = DT_MS / 1000;
  const [ax, ay] = anchorForPointer(q.from.x, q.from.y, q.fromHeading);
  const [tx, ty] = anchorForPointer(q.to.x, q.to.y, q.endHeading);
  const path = planDubins(ax, ay, q.fromHeading + Math.PI, tx, ty, q.endHeading + Math.PI, p.turnRadius);
  const pathLen = Math.max(path.length, 1);
  const fixed = timing === "fixed";
  const out = [];
  const push = (t, x, y, heading) => { const [px, py] = pointerForAnchor(x, y, heading); out.push({ t, x: px, y: py, heading }); };
  push(0, ax, ay, q.fromHeading);
  let d = 0, t = 0, speed = 0, guard = 0;
  while (d < pathLen && guard < 20000) {
    guard++;
    const u = Math.min(d / pathLen, 1);
    const profile = (30 * u * u * (1 - u) * (1 - u)) / 1.875;
    const floor = u < 0.5 ? p.minStartSpeed : p.minEndSpeed;
    speed = fixed ? pathLen / (fixedMs / 1000) : floor + (p.peakSpeed - floor) * profile;
    d += speed * dt;
    t += dt;
    if (d >= pathLen) break;
    const s = path.sample(d);
    push(t, s.x, s.y, s.heading + Math.PI);
  }
  const end = path.sample(pathLen);
  push(t, tx, ty, q.endHeading);
  let arrival = t;
  const impulse = fixed ? p.minEndSpeed : speed;
  let ox = 0, oy = 0;
  let vx = impulse * OVERSHOOT * Math.cos(end.heading);
  let vy = impulse * OVERSHOOT * Math.sin(end.heading);
  for (let i = 0; i < 600; i++) {
    const sdt = dt / 4;
    for (let j = 0; j < 4; j++) {
      vx += (-K * ox - springC * vx) * sdt; vy += (-K * oy - springC * vy) * sdt;
      ox += vx * sdt; oy += vy * sdt;
    }
    t += dt;
    if (Math.hypot(ox, oy) < 0.3 && Math.hypot(vx, vy) < 2) break;
    push(t, tx + ox, ty + oy, q.endHeading);
  }
  push(t + dt, tx, ty, q.endHeading);
  if (timing === "fitts") {
    const total = out[out.length - 1].t;
    if (total > 0) {
      const want = fittsTimingMs(dist(q.from, q.to), Math.min(q.target[2], q.target[3])) / 1000;
      const k = want / total;
      for (const s of out) s.t *= k;
      arrival *= k;
    }
  }
  return new Trajectory(out, arrival, null, q.target, q.targetKnown, resolvedEffects(p), { ...DEFAULT_TRAIL }, "classic");
}
