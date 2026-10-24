// Mockshop cursor: script `cursor:` config -> planned moves (vendored @trycua/cursor-motion, see
// core/vendor/cua-cursor-motion/) -> real page.mouse.move along the samples (so hover fires) while the
// in-page overlay plays the same trajectory with its effects. Used by runner.mjs for clips and screenshots.
import { planMove, planSpec, specForStyle, MOTION_STYLES, EASE_NAMES, DEFAULT_TRAIL, REST_HEADING, resolveEffects, Trajectory, fittsDuration } from "./vendor/cua-cursor-motion/motion.mjs";
export { installCursorOverlay } from "./vendor/cua-cursor-motion/overlay.mjs";

// Mockshop's own cursor shapes (SVG path, viewbox [w, h], hotspot, default size = on-screen height in px).
// The tip of the pointing shapes is up-left, matching the planner's rest heading (pi/4).
export const SHAPES = {
  arrow: { path: "M2 2 L2 24 L8 18.5 L12 27.5 L15.6 26 L11.7 17.2 L19.5 17.2 Z", viewbox: [22, 30], hotspot: [2, 2], size: 30 },
  pointer: { path: "M3 3 L26 11.6 Q27.4 12.3 26 13 L15.6 15.6 L13 26 Q12.3 27.4 11.6 26 Z", viewbox: [30, 30], hotspot: [3, 3], size: 30 },
  dot: { path: "M12 4 A8 8 0 1 1 11.99 4 Z", viewbox: [24, 24], hotspot: [12, 12], size: 22 },
  ring: { path: "M12 4 A8 8 0 1 1 11.99 4 Z", viewbox: [24, 24], hotspot: [12, 12], size: 28, fill: "none", stroke_width: 2.5 },
};

export const CURSOR_DEFAULTS = {
  enabled: true,           // clips: draw the overlay (false = real mouse still moves, nothing drawn)
  screenshots: false,      // screenshots: draw the overlay in stills (opt-in; off keeps existing shots unchanged)
  style: "signature_arc",  // signature_arc | spring_settle | magnetic | comet_swoop | adaptive | classic | straight | arc | bow | custom
  timing: "native",        // native | fitts | fixed | distance
  ms: null,                // move time for timing: fixed (ms)
  speed: 1,                // >1 = faster, <1 = slower (divides every duration)
  ease: null,              // linear | min_jerk | smootherstep | in_out_cubic | in_out_sine | out_cubic | [x1,y1,x2,y2] | "cubic-bezier(...)"
  path: null,              // straight | arc | bow
  settle: null,            // none | follow_through | spring
  heading: null,           // tangent | fixed: the arrow leans into the motion (needs look.rotate) or keeps its pose
  seed: null,              // determinism seed (default: script name + move index)
  reduced_motion: false,   // short straight 120 ms glide, no effects
  effects: {},             // { trail, glow, magnet, ripple, squish }: true/false overrides the style's defaults
  trail: {},               // { secs, fade_len, steps, tail_width, head_width, alpha }
  glow: 1,                 // speed-glow strength multiplier
  pre_click_ms: null,      // hover before a click (default: clip.pre_click_ms)
  look: { shape: "arrow", fill: null, stroke: null, stroke_width: null, size: null, shadow: true, effect_color: "#3b82f6", opacity: 1, rotate: false, halo: false, float: false, ripple_fill: true, ripple_scale: 1 },
};

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// Merge cursor overrides: an object (deep for effects/trail/look), a style name string, or true/false (enabled).
export function mergeCursor(base, over) {
  if (over === undefined || over === null) return base;
  if (typeof over === "boolean") return { ...base, enabled: over };
  if (typeof over === "string") return { ...base, style: over };
  const out = { ...base, ...over };
  for (const k of ["effects", "trail", "look"]) if (isObj(over[k])) out[k] = { ...base[k], ...over[k] };
  return out;
}

