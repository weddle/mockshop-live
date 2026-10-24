// Handler registry: auto-loads every plugins/onyx/handlers-*.mjs that handlers.mjs does not compose itself, so adding a handler
// module never means editing shared wiring.
//
// Contract for a registered module (a file named handlers-<name>.mjs):
//   export const order = <number>;        // optional, default 100. Negative: runs before the core composition in handlers.mjs
//                                         //   (its routes match first, its transforms run first). Zero or positive: after it.
//   export default function create(core)  // returns { routes?, transform?, reset?(body) }
//     routes:    [{ method, path, handle(ctx) }]   same shape the server uses; return false from handle to fall through
//     transform: { "GET /path": (value, ctx) => value }   applied to fixture hits; chained per key in module order
//     reset:     (body) => void                    called on every POST /__mockshop/state
//     state:     (parts, ctx) => value | undefined  runner-only state API, GET /__mockshop/state/<parts...> (see handlers-state.mjs);
//                                                   return undefined to let the next module answer, throw { status: 400 } for a bad path
// Modules at equal `order` run in file-name order. The older handlers-*.mjs modules (admin pages, save controls, Craft, ...) have
// cross-module constructor wiring in handlers.mjs and are excluded by name via `composed`.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_ORDER = 100;

export async function discoverModules(dir, { composed = [] } = {}) {
  const skip = new Set(composed);
  const files = fs.readdirSync(dir).filter((f) => /^handlers-.+\.mjs$/.test(f) && !f.endsWith(".test.mjs") && !skip.has(f)).sort();
  const modules = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const create = mod.default;
    if (typeof create !== "function") throw new Error(`${file}: a registered handler module must default-export create(core) => { routes?, transform?, reset? }`);
    const order = mod.order ?? DEFAULT_ORDER;
    if (typeof order !== "number" || Number.isNaN(order)) throw new Error(`${file}: export const order must be a number`);
    modules.push({ file, order, create });
  }
  return modules.sort((a, b) => a.order - b.order || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

// Instantiate the modules and split them around the core composition (order < 0 before, otherwise after).
export function instantiate(core, modules) {
  const built = modules.map(({ file, order, create }) => ({ file, order, handlers: create(core) || {} }));
  const phase = (list) => ({
    routes: list.flatMap((b) => b.handlers.routes || []),
    transform: list.flatMap((b) => Object.entries(b.handlers.transform || {})),
    resets: list.flatMap((b) => (b.handlers.reset ? [b.handlers.reset] : [])),
    states: list.flatMap((b) => (b.handlers.state ? [b.handlers.state] : [])),
    files: list.map((b) => b.file),
  });
  return { before: phase(built.filter((b) => b.order < 0)), after: phase(built.filter((b) => b.order >= 0)) };
}

const then = (value, fn) => (value && typeof value.then === "function" ? value.then(fn) : fn(value));

// Fold the registered modules into the core handlers object ({ routes, transform, reset }) in place. Chains stay synchronous unless a
// link is async, because callers (and tests) invoke reset/transform directly.
export function attach(handlers, { before, after }) {
  handlers.routes = [...before.routes, ...handlers.routes, ...after.routes];
  const chain = (previous, next) => (value, ctx) => then(previous(value, ctx), (result) => (result?.__status === 401 ? result : next(result, ctx)));
  handlers.transform ||= {};
  for (const [key, fn] of before.transform) handlers.transform[key] = handlers.transform[key] ? chain(fn, handlers.transform[key]) : fn;
  for (const [key, fn] of after.transform) handlers.transform[key] = handlers.transform[key] ? chain(handlers.transform[key], fn) : fn;
  const states = [...before.states, ...after.states];
  if (states.length) {
    handlers.state = async (parts, ctx) => {
      for (const state of states) { const value = await state(parts, ctx); if (value !== undefined) return value; }
      return undefined;
    };
  }
  const resets = [...before.resets, ...after.resets];
  if (resets.length) {
    const coreReset = handlers.reset;
    handlers.reset = (body) => {
      const pending = [coreReset?.(body), ...resets.map((reset) => reset(body))].filter((r) => r && typeof r.then === "function");
      return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
    };
  }
  return handlers;
}
