// Agents: apps.onyx.agents -> persona DTOs and catalogs.
import { own, entries, fail } from "./shared.mjs";

export function derive(ctx) {
  const { content, app, script, routes, number, personDto, sourceMap, agentMap, groups, agentsById } = ctx;
  const builtin = routes["GET /persona/0"];
  builtin.knowledge_sources = [...groups.keys()];
  for (const route of ["GET /persona", "GET /admin/persona"]) {
    const entry = routes[route]?.find((agent) => agent.id === 0);
    if (entry) entry.knowledge_sources = builtin.knowledge_sources;
  }
  const adminBuiltin = routes["GET /admin/agents"]?.items?.find((agent) => agent.id === 0);
  if (adminBuiltin) adminBuiltin.knowledge_sources = builtin.knowledge_sources;
  for (const [key, agent] of entries(app.agents)) {
    const id = number("agents", key, agent.id);
    const owner = agent.owner ? personDto(agent.owner) : null;
    const value = { ...builtin, ...agent, id, owner, builtin_persona: id === 0, name: agent.name, description: agent.description || "", knowledge_sources: agent.sources ? [...new Set(agent.sources.map((s) => { if (!sourceMap[s] || sourceMap[s].unsupported) fail(`apps.onyx.agents.${key}.sources`, `unsupported source ${s}`, script); return content.sources[s].vendor; }))] : [...groups.keys()] };
    delete value.sources;
    routes[`GET /persona/${id}`] = value; agentMap[key] = id; agentsById.set(id, value);
  }
  if (Object.keys(app.agents || {}).length) {
    const agents = Object.values(agentMap).map((id) => routes[`GET /persona/${id}`]);
    if (!agents.some((a) => a.id === 0) && builtin) agents.unshift(builtin);
    if (!own(app.fixtures || {}, "GET /persona")) routes["GET /persona"] = agents;
    if (!own(app.fixtures || {}, "GET /admin/persona")) routes["GET /admin/persona"] = agents;
    if (!own(app.fixtures || {}, "GET /admin/agents")) routes["GET /admin/agents"] = { items: agents, total_items: agents.length };
    if (!own(app.fixtures || {}, "GET /user/pinned-assistants")) routes["GET /user/pinned-assistants"] = agents.map((a) => a.id);
  }
}
