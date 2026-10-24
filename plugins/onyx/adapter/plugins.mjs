// Plugins/MCP: apps.onyx.mcp_servers -> the admin/user MCP server lists and the MCP tools in GET /tool. `plugins` (unified Plugins entries)
// is declared in the schema but not derived yet and fails loudly.
import { rejectUnderived, own, entries, fail } from "./shared.mjs";

export const sections = ["plugins"];

const AUTH = { none: "NONE", api_token: "API_TOKEN", oauth: "OAUTH", pt_oauth: "PT_OAUTH" };

export function derive(ctx) {
  const { app, script, routes, number } = ctx;
  rejectUnderived(app, sections, script);
  const servers = entries(app.mcp_servers);
  if (!servers.length) return;
  const owner = routes["GET /me"]?.email || null;
  const rows = [], mcpTools = [];
  for (const [key, spec] of servers) {
    const id = number("mcp_servers", key, spec.id);
    const auth = spec.auth ?? "none";
    if (!own(AUTH, auth)) fail(`apps.onyx.mcp_servers.${key}.auth`, `unknown auth ${auth}`, script);
    const tools = (spec.tools || []).map((tool, index) => ({
      id: number("mcp_tools", `${key}/${tool.name}`, tool.id), name: tool.name, display_name: tool.display_name || tool.name,
      description: tool.description || "", definition: null, custom_headers: [], in_code_tool_id: null, passthrough_auth: false, mcp_server_id: id,
      enabled: tool.enabled !== false, chat_selectable: true, agent_creation_selectable: true, default_enabled: false,
      permissions: { edit: false, delete: false, toggle: true, authenticate: false },
    }));
    mcpTools.push(...tools);
    rows.push({
      id, name: spec.name, description: spec.description || "", server_url: spec.url || null, owner, transport: "STREAMABLE_HTTP",
      auth_type: AUTH[auth], auth_performer: "ADMIN", oauth_provider_mode: "AUTO_DISCOVERY", user_can_authenticate: true,
      status: spec.status || "CONNECTED", connection_status: spec.connection_status ?? "connected",
      default_chat_enabled: spec.default_chat_enabled ?? true, user_enabled_in_chat: spec.user_enabled_in_chat ?? true, user_enabled_in_craft: spec.user_enabled_in_craft ?? false, is_public: true, groups: [], users: [], available_in_craft: false, tool_count: tools.length,
      last_refreshed_at: "{{ago:1d}}", permissions: { edit: true, delete: true, authenticate: true, manage_status: true },
    });
  }
  for (const route of ["GET /mcp/servers", "GET /admin/mcp/servers"]) routes[route] = { ...routes[route], mcp_servers: rows };
  for (const route of ["GET /mcp/servers/persona/11", "GET /mcp/servers/persona/:id"]) routes[route] = { ...routes[route], mcp_servers: rows };
  routes["GET /tool"] = [...(routes["GET /tool"] || []), ...mcpTools];
}
