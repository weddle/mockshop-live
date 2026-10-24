// assert_state / snapshot_state: script steps that check or remember the mock backend's own state instead of page-side fetch() code.
// The data comes from the plugin's runner-only state API (GET /__mockshop/state/<collection>[/<key>], see core/server.mjs); this module
// holds the pure logic so it is testable without a browser or server.
//
//   assert_state:   { entity: agents.guest-ops, field: is_listed, equals: false }
//                   { entity: people.robin, field: role, in: [basic, curator] }
//                   { list: agents, where: { is_listed: true }, order_by: display_priority, keys: [concierge, guest-ops] }
//                   { list: teams, count: 3 }
//                   { entity: agents.guest-ops, unchanged_since: before-unlist, except: [is_listed] }
//                   { entity: user.pinned_agents, equals_snapshot: pins-before }
//   snapshot_state: { as: before-unlist, entity: agents.guest-ops }          (or list:, optionally field:)
//
// Operators: equals, not_equals, in, contains (item / substring / object key), exists, count, keys (ordered), unchanged_since (+ except),
// equals_snapshot.
// Every operator given must hold. Snapshots live in one script run (the Map the runner passes in).
import { isDeepStrictEqual } from "node:util";

export const OPERATORS = ["equals", "not_equals", "in", "contains", "exists", "count", "keys", "unchanged_since", "equals_snapshot"];
export const LIST_ONLY = ["count", "keys", "where", "order_by"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const show = (v) => (v === undefined ? "undefined" : JSON.stringify(v));

// Dotted path read ("a.b.0.c"); undefined when any segment is missing.
export function at(value, field) {
  if (field === undefined || field === "") return value;
  return String(field).split(".").reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), value);
}

function without(value, fields = []) {
  const copy = structuredClone(value);
  if (!isObject(copy)) return copy;
  for (const field of fields) {
    const parts = String(field).split(".");
    let node = copy;
    for (const part of parts.slice(0, -1)) { node = node?.[part]; if (!isObject(node)) break; }
    if (isObject(node)) delete node[parts.at(-1)];
  }
  return copy;
}

// Static shape check shared by the runner and `./mockshop validate`. Returns [{ path, message }] relative to the step argument.
export function checkStep(op, arg, { known = new Set(), collections = null } = {}) {
  const errors = [], E = (path, message) => errors.push({ path, message });
  if (!isObject(arg)) return [{ path: "", message: `${op} expects an object` }];
  const targets = ["entity", "list"].filter((k) => arg[k] !== undefined);
  if (targets.length !== 1) E("", `${op} needs exactly one of entity or list`);
  const target = arg.entity ?? arg.list;
  if (typeof target === "string" && collections) {
    const collection = target.split(".")[0];
    if (!collections.includes(collection)) E(targets[0] || "entity", `unknown state collection "${collection}" (have: ${collections.join(", ")})`);
  }
  if (arg.entity !== undefined && !/^[^.]+\.[^.]+$/.test(String(arg.entity))) E("entity", "expected <collection>.<key>, e.g. agents.guest-ops");
  if (arg.list !== undefined && /\./.test(String(arg.list))) E("list", "expected a collection name, e.g. agents");
  if (arg.entity !== undefined) for (const k of LIST_ONLY) if (arg[k] !== undefined) E(k, `${k} only applies to list`);
  if (op === "snapshot_state") {
    if (typeof arg.as !== "string" || !arg.as) E("as", "snapshot_state needs a snapshot name (as:)");
    else if (known.has(arg.as)) E("as", `duplicate snapshot name "${arg.as}"`);
    for (const k of Object.keys(arg)) if (!["as", "entity", "list", "field", "where", "order_by"].includes(k)) E(k, `unknown snapshot_state field "${k}"`);
    return errors;
  }
  const given = OPERATORS.filter((k) => arg[k] !== undefined);
  if (!given.length) E("", `assert_state needs an operator (${OPERATORS.join(", ")})`);
  for (const name of [arg.unchanged_since, arg.equals_snapshot]) if (name !== undefined && !known.has(name)) E(arg.unchanged_since === name ? "unchanged_since" : "equals_snapshot", `no earlier snapshot_state named "${name}"`);
  if (arg.except !== undefined && arg.unchanged_since === undefined) E("except", "except only applies with unchanged_since");
  if (arg.in !== undefined && !Array.isArray(arg.in)) E("in", "expected a list of allowed values");
  if (arg.keys !== undefined && !Array.isArray(arg.keys)) E("keys", "expected an ordered list of entity keys");
  if (arg.where !== undefined && !isObject(arg.where)) E("where", "expected {field: value}");
  for (const k of Object.keys(arg)) if (!["entity", "list", "field", "where", "order_by", "except", "as", ...OPERATORS].includes(k)) E(k, `unknown assert_state field "${k}"`);
  return errors;
}

