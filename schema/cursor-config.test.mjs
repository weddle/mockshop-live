import assert from "node:assert/strict";
import fs from "node:fs";
import { check } from "../core/validate.mjs";

const schema = JSON.parse(fs.readFileSync(new URL("./script.schema.json", import.meta.url), "utf8"));
const errorsFor = (script) => check(schema, script);
const withCursor = (cursor) => ({ cursor, steps: [{ goto: "/app" }] });

const valid = [
  ["enabled shorthand", true],
  ["disabled shorthand", false],
  ["empty override", {}],
  ["nullable motion defaults", { ms: null, ease: null, path: null, settle: null, heading: null, seed: null, pre_click_ms: null }],
  ["fixed timing", { timing: "fixed", ms: 600, speed: 1.2 }],
  ["distance timing", { timing: "distance", base_ms: 350, ms_per_px: 0.35, min_ms: 250, max_ms: 1200 }],
  ["custom arc", { style: "custom", path: "arc", arc_size: -0.25, arc_flow: -0.5, start_handle: 0.3, end_handle: 0.4, heading: "tangent" }],
  ["custom bow", { path: "bow", bow: -0.06, settle: "none", heading: "fixed" }],
  ["follow through", { settle: "follow_through", overshoot: 0.018, overshoot_px: 8 }],
  ["spring settle", { settle: "spring", cycles: 1.3, decay: 2.6 }],
  ["classic knobs", { style: "classic", timing: "fitts", spring: 0.72, peak_speed: 900, min_start_speed: 300, min_end_speed: 200, turn_radius: 80 }],
  ["nullable optional knobs", { arc_size: null, arc_flow: null, start_handle: null, end_handle: null, bow: null, overshoot: null, overshoot_px: null, cycles: null, decay: null, spring: null, peak_speed: null, min_start_speed: null, min_end_speed: null, turn_radius: null, base_ms: null, ms_per_px: null, min_ms: null, max_ms: null }],
  ["overshooting easing array", { ease: [0.3, 1.4, 0.5, -0.2] }],
  ["documented easing string", { ease: "cubic-bezier(.3,1.4,.5,1)" }],
  ["signed scientific easing string", { ease: "cubic-bezier( 2e-1, -1, .5, +1.4 )" }],
  ["motion switches", { enabled: false, screenshots: true, reduced_motion: true, seed: "demo", glow: 0, pre_click_ms: 0 }],
  ["effects", { effects: { trail: true, glow: false, magnet: true, ripple: false, squish: true } }],
  ["nullable effect defaults", { effects: { trail: null, glow: null, magnet: null, ripple: null, squish: null } }],
  ["null effect overrides", { effects: null }],
  ["trail geometry", { trail: { secs: 0.18, fade_len: 60, steps: 26, tail_width: 2, head_width: 12, alpha: 0.38 } }],
  ["look options", { look: { shape: "pointer", fill: "#2563eb", stroke: "none", stroke_width: 0, size: 30, shadow: false, shadow_color: "rgba(0,0,0,.35)", shadow_blur: 4, shadow_y: -1.5, effect_color: "#3b82f6", opacity: 0.8, rotate: true, halo: true, float: false, ripple_fill: false, ripple_scale: 1.2 } }],
  ["nullable look defaults", { look: { path: null, viewbox: null, hotspot: null, fill: null, stroke: null, stroke_width: null, size: null, shadow_color: null, shadow_blur: null, shadow_y: null, opacity: null, ripple_scale: null } }],
  ["custom SVG geometry", { look: { path: "M0 0 L10 0 L5 10 Z", viewbox: [10, 10], hotspot: [5, 0] } }],
  ["custom SVG uses default geometry and overrides shape", { look: { shape: "custom-art", path: "M0 0 L10 0 L5 10 Z" } }],
  ["shot locator and effects", { at: { text: "Save" }, ripple: 0.35, squish: true, magnet: true }],
  ["shot point and rectangle", { at: [640, 400], ripple: true, squish: 0.5, magnet: [600, 380, 80, 40], look: { shape: "dot" } }],
  ["shot disabled effects", { ripple: false, squish: false, magnet: false }],
  ["shot effect range edges", { ripple: 0, squish: 1 }],
];
for (const style of ["signature_arc", "spring_settle", "magnetic", "comet_swoop", "adaptive", "classic", "straight", "arc", "bow", "custom"]) {
  valid.push([`style shorthand ${style}`, style], [`style object ${style}`, { style }]);
}
for (const ease of ["linear", "min_jerk", "smootherstep", "in_out_cubic", "in_out_sine", "out_cubic"]) {
  valid.push([`named ease ${ease}`, { ease }]);
}
for (const shape of ["arrow", "pointer", "dot", "ring"]) {
  valid.push([`built-in shape ${shape}`, { look: { shape } }]);
}