// Script cursor config: defaults <- manifest runner.cursor <- clip.cursor / move_ms / pre_click_ms <- script cursor.
export function resolveCursor(manifestCursor, sc) {
  let c = mergeCursor(CURSOR_DEFAULTS, manifestCursor);
  const clip = sc.clip || {};
  if (clip.cursor !== undefined) c = mergeCursor(c, clip.cursor);
  if (clip.move_ms !== undefined) c = { ...c, timing: "fixed", ms: clip.move_ms };
  if (clip.pre_click_ms !== undefined) c = { ...c, pre_click_ms: clip.pre_click_ms };
  return mergeCursor(c, sc.cursor);
}

// The overlay's look: shape geometry + colours.
export function resolveLook(look) {
  if (!look.path && !SHAPES[look.shape]) throw new Error(`cursor: unknown look.shape ${JSON.stringify(look.shape)} (${Object.keys(SHAPES).join(", ")} or look.path)`);
  const shape = look.path ? { path: look.path, viewbox: look.viewbox || [24, 24], hotspot: look.hotspot || [0, 0], size: 24 } : SHAPES[look.shape];
  const fill = look.fill ?? shape.fill ?? "#111111";
  return {
    ...look, path: shape.path, viewbox: shape.viewbox, hotspot: shape.hotspot, size: look.size ?? shape.size, fill,
    stroke: look.stroke ?? (fill === "none" ? look.effect_color : "#ffffff"), stroke_width: look.stroke_width ?? shape.stroke_width ?? 1.6,
    rotate: look.shape === "dot" || look.shape === "ring" ? false : !!look.rotate,
  };
}

function parseEase(e) {
  if (Array.isArray(e)) return { type: "cubic_bezier", x1: +e[0], y1: +e[1], x2: +e[2], y2: +e[3] };
  const m = typeof e === "string" && e.match(/^cubic-bezier\(([^)]*)\)$/);
  if (m) return parseEase(m[1].split(",").map(Number));
  if (!EASE_NAMES.includes(e)) throw new Error(`cursor: unknown ease ${JSON.stringify(e)} (${EASE_NAMES.join(", ")} or cubic-bezier)`);
  return e;
}

const SIMULATED = ["magnetic", "adaptive", "classic"];
const trailSpec = (t = {}) => ({ ...DEFAULT_TRAIL, ...Object.fromEntries(Object.entries({ secs: t.secs, fadeLen: t.fade_len, steps: t.steps, tailWidth: t.tail_width, headWidth: t.head_width, alpha: t.alpha }).filter(([, v]) => v !== undefined)) });

