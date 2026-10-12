// Presentation is separate from content: defaults, one profile, then script/scene/step scopes.
import { clipDefaults } from "./clip.mjs";
import { mergeCursor, resolveCursor } from "./cursor.mjs";
import { mergeData } from "./content.mjs";

const FRAME_KEYS = ["viewport", "scale", "theme"];

// Cursor visibility is a toggle, not a replacement for its inherited appearance.
export function mergePresentation(base, override = {}) {
  const out = { ...base };
  if (typeof out.cursor === "boolean" || typeof out.cursor === "string") out.cursor = mergeCursor({}, out.cursor);
  if (override.clip !== undefined) {
    out.clip = mergeData(base.clip || {}, override.clip);
    if (override.clip.cursor !== undefined) out.cursor = mergeCursor(out.cursor || {}, override.clip.cursor);
    if (override.clip.move_ms !== undefined) out.cursor = mergeCursor(out.cursor || {}, { timing: "fixed", ms: override.clip.move_ms });
    if (override.clip.pre_click_ms !== undefined) out.cursor = mergeCursor(out.cursor || {}, { pre_click_ms: override.clip.pre_click_ms });
  }
  if (override.cursor !== undefined) out.cursor = mergeCursor(out.cursor || {}, override.cursor);
  for (const key of FRAME_KEYS) if (override[key] !== undefined) out[key] = override[key];
  return out;
}

export function scriptPresentation(m, script, profile = {}, override = {}) {
  let settings = {
    cursor: resolveCursor(m.runner?.cursor, {}),
    clip: clipDefaults(),
    viewport: m.runner?.viewport || [1440, 900],
    scale: 1,
    theme: "light",
  };
  settings = mergePresentation(settings, profile);
  // Existing manually directed scripts keep their cursor/clip/frame settings.
  settings = mergePresentation(settings, script);
  settings = mergePresentation(settings, script.presentation);
  settings = mergePresentation(settings, override);
  if (typeof settings.clip.title === "string") settings.clip = { ...settings.clip, title: { title: settings.clip.title } };
  return settings;
}

// Store scope layers, rather than a snapshot, so explicit cursor instructions still persist.
export function stepPresentation(script, step, manualCursor = script._presentation.cursor, { includeStep = true } = {}) {
  let settings = { ...script._presentation, cursor: manualCursor };
  settings = mergePresentation(settings, step._presentation?.scene);
  if (includeStep) settings = mergePresentation(settings, step._presentation?.step ?? step.presentation);
  return settings;
}