const invalid = [
  ["unknown shorthand style", "spring_settle_typo"],
  ["empty shorthand style", ""],
  ["numeric cursor", 1],
  ["array cursor", []],
  ["null cursor remains outside the published syntax", null],
  ["unknown config key", { styel: "classic" }],
  ["unknown object style", { style: "typo" }],
  ["null style", { style: null }],
  ["unknown timing", { timing: "typo" }],
  ["unknown path", { path: "typo" }],
  ["unknown settle", { settle: "typo" }],
  ["unknown heading", { heading: "typo" }],
  ["unknown ease", { ease: "ease-in-out" }],
  ["short easing array", { ease: [0.3, 1.4, 0.5] }],
  ["long easing array", { ease: [0.3, 1.4, 0.5, 1, 0] }],
  ["nonnumeric easing array", { ease: [0.3, "1.4", 0.5, 1] }],
  ["easing object is not an exposed config form", { ease: { type: "linear" } }],
  ["short cubic bezier", { ease: "cubic-bezier(.3,1.4,.5)" }],
  ["long cubic bezier", { ease: "cubic-bezier(.3,1.4,.5,1,0)" }],
  ["nonnumeric cubic bezier", { ease: "cubic-bezier(.3,no,.5,1)" }],
  ["empty cubic bezier component", { ease: "cubic-bezier(.3,,.5,1)" }],
  ["unanchored cubic bezier", { ease: "prefix cubic-bezier(.3,1.4,.5,1)" }],
  ["numeric option string", { arc_size: "0.25" }],
  ["boolean option string", { screenshots: "true" }],
  ["effects typo", { effects: { rippple: true } }],
  ["effects numeric override", { effects: { ripple: 0.35 } }],
  ["effects array", { effects: [] }],
  ["trail typo", { trail: { fadeLen: 60 } }],
  ["trail string", { trail: { secs: "0.18" } }],
  ["null trail has no supported fallback", { trail: null }],
  ["look typo", { look: { strokeWidth: 2 } }],
  ["unknown look shape", { look: { shape: "typo" } }],
  ["empty SVG does not override unknown shape", { look: { shape: "typo", path: "" } }],
  ["look boolean string", { look: { rotate: "true" } }],
  ["short custom viewbox", { look: { path: "M0 0", viewbox: [24] } }],
  ["long custom hotspot", { look: { path: "M0 0", hotspot: [0, 0, 0] } }],
  ["null look has no supported fallback", { look: null }],
  ["shot locator typo", { at: { text: "Save", typo: true } }],
  ["short shot point", { at: [640] }],
  ["shot ripple outside range", { ripple: 1.1 }],
  ["shot squish outside range", { squish: -0.1 }],
  ["shot magnet short rectangle", { magnet: [600, 380, 80] }],
  ["shot magnet nonnumeric rectangle", { magnet: [600, 380, 80, "40"] }],
];
for (const [name, cursor] of valid) {
  assert.deepEqual(errorsFor(withCursor(cursor)), [], `${name}: ${JSON.stringify(cursor)}`);
}
for (const [name, cursor] of invalid) {
  assert.ok(errorsFor(withCursor(cursor)).length > 0, `${name} must be rejected: ${JSON.stringify(cursor)}`);
}

// Exercise the consumer placements without changing #45's op/locator constraints.
const placements = [
  ["script", (cursor) => withCursor(cursor)],
  ["clip", (cursor) => ({ clip: { cursor }, steps: [{ goto: "/app" }] })],
  ["cursor-only with modifiers", (cursor) => ({ steps: [{ cursor, only: "clip", at: "1:02.5" }] })],
  ["step modifier", (cursor) => ({ steps: [{ click: "Save", cursor }] })],
  ["inline locator", (cursor) => ({ steps: [{ click: { selector: "#save", cursor } }] })],
  ["move wrapper", (cursor) => ({ steps: [{ move: { to: [900, 300], hold: 400, cursor } }] })],
  ["inline shot", (cursor) => ({ steps: [{ shot: { name: "here", cursor } }] })],
  ["inline card", (cursor) => ({ steps: [{ card: { title: "Demo", cursor } }] })],
  ["inline state", (cursor) => ({ steps: [{ state: { overlays: [], cursor } }] })],
  ["inline mark", (cursor) => ({ steps: [{ mark: { name: "here", cursor } }] })],
  ["inline keyframe", (cursor) => ({ steps: [{ keyframe: { name: "here", cursor } }] })],
];
for (const [name, scriptFor] of placements) {
  assert.deepEqual(errorsFor(scriptFor({ style: "comet_swoop", look: { shape: "ring" } })), [], `${name} accepts valid config`);
  assert.ok(errorsFor(scriptFor({ effects: { rippple: true } })).length > 0, `${name} rejects nested config typos`);
}
assert.deepEqual(errorsFor({ steps: [{ shot: { name: "here", cursor: { at: [640, 400], ripple: 0.35 } }, cursor: false }] }), [], "inline still keys and overriding modifier remain valid");
assert.ok(errorsFor({ steps: [{ move: { to: [900, 300], hold: 400, cursor: { style: "typo" } }, cursor: false }] }).length > 0, "overriding modifier does not hide invalid inline config");
assert.ok(errorsFor({ steps: [{ click: "Save", hover: "Save", cursor: {} }] }).length > 0, "cursor config does not weaken exactly-one-op validation");
for (const [cursor, field] of [[{ styel: "classic" }, "cursor.styel"], [{ effects: { rippple: true } }, "cursor.effects.rippple"], [{ trail: { fadeLen: 60 } }, "cursor.trail.fadeLen"], [{ look: { strokeWidth: 2 } }, "cursor.look.strokeWidth"]]) {
  assert.ok(errorsFor(withCursor(cursor)).some((error) => error.path === field && error.message.includes("unknown field")), `consumer error identifies ${field}`);
}
console.log(`Cursor config regressions: ${valid.length} valid, ${invalid.length} invalid, and ${placements.length} consumer placements passed.`);
