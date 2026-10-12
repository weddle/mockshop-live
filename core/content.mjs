// Explicit data composition; worlds never execute code or fetch remote content.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { check } from "./validate.mjs";

const WORLD_KEYS = new Set(["company", "people", "teams", "sources", "documents", "conversations", "vars", "apps"]);
const ENTITY_KEYS = new Set(["people", "teams", "sources", "documents", "conversations"]);
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);
const PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const WHOLE_REF = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const REFERENCES = /\{\{\s*([^{}]+?)\s*\}\}/g;
const resolvedRoots = new WeakSet();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const childPath = (parent, key) => key === "" ? parent : parent ? `${parent}.${key}` : String(key);
const bracketPath = (key) => key.replace(/\.([0-9]+)(?=\.|$)/g, "[$1]");
const dottedPath = (key) => key.replace(/\[([0-9]+)\]/g, ".$1");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let worldSchema;

function originAt(origins, at, file = "<content>") {
  let key = dottedPath(at);
  while (true) {
    if (origins?.[key]) return origins[key];
    if (origins?.[bracketPath(key)]) return origins[bracketPath(key)];
    if (!key) return { file, line: 1 };
    key = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
  }
}

function fail(message, at = "", origins = {}, file) {
  const origin = originAt(origins, at, file);
  const error = new Error(`${origin.file}:${origin.line}: ${at || "(root)"}: ${message}`);
  error.file = origin.file;
  error.line = origin.line;
  error.path = at || "(root)";
  throw error;
}

function safeData(value, at = "", origins = {}, file, ancestors = new Set(), allowUndefined = false) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (allowUndefined && value === undefined)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("expected plain JSON/YAML data", at, origins, file);
  if (ancestors.has(value)) fail("cyclic data is not supported", at, origins, file);
  ancestors.add(value);
  for (const [key, item] of Object.entries(value)) {
    const next = childPath(at, key);
    if (UNSAFE.has(key)) fail(`unsafe property ${JSON.stringify(key)}`, next, origins, file);
    safeData(item, next, origins, file, ancestors, allowUndefined);
  }
  ancestors.delete(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function merge(base, override) {
  if (override === undefined) return clone(base);
  if (!object(base) || !object(override)) return clone(override);
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) result[key] = merge(base[key], value);
  return result;
}

// Omitted fields inherit; null, arrays and scalars replace. Neither input is mutated.
export function mergeData(base, override) {
  safeData(base, "", {}, "<merge>", new Set(), true);
  safeData(override, "", {}, "<merge>", new Set(), true);
  return merge(base, override);
}

function dropOrigins(origins, at) {
  for (const key of Object.keys(origins)) if (!at || key === at || key.startsWith(`${at}.`)) delete origins[key];
}

function mergeLayer(base, override) {
  const origins = { ...base.origins };
  function apply(a, b, at) {
    if (!object(a) || !object(b)) {
      dropOrigins(origins, at);
      for (const [key, origin] of Object.entries(override.origins)) if (!at || key === at || key.startsWith(`${at}.`)) origins[key] = origin;
      return;
    }
    if (override.origins[at]) origins[at] = override.origins[at];
    for (const [key, value] of Object.entries(b)) apply(a[key], value, childPath(at, key));
  }
  apply(base.data, override.data, "");
  return { data: merge(base.data, override.data), origins };
}

function addInput(state, file, bytes) {
  state.inputs.set(file, { file, hash: hash(bytes) });
}

function readBytes(file, at, origins, state) {
  try {
    const real = fs.realpathSync(file);
    if (!fs.statSync(real).isFile()) fail("expected a regular file", at, origins, file);
    const bytes = fs.readFileSync(real);
    addInput(state, real, bytes);
    return { file: real, bytes };
  } catch (error) {
    if (error.path === (at || "(root)")) throw error;
    fail(`cannot read ${JSON.stringify(file)}: ${error.message}`, at, origins, file);
  }
}

function relativeFile(value, declaringFile, at, origins) {
  if (typeof value !== "string" || !value || value.includes("\0") || /[\r\n]/.test(value) || path.isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.includes("\\") || value.startsWith("~") || value.includes("{{")) fail("expected an explicit relative local file path", at, origins, declaringFile);
  if (!declaringFile || declaringFile.startsWith("<")) fail("a declaring file is required for relative file paths", at, origins, declaringFile);
  return path.resolve(path.dirname(declaringFile), value);
}