// Plan one move. from/to = [x, y]; target = [x, y, w, h] or null (sets the Fitts width and magnet rect).
export function planCursor(c, from, to, target, seed) {
  const req = { from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, target, seed: c.seed != null ? `${c.seed}|${seed}` : seed, reducedMotion: !!c.reduced_motion };
  const builtin = MOTION_STYLES.includes(c.style);
  if (!builtin && !["straight", "arc", "bow", "custom"].includes(c.style)) throw new Error(`cursor: unknown style ${JSON.stringify(c.style)}`);
  const params = {
    style: builtin ? c.style : "signature_arc", effects: c.effects || {},
    ...(c.start_handle != null && { startHandle: c.start_handle }), ...(c.end_handle != null && { endHandle: c.end_handle }),
    ...(c.arc_size != null && { arcSize: c.arc_size }), ...(c.arc_flow != null && { arcFlow: c.arc_flow }),
    ...(c.spring != null && { spring: c.spring }), ...(c.peak_speed != null && { peakSpeed: c.peak_speed }),
    ...(c.min_start_speed != null && { minStartSpeed: c.min_start_speed }), ...(c.min_end_speed != null && { minEndSpeed: c.min_end_speed }),
    ...(c.turn_radius != null && { turnRadius: c.turn_radius }),
  };
  const custom = !builtin || c.ease || c.path || c.settle || c.timing === "distance" || c.bow != null || c.overshoot != null || c.overshoot_px != null;
  let traj;
  if (!custom || SIMULATED.includes(c.style)) {
    traj = planMove({ ...params, timing: c.timing === "distance" ? "native" : c.timing, glideDurationMs: c.timing === "fixed" ? (c.ms ?? 0) : 0 }, req);
    traj.trail = trailSpec(c.trail);
  } else {
    const spec = specForStyle(builtin ? c.style : "signature_arc", params);
    if (c.style === "straight") { spec.path = { type: "straight" }; spec.settle = { type: "none" }; }
    if (c.style === "bow") { spec.path = { type: "bow", amount: 0.06 }; spec.settle = { type: "none" }; }
    const path = c.path ?? (c.bow != null ? "bow" : null);
    if (path === "straight") spec.path = { type: "straight" };
    else if (path === "bow") spec.path = { type: "bow", amount: c.bow ?? 0.06 };
    else if (path === "arc" && spec.path.type !== "arc") spec.path = { type: "arc", startHandle: c.start_handle ?? 0.3, endHandle: c.end_handle ?? 0.3, arcSize: (c.arc_size ?? 0.25) * 0.64, arcFlow: c.arc_flow ?? 0.15 };
    if (c.ease) spec.ease = parseEase(c.ease);
    const settle = c.settle ?? (c.overshoot != null || c.overshoot_px != null ? "follow_through" : null);
    if (settle === "none") spec.settle = { type: "none" };
    else if (settle === "follow_through") spec.settle = { type: "follow_through", amount: c.overshoot ?? 0.018, maxPt: c.overshoot_px ?? 8, at: 0.82 };
    else if (settle === "spring") spec.settle = { type: "spring", amount: c.overshoot ?? 0.05, maxPt: c.overshoot_px ?? 6, cycles: c.cycles ?? 1.3, decay: c.decay ?? 2.6, start: 0.55, glideEnd: 0.68 };
    else if (settle) throw new Error(`cursor: unknown settle ${JSON.stringify(settle)}`);
    if (c.timing === "fixed") spec.duration = { type: "fixed", ms: c.ms ?? 1430 };
    else if (c.timing === "fitts") spec.duration = fittsDuration(1);
    else if (c.timing === "distance") spec.duration = { type: "distance", baseMs: c.base_ms ?? 350, msPerPt: c.ms_per_px ?? 0.35, minMs: c.min_ms ?? 250, maxMs: c.max_ms ?? 1200 };
    spec.effects = resolveEffects(c.effects, spec.effects);
    spec.trail = trailSpec(c.trail);
    if (c.heading) spec.heading = c.heading;
    traj = planSpec(spec, req);
  }
  if (c.heading === "fixed") for (const s of traj.samples) s.heading = REST_HEADING;
  const k = 1 / (Number(c.speed) || 1);
  if (k !== 1) {
    traj = new Trajectory(traj.samples.map((s) => ({ ...s, t: s.t * k })), traj.arrivalT * k, traj.snapT == null ? null : traj.snapT * k, traj.target, traj.targetKnown, traj.effects, traj.trail, traj.style);
  }
  return traj;
}

// Glide from state.pos to (x, y): the overlay plays the trajectory while the real mouse follows the same samples
// in wall-clock time. state = { pos, moves, seed }.
export async function glideTo(page, c, state, x, y, target = null) {
  const [x0, y0] = state.pos;
  if (Math.hypot(x - x0, y - y0) < 2) { await page.mouse.move(x, y); state.pos = [x, y]; return; }
  const traj = planCursor(c, state.pos, [x, y], target, `${state.seed}|${++state.moves}`);
  const { samples, arrivalT, snapT, targetKnown, effects, trail } = traj;
  await page.evaluate((tr) => window.__msPlay?.(tr), { samples, arrivalT, snapT, target: traj.target, targetKnown, effects, trail, glow: c.glow }).catch(() => {});
  // stop driving once the position stops changing (the trailing samples only relax the arrow's heading)
  const S = traj.samples, end = S[S.length - 1];
  let i = S.length - 1;
  while (i > 0 && S[i - 1].x === end.x && S[i - 1].y === end.y) i--;
  const dur = S[i].t, start = Date.now();
  for (;;) {
    const t = Math.min((Date.now() - start) / 1000, dur), s = traj.sampleAt(t);
    await page.mouse.move(s.x, s.y);
    if (t >= dur) break;
    await page.waitForTimeout(8);
  }
  state.pos = [x, y];
}
