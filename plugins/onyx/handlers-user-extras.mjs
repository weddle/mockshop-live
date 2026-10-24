// User-visible extras only. Agent records and personalization remain owned by handlers.mjs.
export default function createUserExtrasHandlers(core, agents) {
  let dismissed = new Set(), addedLabels = [], nextUpload = 1;
  const seed = () => {
    const value = { ...(core.fixture("GET", "/mockshop/user-extras") || {}),
      ...(core.data("state")?.user_extras?.options || {}) };
    return value.enabled ? value : { avatar_png_base64: value.avatar_png_base64, daily_stats: value.daily_stats };
  };
  const labels = () => [...(core.fixture("GET", "/persona/labels") || []), ...addedLabels];
  const users = () => agents.users();
  const groups = () => agents.groups();
  const notifications = () => (seed().notifications || []).map((n) => ({ ...n, dismissed: n.dismissed || dismissed.has(n.id) }));
  const summary = () => ({ total_items: notifications().length, undismissed_count: notifications().filter((n) => !n.dismissed).length });
  const agent = (ctx) => {
    const value = agents.getAgent(Number(ctx.params.id));
    if (!value) ctx.send(404, { detail: "Fictional agent not found" });
    return value;
  };
  const patch = (id, value) => {
    const current = agents.getAgent(Number(id));
    const merged = { ...current, ...value };
    merged.sharing_status = merged.is_public ? "PUBLIC" :
      merged.owner_group || merged.user_shares?.length || merged.group_shares?.length ? "SHARED" : "PRIVATE";
    agents.patchAgent(Number(id), { ...value, sharing_status: merged.sharing_status });
  };
  const sendPng = (ctx) => {
    // core's JSON send intentionally serializes objects; binary artwork uses the native response.
    ctx.res.writeHead(200, { "content-type": "image/png" });
    ctx.res.end(Buffer.from(seed().avatar_png_base64 || "", "base64"));
  };
  return {
    // Parent applies seedAgent ONLY to fixture records, before its existing permission projection.
    // Existing in-run records win over these editable seed decorations.
    seedAgent(value) { return value && { ...value, ...(seed().agent_defaults?.[value.id] || {}) }; },
    seedUser(value) {
      const data = seed(), user = { ...value, ...data.user_fields };
      return data.personalization ? { ...user, personalization: { ...value.personalization, ...data.personalization } } : user;
    },
    visibleAgent(value) { return !seed().empty_gallery || value.builtin_persona; },
    seedPins(value) { return seed().empty_sidebar ? [] : value; },
    // Apply before the existing settings owner's saved overrides; no second settings store.
    seedSettings(value) { return { ...value, ...seed().settings }; },
    labels,
    reset(body = {}) { if (!body.keep) { dismissed = new Set(); addedLabels = []; nextUpload = 1; } },
    routes: [
      { method: "GET", path: "/notifications/summary", handle(ctx) { ctx.send(200, summary()); } },
      { method: "GET", path: "/notifications", handle(ctx) {
        const severity = { info: 0, warning: 1, error: 2 };
        const minimum = severity[ctx.query.min_severity] ?? 0;
        const rows = notifications().filter((n) => severity[n.severity] >= minimum);
        const pageNum = Math.max(0, Number(ctx.query.page_num) || 0);
        const pageSize = Math.max(1, Math.min(50, Number(ctx.query.page_size) || 10));
        const start = pageNum * pageSize;
        ctx.send(200, { notifications: rows.slice(start, start + pageSize), total_items: rows.length,
          undismissed_count: rows.filter((n) => !n.dismissed).length, page_num: pageNum, page_size: pageSize,
          has_more: start + pageSize < rows.length });
      } },
      { method: "POST", path: "/notifications/dismiss-all", handle(ctx) {
        for (const n of notifications()) dismissed.add(n.id);
        ctx.send(200, null);
      } },
      { method: "POST", path: "/notifications/:id/dismiss", handle(ctx) {
        dismissed.add(Number(ctx.params.id)); ctx.send(200, null);
      } },
      { method: "GET", path: "/analytics/assistant/:id/stats", handle(ctx) {
        const rows = seed().daily_stats?.[ctx.params.id] || [];
        // Editable offsets anchor metrics to the runner's deterministic demo date, not the wall clock.
        const midnight = new Date(core.demoNow()); midnight.setUTCHours(0, 0, 0, 0);
        const start = ctx.query.start ? Date.parse(ctx.query.start) : -Infinity;
        const end = ctx.query.end ? Date.parse(ctx.query.end) : Infinity;
        const daily = rows.map((row) => ({ date: (row.date || new Date(midnight.getTime() - row.days_ago * 86400000).toISOString()).slice(0, 10),
          total_messages: row.total_messages, total_unique_users: row.total_unique_users }))
          .filter((row) => Date.parse(row.date) >= start && Date.parse(row.date) <= end);
        ctx.send(200, { daily_stats: daily,
          total_messages: daily.reduce((sum, row) => sum + row.total_messages, 0),
          total_unique_users: daily.reduce((sum, row) => sum + row.total_unique_users, 0) });
      } },
      { method: "GET", path: "/persona/labels", handle(ctx) { ctx.send(200, labels()); } },
      { method: "POST", path: "/persona/labels", async handle(ctx) {
        const { name } = await ctx.body();
        const existing = labels().find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
        const value = existing || { id: Math.max(0, ...labels().map((l) => l.id)) + 1, name: name.trim() };
        if (!existing) addedLabels.push(value);
        ctx.send(200, value);
      } },
      { method: "PATCH", path: "/persona/:id/share", async handle(ctx) {
        if (!agent(ctx)) return;
        const body = await ctx.body(), value = {};
        const userShares = body.user_shares ?? body.user_ids?.map((id) => ({ user_id: id, permission: "VIEWER" }));
        const groupShares = body.group_shares ?? body.group_ids?.map((id) => ({ group_id: id, permission: "VIEWER" }));
        if (userShares) {
          value.user_shares = userShares.map((s) => ({ user: users().find((u) => u.id === s.user_id), permission: s.permission })).filter((s) => s.user);
          value.users = value.user_shares.map((s) => s.user);
        }
        if (groupShares) {
          value.group_shares = groupShares.map((s) => ({ group_id: s.group_id,
            group_name: groups().find((g) => g.id === s.group_id)?.name, permission: s.permission })).filter((s) => s.group_name);
          value.groups = value.group_shares.map((s) => s.group_id);
        }
        for (const key of ["is_public", "public_permission"]) if (key in body) value[key] = body[key];
        if (body.label_ids) value.labels = labels().filter((l) => body.label_ids.includes(l.id));
        patch(ctx.params.id, value); ctx.send(200, null);
      } },
      { method: "POST", path: "/persona/:id/transfer-ownership", async handle(ctx) {
        if (!agent(ctx)) return;
        const body = await ctx.body();
        const owner = users().find((u) => u.id === body.new_owner_user_id);
        const ownerGroup = groups().find((g) => g.id === body.new_owner_group_id);
        if (!owner && !ownerGroup) return ctx.send(400, { detail: "Choose a fictional owner" });
        patch(ctx.params.id, { owner: owner || null, owner_group: ownerGroup || null, ownership_vacant: false });
        ctx.send(200, null);
      } },
      { method: "DELETE", path: "/persona/:id/share/me", handle(ctx) {
        const value = agent(ctx); if (!value) return;
        const me = agents.currentUser();
        patch(ctx.params.id, { user_shares: (value.user_shares || []).filter((s) => s.user.id !== me.id),
          users: (value.users || []).filter((u) => u.id !== me.id) });
        ctx.send(200, null);
      } },
      { method: "DELETE", path: "/persona/:id", handle(ctx) {
        if (!agent(ctx)) return;
        agents.deleteAgent(Number(ctx.params.id)); ctx.send(200, null);
      } },
      { method: "POST", path: "/admin/persona/upload-image", handle(ctx) {
        // Discard uploaded bytes. The editable fixture provides explicitly fictional avatar artwork.
        ctx.send(200, { file_id: `mock-user-extras-avatar-${nextUpload++}` });
      } },
      { method: "GET", path: "/persona/:id/avatar", handle(ctx) {
        if (!agent(ctx)) return;
        sendPng(ctx);
      } },
      { method: "GET", path: "/enterprise-settings/logo", handle(ctx) {
        if (!seed().branding) return false;
        sendPng(ctx);
      } },
      { method: "GET", path: "/enterprise-settings/logotype", handle(ctx) {
        if (!seed().branding) return false;
        sendPng(ctx);
      } },
    ],
    transform: {
      "GET /enterprise-settings": (value) => seed().branding ? { ...value, ...seed().branding } : value,
    },
  };
}
