// Fictional group UI state only. No authorization engine, external writes or durable storage.
export default function createAdminGroupsHandlers(core, { listDocumentSets, getUser: getHuman, listConnectors, listAgents, serviceUser }) {
  let records = {}, permissionEdits = {}, limitEdits = {};
  const seed = () => core.fixture("GET", "/mockshop/admin-groups/seeds");
  const originals = () => core.fixture("GET", "/manage/admin/user-group") || [];
  // Human Users plus the derived Service Account users (sole apiKeys store; no second user store).
  const getUser = (identity) => getHuman(identity) || serviceUser?.(identity);
  const members = () => (core.state.adminGroupMembers ||= {});
  const reset = (body = {}) => {
    if (!body.keep) {
      records = {}; permissionEdits = {}; limitEdits = {};
      core.state.adminGroupMembers = {};
    }
  };
  const groupSeed = (id) => seed().groups.find((g) => g.id === Number(id));
  // Root composes the sole live connector/pair and agent stores.
  const connectorRows = listConnectors;
  const docSets = listDocumentSets;
  const agents = listAgents;
  const select = (rows, ids, key = "id") => rows.filter((row) => ids.includes(row[key]));
  const groupRows = (incoming = originals()) => {
    const connectors = connectorRows(), personas = agents(), sets = docSets();
    const ids = new Set(incoming.map((g) => g.id));
    return [...incoming, ...Object.values(records).filter((g) => !ids.has(g.id))]
      .filter((g) => !records[g.id]?.deleted).map((g) => {
        const config = groupSeed(g.id);
        const value = { ...g,
          ...(config ? {
            name: config.name, manager_ids: config.manager_ids, permissions: seed().resource_permissions,
            cc_pairs: select(connectors, config.cc_pair_ids, "cc_pair_id").map((cc) => ({ ...cc, id: cc.cc_pair_id })),
            document_sets: select(sets, config.document_set_ids),
            personas: select(personas, config.agent_ids),
          } : {}), ...records[g.id] };
        // Seed once, then join every read to the actual mutable Users catalog.
        members()[g.id] ??= structuredClone(g.users || []);
        const current = members()[g.id].map((m) => getUser(m.id) || getUser(m.email)).filter(Boolean);
        members()[g.id] = current.map(({ id, email }) => ({ id, email }));
        // Saved resource snapshots keep only their selected IDs: refresh each row from the current owner
        // (seed DTO fields stay, current metadata wins, rows no longer present drop).
        const cc_pairs = (value.cc_pairs || []).flatMap((p) => {
          const current = connectors.find((c) => c.cc_pair_id === (p.cc_pair_id ?? p.id));
          return current ? [{ ...p, ...current, id: current.cc_pair_id }] : [];
        });
        const livePersonas = (value.personas || []).flatMap((p) => {
          const current = personas.find((a) => a.id === p.id);
          return current ? [{ ...p, ...current }] : [];
        });
        const document_sets = (value.document_sets || []).flatMap((p) => {
          const current = sets.find((d) => d.id === p.id);
          return current ? [{ ...p, ...current }] : [];
        });
        return { ...value, cc_pairs, document_sets, personas: livePersonas,
          manager_ids: value.manager_ids.map((id) => getUser(id)?.id ?? id),
          users: current.map(({ id, email, is_active }) => ({ id, email, is_active })),
        };
      });
  };
  const group = (id) => groupRows().find((g) => g.id === Number(id));
  // Service Account Edit/New joins the account's synthetic user through the same member lists the Groups UI edits.
  const groupsOf = (userId) => groupRows().filter((g) => g.users.some((u) => u.id === userId)).map(({ id, name }) => ({ id, name }));
  const syncServiceGroups = (user, ids, replace) => {
    const wanted = new Set(ids.map(Number));
    for (const value of groupRows()) {
      const list = members()[value.id], has = list.some((m) => m.id === user.id);
      if (wanted.has(value.id) && !has) list.push({ id: user.id, email: user.email });
      else if (replace && !wanted.has(value.id) && has) members()[value.id] = list.filter((m) => m.id !== user.id);
    }
  };
  const getGroup = (ctx) => {
    const value = group(ctx.params.id);
    if (!value) ctx.send(404, { detail: "Fictional group not found." });
    return value;
  };
  const edit = (id, values) => { records[id] = { ...records[id], ...values, id: Number(id) }; };
  const userSnapshots = (ids) => ids.map(getUser).filter(Boolean).map(({ id, email }) => ({ id, email }));
  const permissions = (id) => permissionEdits[id] ?? groupSeed(id)?.enabled_permissions ?? [];
  const limits = (id) => (limitEdits[id] ||= structuredClone(groupSeed(id)?.token_limits || []));
  const groupLimit = (tokenId) => {
    for (const value of groupRows()) {
      const limit = limits(value.id).find((row) => String(row.token_id) === tokenId);
      if (limit) return { groupId: value.id, limit };
    }
  };
  const applySharing = (ctx, body, field, source, added, removed) => {
    const value = getGroup(ctx);
    if (!value) return;
    const ids = [...new Set([...value[field].map((row) => row.id), ...(body[added] || [])])]
      .filter((id) => !(body[removed] || []).includes(id));
    edit(value.id, { [field]: select(source(), ids) });
    ctx.send(200, {});
  };

  // Name only (same precedence as groupRows), without resource/membership joins; undefined when missing or deleted.
  const groupName = (id) => {
    const record = records[id];
    if (record?.deleted) return undefined;
    const original = originals().find((g) => g.id === Number(id));
    return original || record ? record?.name ?? groupSeed(id)?.name ?? original?.name : undefined;
  };
  return {
    reset,
    listGroups: groupRows,
    groupName, groupsOf, syncServiceGroups,
    routes: [
      { method: "GET", path: "/manage/admin/user-group", handle(ctx) { ctx.send(200, groupRows()); } },
      { method: "POST", path: "/manage/admin/user-group", async handle(ctx) {
        const body = await ctx.body();
        const id = Math.max(0, ...originals().map((g) => g.id), ...Object.keys(records).map(Number)) + 1;
        records[id] = { ...structuredClone(seed().create_defaults), id, name: body.name,
          users: [], permissions: { ...seed().resource_permissions },
          cc_pairs: select(connectorRows(), body.cc_pair_ids || [], "cc_pair_id").map((cc) => ({ ...cc, id: cc.cc_pair_id })) };
        members()[id] = userSnapshots(body.user_ids || []);
        ctx.send(200, group(id));
      } },
      { method: "PATCH", path: "/manage/admin/user-group/rename", async handle(ctx) {
        const body = await ctx.body();
        if (!group(body.id)) return ctx.send(404, { detail: "Fictional group not found." });
        edit(body.id, { name: body.name }); ctx.send(200, {});
      } },
      { method: "POST", path: "/manage/admin/user-group/:id/add-users", async handle(ctx) {
        const value = getGroup(ctx); if (!value) return;
        const { user_ids = [] } = await ctx.body();
        const list = members()[value.id];
        for (const user of userSnapshots(user_ids)) {
          if (!list.some((member) => member.id === user.id)) list.push(user);
        }
        ctx.send(200, {});
      } },
      { method: "PATCH", path: "/manage/admin/user-group/:id", async handle(ctx) {
        const body = await ctx.body();
        // Groups owns native membership-only and combined member/connector saves.
        if (!("user_ids" in body) && !("cc_pair_ids" in body)) return false;
        if (!getGroup(ctx)) return;
        if ("user_ids" in body) members()[ctx.params.id] = userSnapshots(body.user_ids);
        if ("cc_pair_ids" in body) edit(ctx.params.id, {
          cc_pairs: select(connectorRows(), body.cc_pair_ids, "cc_pair_id").map((cc) => ({ ...cc, id: cc.cc_pair_id })),
        });
        ctx.send(200, {});
      } },
      { method: "PUT", path: "/manage/admin/user-group/:id/manager", async handle(ctx) {
        const value = getGroup(ctx); if (!value) return;
        const body = await ctx.body();
        const userId = getUser(body.user_id)?.id ?? body.user_id;
        edit(value.id, { manager_ids: body.is_manager ? [...new Set([...value.manager_ids, userId])]
          : value.manager_ids.filter((id) => id !== userId) });
        ctx.send(200, {});
      } },
      { method: "PATCH", path: "/manage/admin/user-group/:id/incognito", async handle(ctx) {
        if (!getGroup(ctx)) return;
        edit(ctx.params.id, { incognito_enabled: (await ctx.body()).enabled }); ctx.send(200, {});
      } },
      { method: "GET", path: "/manage/admin/user-group/:id/permissions", handle(ctx) {
        if (getGroup(ctx)) ctx.send(200, permissions(ctx.params.id));
      } },
      { method: "PUT", path: "/manage/admin/user-group/:id/permissions", async handle(ctx) {
        if (!getGroup(ctx)) return;
        permissionEdits[ctx.params.id] = (await ctx.body()).permissions; ctx.send(200, {});
      } },
      { method: "PATCH", path: "/manage/admin/user-group/:id/agents", async handle(ctx) {
        applySharing(ctx, await ctx.body(), "personas", agents, "added_agent_ids", "removed_agent_ids");
      } },
      { method: "PATCH", path: "/manage/admin/user-group/:id/document-sets", async handle(ctx) {
        applySharing(ctx, await ctx.body(), "document_sets", docSets, "added_document_set_ids", "removed_document_set_ids");
      } },
      { method: "DELETE", path: "/manage/admin/user-group/:id", handle(ctx) {
        if (!getGroup(ctx)) return;
        edit(ctx.params.id, { deleted: true }); members()[ctx.params.id] = []; ctx.send(200, {});
      } },
      // Usage's Groups tab reads and edits this same group-owned limit store.
      { method: "GET", path: "/admin/token-rate-limits/user-groups", handle(ctx) {
        ctx.send(200, Object.fromEntries(groupRows().map((value) => [value.name, limits(value.id)])));
      } },
      { method: "PUT", path: "/admin/token-rate-limits/rate-limit/:id", async handle(ctx) {
        const owned = groupLimit(ctx.params.id);
        if (!owned) return false;
        Object.assign(owned.limit, await ctx.body()); ctx.send(200, owned.limit);
      } },
      { method: "DELETE", path: "/admin/token-rate-limits/rate-limit/:id", handle(ctx) {
        const owned = groupLimit(ctx.params.id);
        if (!owned) return false;
        limitEdits[owned.groupId] = limits(owned.groupId).filter((row) => row !== owned.limit);
        ctx.send(200, {});
      } },
      { method: "GET", path: "/admin/token-rate-limits/user-group/:id", handle(ctx) {
        if (getGroup(ctx)) ctx.send(200, limits(ctx.params.id));
      } },
      { method: "POST", path: "/admin/token-rate-limits/user-group/:id", async handle(ctx) {
        if (!getGroup(ctx)) return;
        const token_id = Math.max(600, ...groupRows().flatMap((g) => limits(g.id).map((l) => l.token_id))) + 1;
        const value = { ...await ctx.body(), token_id }; limits(ctx.params.id).push(value); ctx.send(200, value);
      } },
      { method: "PUT", path: "/admin/token-rate-limits/user-group/:id/rate-limit/:tokenId", async handle(ctx) {
        if (!getGroup(ctx)) return;
        const value = { ...await ctx.body(), token_id: Number(ctx.params.tokenId) };
        limitEdits[ctx.params.id] = limits(ctx.params.id).map((l) => l.token_id === value.token_id ? value : l); ctx.send(200, value);
      } },
      { method: "DELETE", path: "/admin/token-rate-limits/user-group/:id/rate-limit/:tokenId", handle(ctx) {
        if (!getGroup(ctx)) return;
        limitEdits[ctx.params.id] = limits(ctx.params.id).filter((l) => l.token_id !== Number(ctx.params.tokenId)); ctx.send(200, {});
      } },
    ],
    transform: {
      "GET /manage/admin/connector/status": (incoming) => incoming.map((cc) => ({ ...cc, groups: groupRows()
        .filter((g) => g.cc_pairs.some((p) => p.id === cc.cc_pair_id)).map(({ id, name }) => ({ id, name })) })),
      "GET /manage/admin/user-group": groupRows,
      "GET /manage/user-groups/minimal": (incoming) => {
        const names = new Map(groupRows().map((g) => [g.id, g.name]));
        const ids = new Set(incoming.map((g) => g.id));
        return [...incoming.filter((g) => !records[g.id]?.deleted).map((g) => ({ ...g, name: names.get(g.id) ?? g.name })),
          ...groupRows().filter((g) => !ids.has(g.id)).map(({ id, name }) => ({ id, name }))];
      },
      // The native New Group button checks this literal token, not the broad admin token.
      "GET /me": (value) => value.effective_permissions?.includes("admin")
        ? { ...value, effective_permissions: [...new Set([...value.effective_permissions, "manage:user_groups"])] } : value,
    },
  };
}
