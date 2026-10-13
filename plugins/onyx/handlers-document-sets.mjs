// Only document-set form state; no connector ingestion or indexing.
export default function createDocumentSetHandlers(core, { connectorRows, federatedRows }) {
  let records;
  let nextId;
  const reset = (body = {}) => { if (!body.keep) records = undefined; };
  const sets = () => {
    if (!records) {
      records = new Map(structuredClone(core.fixture("GET", "/manage/document-set") || []).map(row => [row.id, row]));
      nextId = Math.max(0, ...records.keys()) + 1;
    }
    return records;
  };
  const save = async (ctx, update) => {
    const body = await ctx.body();
    const rows = sets();
    const id = update ? Number(body.id) : nextId;
    const existing = rows.get(id);
    if (update && !existing) return ctx.send(404, { detail: "Document set not found" });
    const connectors = connectorRows();
    const selected = (body.cc_pair_ids || []).map(id => connectors.find(c => c.cc_pair_id === Number(id)));
    if (!body.name?.trim() || selected.some(c => !c) || (!selected.length && !body.federated_connectors?.length)) {
      return ctx.send(400, { detail: "A name and at least one available connector are required" });
    }
    const federated = federatedRows();
    const row = {
      ...existing, id, name: body.name, description: body.description || "",
      cc_pair_summaries: selected.map(c => ({ id: c.cc_pair_id, name: c.name, source: c.connector.source, access_type: c.access_type })),
      is_public: body.is_public, users: body.users || [], groups: body.is_public ? [] : body.groups || [],
      federated_connector_summaries: (body.federated_connectors || []).map(config => {
        const connector = federated.find(c => c.id === config.federated_connector_id);
        return { id: config.federated_connector_id, name: connector?.name, source: connector?.source, entities: config.entities };
      }),
      is_up_to_date: true,
      permissions: { edit: true, manage_access: true, delete: true, publish: true },
    };
    rows.set(id, row);
    if (!update) nextId++;
    ctx.send(200, row);
  };
  return {
    list: () => [...sets().values()],
    routes: [
      { method: "POST", path: "/manage/admin/document-set", handle: ctx => save(ctx, false) },
      { method: "PATCH", path: "/manage/admin/document-set", handle: ctx => save(ctx, true) },
      { method: "DELETE", path: "/manage/admin/document-set/:id", handle(ctx) {
        const deleted = sets().delete(Number(ctx.params.id));
        ctx.send(deleted ? 200 : 404, deleted ? { success: true } : { detail: "Document set not found" });
      } },
    ],
    transform: { "GET /manage/document-set": () => [...sets().values()] },
    reset,
  };
}
