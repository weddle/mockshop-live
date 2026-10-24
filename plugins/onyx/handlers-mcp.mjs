// Fictional MCP management only: no discovery, execution, provider auth or saved secrets.
export default function createMcpHandlers(core) {
  let serverEdits = {}, toolEdits = {}, createdServers = {}, createdTools = {};
  const reset = (body = {}) => {
    if (!body.keep) { serverEdits = {}; toolEdits = {}; createdServers = {}; createdTools = {}; }
  };
  const fixtureServers = () => core.fixture("GET", "/admin/mcp/servers")?.mcp_servers || [];
  const fixtureTools = () => core.fixture("GET", "/tool") || [];
  const demo = () => core.fixture("GET", "/admin/mcp/mock-creation");
  const originals = () => [...fixtureServers(), ...Object.values(createdServers)];
  const allTools = () => [...fixtureTools(), ...Object.values(createdTools).flat()];
  const server = (id) => {
    const original = originals().find((s) => s.id === Number(id));
    return original && !serverEdits[id]?.deleted ? { ...original, ...serverEdits[id] } : null;
  };
  const tools = (id) => allTools().filter((t) => t.mcp_server_id === Number(id) &&
    (!createdServers[id] || server(id)?.tool_count > 0)).map((t) => ({ ...t, ...toolEdits[t.id] }));
  const admin = (ctx) => {
    const user = core.fixture("GET", "/me");
    if (user?.role === "admin" && user.admin_capabilities?.includes("admin")) return true;
    ctx.send(403, { detail: "Admin access is required for mock MCP management." });
    return false;
  };
  const configured = (ctx) => {
    if (!admin(ctx)) return null;
    const value = server(ctx.params.id);
    if (!value) ctx.send(404, { detail: "Configured mock MCP server not found." });
    return value;
  };
  const editServer = (id, values) => { serverEdits[id] = { ...serverEdits[id], ...values }; };
  const serverList = (value) => ({ ...value, mcp_servers: [...(value.mcp_servers || []), ...Object.values(createdServers)]
    .filter((s) => !serverEdits[s.id]?.deleted).map((s) => ({ ...s, ...serverEdits[s.id] })) });
  // Read the same current metadata as native admin list/detail, including local edits/deletes.
  const servers = () => serverList(core.fixture("GET", "/admin/mcp/servers") || { mcp_servers: [] }).mcp_servers;
  // Native Craft cards/preapprovals consume craft_connected, not the admin connection label.
  // This is fictional metadata from this store, never a provider/header-resolution operation.
  const craftServers = () => servers().map((row) => ({ ...row,
    craft_connected: row.status === "CONNECTED" && row.auth_type !== "PT_OAUTH" &&
      (row.auth_type === "NONE" || row.user_can_authenticate === true),
  }));
  const createServer = (body) => {
    const defaults = demo();
    const id = Math.max(0, ...originals().map((s) => s.id)) + 1;
    const firstToolId = Math.max(0, ...allTools().map((t) => t.id)) + 1;
    createdServers[id] = {
      ...defaults.server, id, name: body.name, description: body.description || defaults.server.description,
      server_url: body.server_url, owner: core.fixture("GET", "/me")?.email || defaults.server.owner,
      is_public: body.is_public ?? true, groups: body.is_public === false ? body.groups || [] : [],
      users: body.is_public === false ? body.users || [] : [],
    };
    createdTools[id] = defaults.tools.map((t, index) => ({ ...t, id: firstToolId + index, mcp_server_id: id }));
    return server(id);
  };
  // Only fictional placeholders survive a save, never the values typed into secret fields.
  const fakeCredentials = (values = {}) => Object.fromEntries(Object.keys(values)
    .map((key) => [key, demo().fake_credential]));
  const saveAuth = (id, body) => {
    const values = {};
    for (const key of ["transport", "auth_type", "auth_performer", "auth_template", "oauth_provider_mode",
      "oauth_authorization_endpoint", "oauth_token_endpoint", "oauth_scopes_override", "oauth_additional_auth_params"]) {
      if (key in body) values[key] = body[key];
    }
    const previous = server(id);
    const credentials = { ...(previous.admin_credentials || {}), ...fakeCredentials(body.admin_credentials) };
    for (const [field, key] of [["api_token", "api_key"], ["oauth_client_id", "client_id"], ["oauth_client_secret", "client_secret"]]) {
      if (body[`${field}_changed`] || body[field]) credentials[key] = body[field] ? demo().fake_credential : "";
    }
    editServer(id, { ...values, admin_credentials: credentials, user_credentials: fakeCredentials(body.admin_credentials),
      mock_authentication: { simulated: true, message: demo().auth_feedback },
      status: body.auth_type === "OAUTH" ? "AWAITING_AUTH" : "FETCHING_TOOLS" });
    return server(id);
  };

  return {
    reset, servers, craftServers,
    routes: [
      { method: "GET", path: "/admin/mcp/servers", handle(ctx) {
        if (!admin(ctx)) return;
        ctx.send(200, { ...core.fixture("GET", "/admin/mcp/servers"), mcp_servers: servers() });
      } },
      // The auth modal reads the plural detail path even when only Manage is opened.
      { method: "GET", path: "/admin/mcp/servers/:id", handle(ctx) {
        const value = configured(ctx);
        if (value) ctx.send(200, value);
      } },
      { method: "GET", path: "/admin/mcp/server/:id/tools/snapshots", handle(ctx) {
        if (!configured(ctx)) return;
        if (ctx.query.source === "mcp") {
          // Fake refresh keeps the inventory and enabled flags, but updates connection metadata.
          editServer(ctx.params.id, { status: "CONNECTED", tool_count: createdTools[ctx.params.id]?.length ?? server(ctx.params.id).tool_count,
            last_refreshed_at: new Date(core.demoNow()).toISOString() });
        }
        ctx.send(200, tools(ctx.params.id));
      } },
      { method: "PATCH", path: "/admin/tool/status", async handle(ctx) {
        const body = await ctx.body();
        const ids = [...new Set(body.tool_ids || [])];
        // Leave non-MCP tool batches to their owner instead of changing general action behavior.
        if (!ids.some((id) => allTools().some((t) => t.id === id && t.mcp_server_id != null))) return false;
        if (!admin(ctx)) return;
        if (typeof body.enabled !== "boolean" || !ids.every((id) => allTools().some((t) =>
          t.id === id && t.mcp_server_id != null && server(t.mcp_server_id) && t.permissions?.toggle))) {
          return ctx.send(400, { detail: "Only configured mock MCP tools can be toggled in this batch." });
        }
        for (const id of ids) toolEdits[id] = { enabled: body.enabled };
        ctx.send(200, { updated_count: ids.length, tool_ids: ids });
      } },
      { method: "PATCH", path: "/admin/mcp/server/:id", async handle(ctx) {
        if (!configured(ctx)) return;
        const body = await ctx.body();
        const values = {};
        for (const key of ["name", "description", "server_url", "is_public", "groups", "users", "available_in_craft", "tool_policies"]) {
          if (key in body) values[key] = body[key];
        }
        if (values.is_public) { values.groups = []; values.users = []; }
        editServer(ctx.params.id, values);
        ctx.send(200, server(ctx.params.id));
      } },
      { method: "PATCH", path: "/admin/mcp/server/:id/status", handle(ctx) {
        if (!configured(ctx)) return;
        if (!["CREATED", "AWAITING_AUTH", "CONNECTED", "DISCONNECTED", "FETCHING_TOOLS"].includes(ctx.query.status)) {
          return ctx.send(400, { detail: "Unknown fictional MCP connection status." });
        }
        editServer(ctx.params.id, { status: ctx.query.status });
        ctx.send(200, {});
      } },
      { method: "DELETE", path: "/admin/mcp/server/:id", handle(ctx) {
        if (!configured(ctx)) return;
        editServer(ctx.params.id, { deleted: true });
        ctx.send(200, {});
      } },
      { method: "POST", path: "/admin/mcp/server", async handle(ctx) {
        if (!admin(ctx)) return;
        ctx.send(200, createServer(await ctx.body()));
      } },
      { method: "POST", path: "/admin/mcp/servers/create", async handle(ctx) {
        if (!admin(ctx)) return;
        const body = await ctx.body();
        const value = body.existing_server_id != null ? server(body.existing_server_id) : createServer(body);
        if (!value) return ctx.send(404, { detail: "Configured mock MCP server not found." });
        ctx.send(200, saveAuth(value.id, body));
      } },
      { method: "POST", path: "/admin/mcp/oauth/connect", async handle(ctx) {
        if (!admin(ctx)) return;
        const body = await ctx.body();
        const value = server(body.server_id);
        if (!value) return ctx.send(404, { detail: "Configured mock MCP server not found." });
        editServer(value.id, { status: "CONNECTED",
          mock_authentication: { simulated: true, message: demo().auth_feedback } });
        // Native navigation DTO: bypass the external provider entirely, returning to the native page.
        ctx.send(200, { status: "completed", redirect_url: `/admin/mcp-actions/?server_id=${value.id}&trigger_fetch=true`,
          simulated: true, message: demo().auth_feedback });
      } },
    ],
    transform: {
      "GET /mcp/servers": serverList,
      "GET /mcp/servers/persona/:id": serverList,
      "GET /tool": (value) => [...value, ...Object.values(createdTools).flat()]
        .filter((t) => !serverEdits[t.mcp_server_id]?.deleted && (!createdServers[t.mcp_server_id] || server(t.mcp_server_id)?.tool_count > 0))
        .map((t) => t.mcp_server_id == null ? t : { ...t, ...toolEdits[t.id] }),
    },
  };
}
