// Resolve author data once, compile a complete fixture set, then run ordinary low-level steps.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadData, loadContent, resolveContent, contentRefs } from "./content.mjs";
import { check, scriptSchema } from "./validate.mjs";
import { mergePresentation, scriptPresentation } from "./presentation.mjs";
import { META_KEYS, parseAt } from "./timeline.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const uniqueInputs = (...lists) => [...new Map(lists.flat().map((input) => [input.file, input])).values()];
const fieldKey = (field) => field.replace(/\[(\d+)\]/g, ".$1");
const needsAdapter = (step) => step.send !== undefined || isObject(step.state) && ["world", "viewer", "sidebar", "connectors", "agent", "model"].some((key) => key in step.state);

function originAt(origins, field, file) {
  let key = fieldKey(field);
  while (key && !origins[key]) key = key.replace(/\.?[^.]+$/, "");
  return { file, line: 1, ...origins[key], field };
}

function invalid(file, origins, errors) {
  const diagnostics = errors.map(({ path: field, message }) => ({ ...originAt(origins, field, file), message }));
  const error = new Error(diagnostics.map((item) => `${item.file}:${item.line} ${item.field}: ${item.message}`).join("\n"));
  error.errors = diagnostics;
  throw error;
}

function validate(value, definition, schema, file, origins, field = "") {
  const errors = check(definition, value, schema, field);
  if (errors.length) invalid(file, origins, errors);
}

function dataFile(spec, base, field) {
  if (typeof spec !== "string" || !spec.trim() || spec.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(spec)) {
    throw new Error(`${base} ${field}: expected a local file path`);
  }
  return path.resolve(path.dirname(base), spec);
}

function loadPresentation(spec, base, field, definition, schema) {
  if (spec === undefined) return { data: {}, origins: {}, inputs: [], file: null };
  const file = dataFile(spec, base, field);
  const loaded = loadData(file, { includes: false });
  validate(loaded.data, definition, schema, file, loaded.origins);
  return { ...loaded, file };
}

function flatten(script, file, origins, overrides, overrideSource) {
  const scenes = script.scenes ?? [{ id: "main", steps: script.steps }];
  const seenScenes = new Set(), seenSteps = new Set(), generated = new Map();
  const steps = [], sceneInfo = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    const sceneField = script.scenes ? `scenes.${sceneIndex}` : "";
    if (seenScenes.has(scene.id)) invalid(file, origins, [{ path: `${sceneField}.id`, message: `duplicate scene ID "${scene.id}"` }]);
    seenScenes.add(scene.id);
    sceneInfo.push({ id: scene.id, ...(scene.title ? { title: scene.title } : {}), origin: originAt(origins, sceneField, file) });
    const scenePresentation = mergePresentation(scene.presentation || {}, overrides.scenes?.[scene.id]);
    for (const [index, step] of scene.steps.entries()) {
      const field = sceneField ? `${sceneField}.steps.${index}` : `steps.${index}`;
      let id = step.id;
      if (!id) {
        // Old flat manual scripts need no mechanical ID edits. Content-derived IDs survive unrelated insertions.
        const { presentation, ...action } = step;
        const stem = `step-${hash(JSON.stringify(action)).slice(0, 12)}`;
        const occurrence = (generated.get(stem) || 0) + 1;
        generated.set(stem, occurrence);
        id = occurrence === 1 ? stem : `${stem}-${occurrence}`;
      }
      if (seenSteps.has(id)) invalid(file, origins, [{ path: `${field}.id`, message: `duplicate step ID "${id}" (step IDs must be unique across scenes)` }]);
      seenSteps.add(id);
      if (step.at !== undefined && (parseAt(step.at) === null || !Number.isFinite(parseAt(step.at)) || parseAt(step.at) < 0)) {
        invalid(file, origins, [{ path: `${field}.at`, message: "expected a nonnegative seconds or mm:ss timestamp" }]);
      }
      steps.push({ ...step, id, author_id: id, scene: scene.id, origin: originAt(origins, field, file),
        _presentation: { scene: scenePresentation, step: mergePresentation(step.presentation || {}, overrides.steps?.[id]) } });
    }
  }
  for (const [target, known] of [["scenes", seenScenes], ["steps", seenSteps]]) {
    for (const id of Object.keys(overrides[target] || {})) if (!known.has(id)) {
      invalid(overrideSource.file, overrideSource.origins, [{ path: `${target}.${id}`, message: `unknown ${target === "scenes" ? "scene" : "step"} ID "${id}"` }]);
    }
  }
  return { steps, scenes: sceneInfo };
}