function parseData(file, bytes) {
  const lines = new YAML.LineCounter();
  let document;
  try {
    document = YAML.parseDocument(bytes.toString("utf8"), { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  } catch (error) { fail(error.message, "", {}, file); }
  if (document.errors.length || document.warnings.length) {
    const error = document.errors[0] || document.warnings[0];
    const line = lines.linePos(error.pos?.[0] || 0).line;
    fail(error.message, "", { "": { file, line } }, file);
  }
  const origins = {};
  function visit(node, at, ancestors = new Set()) {
    origins[at] = { file, line: lines.linePos(node?.range?.[0] || 0).line };
    if (!node || ancestors.has(node)) return;
    ancestors.add(node);
    if (YAML.isMap(node)) {
      for (const pair of node.items) {
        if (!YAML.isScalar(pair.key) || typeof pair.key.value !== "string") fail("map keys must be strings", at, origins, file);
        const next = childPath(at, pair.key.value);
        if (UNSAFE.has(pair.key.value)) fail(`unsafe property ${JSON.stringify(pair.key.value)}`, next, { ...origins, [next]: { file, line: lines.linePos(pair.key.range[0]).line } }, file);
        visit(pair.value, next, ancestors);
      }
    } else if (YAML.isSeq(node)) node.items.forEach((item, index) => visit(item, childPath(at, index), ancestors));
    else if (YAML.isAlias(node)) {
      const origin = origins[at];
      visit(node.resolve(document), at, ancestors);
      origins[at] = origin;
    }
    ancestors.delete(node);
  }
  visit(document.contents, "");
  let data;
  try { data = document.toJS({ maxAliasCount: 100 }); }
  catch (error) { fail(error.message, "", origins, file); }
  if (!object(data)) fail("expected a data object", "", origins, file);
  safeData(data, "", origins, file);
  return { data, origins };
}

function expandBodies(layer, declaringFile, state) {
  function visit(value, at) {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, childPath(at, index)));
    if (!object(value)) return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) if (key !== "body_file") result[key] = visit(item, childPath(at, key));
    if (Object.hasOwn(value, "body_file")) {
      const field = childPath(at, "body_file");
      if (Object.hasOwn(value, "body")) fail("body and body_file cannot both be declared on the same object", field, layer.origins, declaringFile);
      const source = originAt(layer.origins, field, declaringFile).file;
      const body = readBytes(relativeFile(value.body_file, source, field, layer.origins), field, layer.origins, state);
      result.body = body.bytes.toString("utf8");
      dropOrigins(layer.origins, field);
      layer.origins[childPath(at, "body")] = { file: body.file, line: 1 };
    }
    return result;
  }
  return { data: visit(layer.data, ""), origins: layer.origins };
}

function composeLayer(layer, file, state, stack) {
  const includes = layer.data.includes;
  if (includes !== undefined && !Array.isArray(includes)) fail("includes must be a list of relative file paths", "includes", layer.origins, file);
  let result = { data: {}, origins: {} };
  for (const [index, include] of (includes || []).entries()) {
    const at = `includes.${index}`;
    const declaringFile = originAt(layer.origins, at, file).file;
    result = mergeLayer(result, readDataFile(relativeFile(include, declaringFile, at, layer.origins), state, stack, at, layer.origins));
  }
  const own = { data: { ...layer.data }, origins: { ...layer.origins } };
  delete own.data.includes;
  dropOrigins(own.origins, "includes");
  return mergeLayer(result, expandBodies(own, file, state));
}

function readDataFile(file, state, stack = [], at = "", origins = {}, includes = true) {
  if (!/\.(?:ya?ml|json)$/i.test(file)) fail("data files must use .yaml, .yml or .json", at, origins, file);
  const input = readBytes(file, at, origins, state);
  if (stack.includes(input.file)) fail(`include cycle: ${[...stack, input.file].join(" -> ")}`, at, origins, input.file);
  const layer = parseData(input.file, input.bytes);
  if (!includes && Object.hasOwn(layer.data, "includes")) fail("includes are only supported in world/content data, not scripts or presentation files", "includes", layer.origins, input.file);
  return composeLayer(layer, input.file, state, [...stack, input.file]);
}

function publicOrigins(origins) {
  const result = { ...origins };
  for (const [key, origin] of Object.entries(origins)) result[bracketPath(key)] = origin;
  return result;
}

// Generic script/profile/world data loading. Templates and shared types are not validated here.
export function loadData(file, { includes = true } = {}) {
  const state = { inputs: new Map() };
  const layer = readDataFile(path.resolve(file), state, [], "", {}, includes);
  return { ...layer, origins: publicOrigins(layer.origins), inputs: [...state.inputs.values()] };
}

function pathParts(expression, node) {
  if (typeof expression !== "string" || !PATH.test(expression) || expression.split(".").some((part) => UNSAFE.has(part))) fail(`unsafe or invalid reference path ${JSON.stringify(expression)}`, node.at, { [node.at]: node.origin });
  return expression.split(".");
}

