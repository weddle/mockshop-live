// Runner-only state API for assert_state / snapshot_state (core/state-assert.mjs): GET /__mockshop/state/<collection>[/<key>].
// Auto-loaded by handler-registry.mjs. Every reader asks the mock's own public routes, so a state assertion sees exactly what the page
// would read (same stores, same viewer, same access rules) and no second copy of state exists. Entity keys come from the world
// ({{agents.<key>.id}}, written to entities.json by the adapter); rows also carry `_key` when the world names them, so lists can be
// asserted in order with `keys:`. A key the world does not know is taken as the raw ID (rows created during the run, e.g. a new skill).
//
// To expose another collection, add one entry to COLLECTIONS (area owners edit only their own lines):
//   list(read)  -> rows (array)           item?(read, id) -> one row, undefined when absent (default: find in list by `id`)
//   id          -> field holding the entity ID (default "id")      root -> entities.json collection holding the world keys (default: the name)
const rows = (value, ...fields) => { for (const f of fields) if (Array.isArray(value?.[f])) return value[f]; return Array.isArray(value) ? value : []; };

const COLLECTIONS = {
  agents: { list: async (read) => rows(await read("/admin/persona")), item: (read, id) => read(`/persona/${id}`) },
  teams: { list: async (read) => rows(await read("/manage/admin/user-group")) },
  people: { list: async (read) => rows(await read("/manage/users/accepted/all")) },
  sources: { list: async (read) => rows(await read("/manage/admin/connector/status")), id: "cc_pair_id", item: (read, id) => read(`/manage/admin/cc-pair/${id}`) },
  llm_providers: { list: async (read) => rows(await read("/admin/llm/provider"), "providers") },
  skills: { list: async (read) => { const v = await read("/skills"); return [...rows(v, "builtins"), ...rows(v, "customs")]; } },
};

// Singletons: <namespace>/<name>
const SINGLETONS = {
  user: {
    pinned_agents: (read) => read("/user/pinned-assistants"),
    me: (read) => read("/me"),
    preferences: async (read) => (await read("/me"))?.preferences,
  },
};

// Every name `entity:` / `list:` may use; plugin.yaml state_api.collections must list the same (checked by handlers-state.test.mjs).
export const STATE_COLLECTIONS = [...Object.keys(COLLECTIONS), ...Object.keys(SINGLETONS)];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

export default function create(core) {
  const base = () => `http://127.0.0.1:${core.plugin.ports.mock}`;
  const read = async (path) => {
    const res = await fetch(`${base()}${path}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`state reader ${path} failed (${res.status})`);
    return res.json();
  };
  const entityKeys = (root) => core.data("entities")?.[root] || {};

  return {
    async state(parts) {
      const [name, key, ...rest] = parts;
      if (name === "browser" && key === undefined) return core.data("state")?.browser || {};
      if (SINGLETONS[name]) {
        if (!key || rest.length || !SINGLETONS[name][key]) throw bad(`unknown state entity ${parts.join("/")} (have: ${Object.keys(SINGLETONS[name]).map((k) => `${name}/${k}`).join(", ")})`);
        return SINGLETONS[name][key](read);
      }
      const collection = COLLECTIONS[name];
      if (!collection) throw bad(`unknown state collection "${name}" (have: ${[...Object.keys(COLLECTIONS), ...Object.keys(SINGLETONS), "browser"].join(", ")})`);
      if (rest.length) throw bad(`state path ${parts.join("/")} is too deep`);
      const idField = collection.id || "id", keys = entityKeys(collection.root || name);
      const keyOf = new Map(Object.entries(keys).map(([k, id]) => [String(id), k]));
      const all = (await collection.list(read)).map((row) => (keyOf.has(String(row[idField])) ? { ...row, _key: keyOf.get(String(row[idField])) } : row));
      if (key === undefined) return all;
      const id = Object.hasOwn(keys, key) ? keys[key] : key;
      const row = collection.item ? await collection.item(read, id) : undefined;
      return row ?? all.find((r) => String(r[idField]) === String(id));
    },
  };
}