function executableSteps(steps, originals, schema, file, origins) {
  if (!Array.isArray(steps)) throw new Error(`${file}: plugin compile must return an array of steps`);
  const authors = new Map(originals.map((step) => [step.id, step]));
  const seen = new Set();
  return steps.map((step) => {
    if (!isObject(step)) throw new Error(`${file}: plugin returned a non-object step`);
    const author = authors.get(step.author_id ?? step.id);
    if (!author) throw new Error(`${file}: compiled step ${JSON.stringify(step.id)} has no matching author_id`);
    const out = { ...step, author_id: author.id, scene: author.scene, origin: author.origin, _presentation: author._presentation };
    if (typeof out.id !== "string" || !out.id || seen.has(out.id)) throw new Error(`${file}: compiled steps require unique nonempty IDs (got ${JSON.stringify(out.id)})`);
    seen.add(out.id);
    const action = Object.fromEntries(Object.entries(out).filter(([key]) => !META_KEYS.includes(key) || ["only", "at", "cursor"].includes(key)));
    validate(action, schema.$defs.step, schema, file, origins, author.origin.field);
    if (needsAdapter(action)) {
      invalid(file, origins, [{ path: author.origin.field, message: "this plugin did not compile the requested high-level operation" }]);
    }
    return out;
  });
}

// Script strings resolve against the resolved world plus the plugin's entity reference roots ({{agents.<key>.id}}).
function resolveWith({ content, refs }, options) {
  const roots = Object.keys(refs || {});
  return roots.length ? [{ ...content, ...refs }, { ...options, resolvedContext: true, roots }] : [content, options];
}

// Host world override (MOCKSHOP_WORLD=<file>, set by `--world <file>`): replaces the script's `world:`, so the same
// script runs unchanged against another world.
function scriptContent(m, raw, source, loaded) {
  const defaults = m.default_world === undefined ? undefined : dataFile(m.default_world, path.join(m.dir, "plugin.yaml"), "default_world");
  const world = process.env.MOCKSHOP_WORLD ? path.resolve(process.env.MOCKSHOP_WORLD) : raw.world === undefined ? null : dataFile(raw.world, source, "world");
  const hasContent = defaults !== undefined || world !== null || raw.content !== undefined || raw.remove !== undefined;
  const effective = hasContent
    ? loadContent(world, { defaults, content: raw.content ?? {}, remove: raw.remove ?? [], file: source, origins: loaded.origins, inputs: loaded.inputs, refs: contentRefs(m) })
    : { content: {}, refs: {}, origins: {}, inputs: [] };
  return { defaults, hasContent, effective };
}

// Output naming shares author content resolution, but never compiles fixtures or writes output during preflight.
const scriptName = (file, script) => script?.name || (file ? path.basename(file).replace(/\.(?:ya?ml|json)$/i, "") : "live");
export function resolveScriptName(m, file) {
  const source = path.resolve(file), loaded = loadData(source, { includes: false }), raw = loaded.data;
  if (typeof raw?.name !== "string" || !raw.name.includes("{{")) return scriptName(file, raw);
  const { hasContent, effective } = scriptContent(m, raw, source, loaded);
  return scriptName(file, hasContent ? resolveContent({ name: raw.name }, ...resolveWith(effective, { file: source, origins: loaded.origins })) : raw);
}