function resolveTree(value, context, { file = "<content>", origins = {} } = {}) {
  safeData(value, "", origins, file);
  if (value !== context) safeData(context, "", {}, file);
  function nodes(data, at, sourceOrigins, literal = false) {
    const node = { at, origin: originAt(sourceOrigins, at, file), literal, value: data };
    if (Array.isArray(data)) node.value = data.map((item, index) => nodes(item, childPath(at, index), sourceOrigins, literal));
    else if (object(data)) node.value = Object.fromEntries(Object.entries(data).map(([key, item]) => [key, nodes(item, childPath(at, key), sourceOrigins, literal)]));
    return node;
  }
  const contextRoot = nodes(context, "", value === context ? origins : {}, resolvedRoots.has(context));
  const root = value === context ? contextRoot : nodes(value, "", origins, resolvedRoots.has(value));
  const expanded = new Map(), completed = new Map(), expanding = new Set(), resolving = new Set();
  const trail = [];
  const nodeError = (node, message) => fail(message, node.at, { [node.at]: node.origin }, file);

  function mergeNodes(base, override) {
    if (!object(base.value) || !object(override.value)) return override;
    const result = { ...base.value };
    for (const [key, item] of Object.entries(override.value)) result[key] = result[key] ? mergeNodes(result[key], item) : item;
    return { ...override, value: result };
  }

  function structure(node) {
    if (expanded.has(node)) return expanded.get(node);
    if (expanding.has(node)) nodeError(node, `reference/use cycle at ${node.at || "(root)"}`);
    expanding.add(node);
    let result = node;
    const ref = !node.literal && typeof node.value === "string" && node.value.match(WHOLE_REF);
    if (ref) result = structure(lookup(ref[1].trim(), node));
    else if (!node.literal && object(node.value) && Object.hasOwn(node.value, "use")) {
      const use = node.value.use;
      const base = structure(lookup(use.value, use));
      if (!object(base.value)) nodeError(use, "use must reference a structured object");
      const own = { ...node.value };
      delete own.use;
      result = mergeNodes(base, { ...node, value: own });
    }
    expanding.delete(node);
    expanded.set(node, result);
    return result;
  }

  function lookup(expression, source) {
    const parts = pathParts(expression, source);
    if (!WORLD_KEYS.has(parts[0])) nodeError(source, `unknown reference root ${JSON.stringify(parts[0])}`);
    let node = contextRoot;
    for (const key of parts) {
      node = structure(node);
      if ((!object(node.value) && !Array.isArray(node.value)) || !Object.hasOwn(node.value, key) || (Array.isArray(node.value) && !/^(?:0|[1-9][0-9]*)$/.test(key))) nodeError(source, `missing reference ${JSON.stringify(expression)}`);
      node = node.value[key];
    }
    return node;
  }

  function resolved(node) {
    if (completed.has(node)) return completed.get(node);
    if (resolving.has(node)) nodeError(node, `reference cycle: ${[...trail, node.at || "(root)"].join(" -> ")}`);
    resolving.add(node);
    trail.push(node.at || "(root)");
    let result = { value: node.value, origins: { "": node.origin } };
    if (typeof node.value === "string" && !node.literal) {
      const whole = node.value.match(WHOLE_REF);
      if (whole) {
        const target = resolved(lookup(whole[1].trim(), node));
        result = { value: target.value, origins: { ...target.origins, "": node.origin } };
      } else {
        result.value = node.value.replace(REFERENCES, (_, expression) => {
          const target = resolved(lookup(expression.trim(), node)).value;
          if (target !== null && typeof target === "object") nodeError(node, `embedded reference ${JSON.stringify(expression.trim())} must resolve to scalar text`);
          return String(target);
        });
      }
    } else if (Array.isArray(node.value) || object(node.value)) {
      const effective = node.literal ? node : structure(node);
      result.value = Array.isArray(effective.value) ? [] : {};
      for (const [key, item] of Object.entries(effective.value)) {
        const nested = resolved(item);
        result.value[key] = nested.value;
        for (const [at, origin] of Object.entries(nested.origins)) result.origins[childPath(key, at)] = origin;
      }
    }
    trail.pop();
    resolving.delete(node);
    completed.set(node, result);
    if (result.value !== null && typeof result.value === "object") resolvedRoots.add(result.value);
    return result;
  }
  const result = resolved(root);
  return result;
}

// Only original authored strings are interpreted. Substituted text is never templated again.
export function resolveContent(value, context, options = {}) {
  return resolveTree(value, context, options).value;
}