// The path a step reads: entity "agents.guest-ops" -> /agents/guest-ops, list "agents" -> /agents.
const pathOf = (arg) => (arg.entity !== undefined ? String(arg.entity).split(".").map(encodeURIComponent).join("/") : encodeURIComponent(arg.list));
export const statePath = (arg) => `/${pathOf(arg)}`;

// Select the value a step looks at. `read(path)` returns the parsed body, or undefined for a 404.
async function select(arg, read) {
  let value = await read(statePath(arg));
  if (arg.list !== undefined) {
    if (value === undefined) throw new Error(`state list "${arg.list}" does not exist`);
    if (!Array.isArray(value)) throw new Error(`state list "${arg.list}" did not return a list`);
    let rows = value;
    if (arg.where) rows = rows.filter((row) => Object.entries(arg.where).every(([field, expected]) => isDeepStrictEqual(at(row, field), expected)));
    if (arg.order_by !== undefined) {
      const desc = String(arg.order_by).startsWith("-"), field = String(arg.order_by).replace(/^-/, "");
      rows = rows.map((row, index) => ({ row, index })).sort((a, b) => {
        const x = at(a.row, field), y = at(b.row, field), none = (v) => v === undefined || v === null;
        if (none(x) || none(y)) return (none(x) - none(y)) || a.index - b.index;   // missing values last in both directions
        const order = x === y ? 0 : x < y ? -1 : 1;
        return (desc ? -order : order) || a.index - b.index;
      }).map(({ row }) => row);
    }
    return { rows, value: arg.field === undefined ? rows : rows.map((row) => at(row, arg.field)) };
  }
  return { value: at(value, arg.field) };
}

const label = (arg) => `${arg.entity ?? arg.list}${arg.field !== undefined ? `.${arg.field}` : ""}`;

// snapshot_state: remember the selected value under `as`.
export async function snapshot(arg, read, snapshots) {
  const { value } = await select(arg, read);
  snapshots.set(arg.as, structuredClone(value === undefined ? null : value));
}

// assert_state: throws an Error naming the entity, field, operator, expected and actual values on the first failed operator.
export async function assertState(arg, read, snapshots) {
  const { rows, value } = await select(arg, read);
  const name = label(arg), fail = (operator, expected, actual) => { throw new Error(`assert_state ${name} ${operator}: expected ${show(expected)}, got ${show(actual)}`); };
  const snap = (key) => { if (!snapshots.has(key)) throw new Error(`assert_state ${name}: no snapshot named "${key}" (snapshot_state must run first)`); return snapshots.get(key); };
  if (arg.exists !== undefined && (value !== undefined && value !== null) !== arg.exists) fail("exists", arg.exists, value);
  if (arg.equals !== undefined && !isDeepStrictEqual(value, arg.equals)) fail("equals", arg.equals, value);
  if (arg.not_equals !== undefined && isDeepStrictEqual(value, arg.not_equals)) fail("not_equals", `not ${show(arg.not_equals)}`, value);
  if (arg.in !== undefined && !arg.in.some((allowed) => isDeepStrictEqual(value, allowed))) fail("in", arg.in, value);
  if (arg.contains !== undefined) {
    // Array: an equal item, or (text) an item containing the text. String: substring. Object: has that key.
    const has = Array.isArray(value) ? value.some((item) => isDeepStrictEqual(item, arg.contains) || (typeof item === "string" && typeof arg.contains === "string" && item.includes(arg.contains)))
      : typeof value === "string" ? value.includes(arg.contains) : isObject(value) ? Object.hasOwn(value, arg.contains) : false;
    if (!has) fail("contains", arg.contains, value);
  }
  if (arg.count !== undefined && (rows ?? []).length !== arg.count) fail("count", arg.count, (rows ?? []).length);
  if (arg.keys !== undefined) {
    const actual = (rows ?? []).map((row) => row._key ?? String(row.id));
    if (!isDeepStrictEqual(actual, arg.keys)) fail("keys", arg.keys, actual);
  }
  if (arg.equals_snapshot !== undefined) { const before = snap(arg.equals_snapshot); if (!isDeepStrictEqual(value ?? null, before)) fail(`equals_snapshot ${arg.equals_snapshot}`, before, value); }
  if (arg.unchanged_since !== undefined) {
    const before = without(snap(arg.unchanged_since), arg.except), now = without(value ?? null, arg.except);
    if (!isDeepStrictEqual(now, before)) fail(`unchanged_since ${arg.unchanged_since}${arg.except?.length ? ` (except ${arg.except.join(", ")})` : ""}`, before, now);
  }
}