export async function prepareScript(m, file, opts = {}) {
  const source = file ? path.resolve(file) : "<live>";
  const loaded = opts.script !== undefined
    ? { data: structuredClone(opts.script), origins: {}, inputs: [{ file: source, hash: hash(JSON.stringify(opts.script)) }] }
    : loadData(source, { includes: false });
  if (!isObject(loaded.data)) invalid(source, loaded.origins, [{ path: "(root)", message: "expected a script object" }]);
  let raw = loaded.data;
  if (opts.steps && raw.steps === undefined && raw.scenes === undefined) raw = { ...raw, steps: [] };
  const schema = scriptSchema();
  if (raw.plugin !== undefined && raw.plugin !== m.name) invalid(source, loaded.origins, [{ path: "plugin", message: `expected selected plugin "${m.name}", got "${raw.plugin}"` }]);
  const { defaults, hasContent, effective } = scriptContent(m, raw, source, loaded);
  if (defaults && raw.world === undefined && !process.env.MOCKSHOP_WORLD) console.warn(`[${m.name}] No world selected; using neutral default content.`);
  // Never interpret template-looking strings in an existing manual script without a world/content context.
  const { content, remove, ...authoredScript } = raw;
  const resolved = hasContent ? resolveContent(authoredScript, ...resolveWith(effective, { file: source, origins: loaded.origins })) : authoredScript;
  validate({ ...resolved, ...(content !== undefined ? { content } : {}), ...(remove !== undefined ? { remove } : {}) }, schema, schema, source, loaded.origins);
  const profile = loadPresentation(opts.profile ?? resolved.profile, opts.profile !== undefined ? path.join(process.cwd(), "script.yaml") : source, "profile", schema.$defs.profile, schema);
  const overrides = loadPresentation(opts.renderOverrides, path.join(process.cwd(), "script.yaml"), "renderOverrides", schema.$defs.renderOverrides, schema);
  const flattened = flatten(resolved, source, loaded.origins, overrides.data, overrides);
  const presentation = scriptPresentation(m, resolved, profile.data, overrides.data.presentation);
  const script = { ...resolved, name: scriptName(file, resolved),
    ...(profile.file ? { profile: profile.file } : {}), steps: flattened.steps, cursor: presentation.cursor, clip: presentation.clip,
    viewport: presentation.viewport, scale: presentation.scale, theme: presentation.theme, _presentation: presentation };
  delete script.scenes;
  let inputs = uniqueInputs(loaded.inputs, effective.inputs, profile.inputs, overrides.inputs);
  let compiled = {}, outputDir = null;
  if (hasContent || script.steps.some(needsAdapter)) {
    const adapterFile = path.join(m.dir, "adapter.mjs");
    if (!fs.existsSync(adapterFile)) throw new Error(`${source}: plugin "${m.name}" has no adapter.mjs to compile script content or high-level operations`);
    inputs = uniqueInputs(inputs, [{ file: adapterFile, hash: hash(fs.readFileSync(adapterFile)) }]);
    const buildHash = hash(JSON.stringify({ plugin: m.name, edition: m.edition, content: effective.content, script, inputs })).slice(0, 24);
    outputDir = path.join(m.fixturesDir, ".built", buildHash);
    // The adapter may discover additional world-switch inputs; never retain files from an earlier snapshot.
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    const adapter = await import(pathToFileURL(adapterFile).href);
    if (typeof adapter.compile !== "function") throw new Error(`${adapterFile}: expected an exported compile(content, options) function`);
    script._resolved = { source, contentOrigins: effective.origins };
    compiled = await adapter.compile(effective.content, { m, script, outputDir });
    if (!isObject(compiled)) throw new Error(`${adapterFile}: compile must return an object`);
    script.overlays = compiled.overlays ?? [path.relative(m.fixturesDir, outputDir)];
    if (!Array.isArray(script.overlays) || !script.overlays.length || script.overlays.some((overlay) => typeof overlay !== "string" || path.isAbsolute(overlay) || path.relative(m.fixturesDir, path.resolve(m.fixturesDir, overlay)).startsWith(".."))) {
      throw new Error(`${adapterFile}: compile must select complete fixture overlays inside the plugin fixtures directory`);
    }
    inputs = uniqueInputs(inputs, compiled.inputs || []);
  }
  script.steps = executableSteps(compiled.steps ?? script.steps, flattened.steps, schema, source, loaded.origins);
  script._resolved = {
    source,
    content: effective.content,
    inputs,
    origins: { script: loaded.origins, content: effective.origins, profile: profile.origins, renderOverrides: overrides.origins, ...(compiled.origins ? { compiled: compiled.origins } : {}) },
    scenes: flattened.scenes,
    profile: profile.file,
    renderOverrides: overrides.file,
    ...(outputDir ? { outputDir } : {}),
  };
  if (outputDir) fs.writeFileSync(path.join(outputDir, "resolved.json"), JSON.stringify(script, null, 2));
  return script;
}