function inlineLayer(content, file, origins) {
  const selected = {};
  for (const [key, origin] of Object.entries(origins || {})) {
    const normalized = dottedPath(key);
    if (normalized === "content") selected[""] = origin;
    else if (normalized.startsWith("content.")) selected[normalized.slice(8)] = origin;
  }
  function visit(value, at) {
    selected[at] ||= { file: file || "<content>", line: 1 };
    if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(item, childPath(at, key));
  }
  safeData(content, "content", origins, file);
  if (!object(content)) fail("content must be an object", "content", origins, file);
  visit(content, "");
  return { data: clone(content), origins: selected };
}

function removeEntities(layer, remove, file, origins) {
  if (!Array.isArray(remove)) fail("remove must be a list of entity paths", "remove", origins, file);
  for (const [index, entry] of remove.entries()) {
    const at = `remove.${index}`;
    const parts = pathParts(entry, { at, origin: originAt(origins, at, file) });
    if (!(parts.length === 1 && parts[0] === "company") && !(parts.length === 2 && ENTITY_KEYS.has(parts[0])) && !(parts.length >= 2 && ["vars", "apps"].includes(parts[0]))) fail("remove entries must name company, a shared entity, or a variable/app entity path", at, origins, file);
    let parent = layer.data;
    for (const key of parts.slice(0, -1)) {
      if (!object(parent) || !Object.hasOwn(parent, key)) fail(`cannot remove missing entity ${JSON.stringify(entry)}`, at, origins, file);
      parent = parent[key];
    }
    const key = parts.at(-1);
    if (!object(parent) || !Object.hasOwn(parent, key)) fail(`cannot remove missing entity ${JSON.stringify(entry)}`, at, origins, file);
    delete parent[key];
    dropOrigins(layer.origins, entry);
  }
}

function validateShared(data, origins, file) {
  worldSchema ||= JSON.parse(fs.readFileSync(new URL("../schema/world.schema.json", import.meta.url), "utf8"));
  const errors = check(worldSchema.$defs.resolved, data, worldSchema);
  if (errors.length) fail(errors[0].message, dottedPath(errors[0].path === "(root)" ? "" : errors[0].path), origins, file);
  const relationship = (collection, key, at) => {
    if (!Object.hasOwn(data[collection] || {}, key)) fail(`unknown ${collection} entity ${JSON.stringify(key)}`, at, origins, file);
  };
  for (const collection of ENTITY_KEYS) for (const key of Object.keys(data[collection] || {})) if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key) || UNSAFE.has(key)) fail("entity keys must be stable letters, numbers, hyphens or underscores", `${collection}.${key}`, origins, file);
  for (const [key, team] of Object.entries(data.teams || {})) (team.members || []).forEach((person, index) => relationship("people", person, `teams.${key}.members.${index}`));
  for (const [key, document] of Object.entries(data.documents || {})) {
    relationship("sources", document.source, `documents.${key}.source`);
    if (document.author !== undefined && document.author !== null) relationship("people", document.author, `documents.${key}.author`);
    (document.owners || []).forEach((person, index) => relationship("people", person, `documents.${key}.owners.${index}`));
  }
  for (const [key, conversation] of Object.entries(data.conversations || {})) (conversation.messages || []).forEach((message, index) => {
    const at = `conversations.${key}.messages.${index}`;
    if (message.person !== undefined && message.person !== null) relationship("people", message.person, `${at}.person`);
    (message.documents || []).forEach((document, position) => relationship("documents", document, `${at}.documents.${position}`));
  });
}

// Includes -> owning world -> script content -> explicit removal -> references/use -> validation.
export function loadContent(worldFile, { content = {}, remove = [], file, origins = {}, inputs = [] } = {}) {
  const source = file ? path.resolve(file) : "<content>";
  const state = { inputs: new Map(inputs.map((input) => [input.file, input])) };
  let scriptOrigins = origins;
  if (file && fs.existsSync(source) && (!Object.keys(origins).length || !state.inputs.has(source))) {
    const input = readBytes(source, "", {}, state);
    if (!Object.keys(origins).length) scriptOrigins = parseData(input.file, input.bytes).origins;
  }
  const base = worldFile ? readDataFile(path.resolve(worldFile), state) : { data: {}, origins: {} };
  const local = composeLayer(inlineLayer(content, source, scriptOrigins), source, state, []);
  const merged = mergeLayer(base, local);
  removeEntities(merged, remove, source, scriptOrigins);
  const resolved = resolveTree(merged.data, merged.data, { file: worldFile ? path.resolve(worldFile) : source, origins: merged.origins });
  validateShared(resolved.value, resolved.origins, source);
  return { content: resolved.value, origins: publicOrigins(resolved.origins), inputs: [...state.inputs.values()] };
}
