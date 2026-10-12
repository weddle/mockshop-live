// Onyx plugin: dynamic mock routes. Contract: default export (core) => { routes, transform, reset }.
// Everything else is plain fixtures (fixtures/base/*.yaml).
import fs from "node:fs";
import path from "node:path";
import { buildChatStream, pickScript, withContext, sessionFromNodes } from "./chat.mjs";
import createMcpHandlers from "./handlers-mcp.mjs";
import createDocumentSetHandlers from "./handlers-document-sets.mjs";
import createSaveControls from "./handlers-save-controls.mjs";
import createUserFilesHandlers from "./handlers-user-files.mjs";
import createUserProjectHandlers from "./handlers-user-projects.mjs";
import createAdminGroupsHandlers from "./handlers-admin-groups.mjs";
import createAdminUsersHandlers from "./handlers-admin-users.mjs";
import createUserSearchHandlers from "./handlers-user-search.mjs";
import createAuthAnonymousHandlers from "./handlers-auth-anonymous.mjs";
import createBrowserExtensionHandlers from "./handlers-browser-extension.mjs";
import createSharingFeedbackHandlers from "./handlers-sharing-feedback.mjs";
import createUserExtrasHandlers from "./handlers-user-extras.mjs";
import createAdminPages from "./handlers-admin-pages.mjs";
import createUserCraft from "./handlers-user-craft.mjs";
import createUserConditional from "./handlers-user-conditional.mjs";

const HTML = { "content-type": "text/html; charset=utf-8" };
const SOURCE_NAMES = { google_drive: "Google Drive", confluence: "Confluence", slack: "Slack", zoom: "Zoom", notion: "Notion",
  sharepoint: "SharePoint", jira: "Jira", gmail: "Gmail", web: "Web" };
// Pinned UserProvider uses JSON bodies except for these three query-string toggles.
const PREFERENCE_ROUTES = [
  ["/user/theme-preference", "theme_preference"], ["/user/language", "language"],
  ["/user/chat-background", "chat_background"], ["/user/default-app-mode", "default_app_mode"],
  ["/user/default-model", "default_model"], ["/auto-scroll", "auto_scroll"],
  ["/temperature-default", "temperature_default"], ["/reasoning-effort-default", "reasoning_effort_default"],
  ["/temperature-override-enabled", "temperature_override_enabled", true],
  ["/shortcut-enabled", "shortcut_enabled", true], ["/paste-as-tile", "paste_as_tile", true],
];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// just enough markdown for fixture documents: # headings, - / 1. lists, **bold**, paragraphs
const mdToHtml = (md) => {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.*)/), li = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (h) { close(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
    else if (li) { const t = /\d/.test(li[1]) ? "ol" : "ul"; if (list !== t) { close(); out.push(`<${t}>`); list = t; } out.push(`<li>${inline(li[2])}</li>`); }
    else if (line.trim()) { close(); out.push(`<p>${inline(line)}</p>`); }
    else close();
  }
  close();
  return out.join("\n");
};
const sourcePage = (doc, body = null) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;color:#1f2328;background:#f6f7f9;margin:0}
main{max-width:760px;margin:48px auto;background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:32px 40px}
h1{font-size:24px;margin:0 0 8px}.meta{color:#5b636e;font-size:13px;margin-bottom:20px}.meta span+span:before{content:" · "}
.blurb{border-left:3px solid #c9ced6;padding:4px 14px;color:#3b424b;margin:0 0 20px}footer{color:#8a929c;font-size:12px;margin-top:28px;border-top:1px solid #eef0f2;padding-top:12px}</style></head>
<body><main data-testid="mockshop-source"><h1>${esc(doc.title)}</h1>
<div class="meta">${[SOURCE_NAMES[doc.source] || doc.source, doc.updated && `Updated ${String(doc.updated).slice(0, 10)}`, doc.owners?.length && doc.owners.join(", ")]
  .filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("")}</div>
${doc.blurb ? `<p class="blurb">${esc(doc.blurb)}</p>` : ""}${body ? mdToHtml(body.replace(/^#\s+.*\n/, "")) : ""}
<footer>Demo copy of a fictional document${doc.link ? ` (original location: ${esc(doc.link)})` : ""}.</footer></main></body></html>`;

export default function createHandlers(core, fileCompanions = {}) {
  const state = core.state;
  const mcp = createMcpHandlers(core);
  const documentSetForms = createDocumentSetHandlers(core);
  const saveControls = createSaveControls(core);
  const projects = createUserProjectHandlers(core, {
    getFile: (id) => userFiles.getFile(id),
    listChatSessions: () => sidebarSessions(),
  });
  const userFiles = createUserFilesHandlers(core, {
    ...fileCompanions,
    onProjectUpload(projectId, ids) {
      projects.associateFiles(projectId, ids);
      fileCompanions.onProjectUpload?.(projectId, ids);
    },
    projectFilesForSession: (id) => [...new Map([
      ...projects.projectFilesForSession(id), ...(fileCompanions.projectFilesForSession?.(id) || []),
    ].map((file) => [file.id, file])).values()],
    projectNamesForFile: (id) => [...new Set([
      ...projects.projectNamesForFile(id), ...(fileCompanions.projectNamesForFile?.(id) || []),
    ])],
    onFileRemoved(id) {
      projects.removeFile(id);
      fileCompanions.onFileRemoved?.(id);
    },
  });
  const adminGroups = createAdminGroupsHandlers(core, {
    listDocumentSets: documentSetForms.list,
    getUser: (identity) => adminUsers.getUser(identity),
  });
  const adminUsers = createAdminUsersHandlers(core, {
    ownsGroupWrites: true, listGroups: adminGroups.listGroups,
  });
  const userSearch = createUserSearchHandlers(core);
  const authAnonymous = createAuthAnonymousHandlers(core);
  const userConditional = createUserConditional(core, { stageMember: authAnonymous.stageMember });
  // These mutually referenced boundaries stay lazy: neither factory calls them during construction.
  const adminPages = createAdminPages(core, {
    listSkills: () => craft.listSkills(),
    afterAppWrite: (row, body) => craft.afterAppWrite(row, body),
    reconcileApps: (rows) => craft.reconcileApps(rows),
    listUsers: () => ({ ...core.fixture("GET", "/manage/users"), accepted: adminUsers.acceptedUsers() }),
  });
  // Read the sole live #3 catalog and apply #65's saved defaults lazily.
  const providerCatalog = () => adminPages.transform["GET /llm/provider"](state.saveControlsProviderCatalog());
  // Dynamic responses bypass fixture transforms; compose defaults on the same readers.
  const providerReads = new Set(["/admin/llm/provider", "/llm/provider", "/llm/persona/:id/providers"]);
  const saveControlRoutes = saveControls.routes.map((route) => {
    if (route.method !== "GET" || !providerReads.has(route.path)) return route;
    const key = route.path === "/admin/llm/provider" ? "GET /admin/llm/provider" : "GET /llm/provider";
    return { ...route, handle(ctx) {
      return route.handle({ ...ctx, send: (status, value, headers) =>
        ctx.send(status, status === 200 ? adminPages.transform[key](value, ctx) : value, headers) });
    } };
  });
  const craft = createUserCraft(core, {
    apps: () => adminPages.apps(),
    mcpServers: () => mcp.craftServers(),
    providerCatalog,
    serveFile: userFiles.serveFile,
    previewOrigin: () => `http://127.0.0.1:${core.plugin.ports.web}`,
    users: () => adminUsers.acceptedUsers().map(({ id, email }) => ({ id, email })),
    groups: () => adminGroups.transform["GET /manage/user-groups/minimal"](
      core.fixture("GET", "/manage/user-groups/minimal") || []),
  });
  // Run-local sessions and edits are scoped by org, including identical fixture history ids.
  const reset = () => { state.chatSessions = {}; state.nextSessionN = 1; state.nextMsgId = 1001; state.edits = {}; state.deletedAll = {}; };
  reset();
  state.org = "";
  // Agent configuration belongs to an overlay/org; ordered pins belong to its requesting user.
  // Keep this separate from chat resets and user settings so a live switch can revisit either.
  const resetAgents = () => { state.agentOrgs = {}; };
  resetAgents();
  const agentUser = () => {
    const user = currentUser(core.fixture("GET", "/me"));
    if (user?.__status === 401) return user;
    const current = adminUsers.getUser(user.id) || adminUsers.getUser(user.email);
    // Canonical Users identity joins ownership/pins without replacing fixture permissions.
    return authAnonymous.currentUser(current ? { ...user, id: current.id, email: current.email } : user,
      userSettings().personalization);
  };
  const agentAdmin = () => (agentUser()?.effective_permissions || []).includes("admin");
  const agentPermission = (name) => agentAdmin() || (agentUser()?.effective_permissions || []).includes(name);
  const agentManager = () => agentPermission("manage:agents");
  const agentOrg = () => (state.agentOrgs[state.org] ||= { personas: {}, deleted: {}, pins: {}, nextId: null });
  const seedAgents = () => core.fixture("GET", "/persona") || [];
  const fullAgent = (id) => agentOrg().deleted[id] ? null : agentOrg().personas[id] ||
    (seedAgents().some((a) => a.id === id) ? extras.seedAgent(core.fixture("GET", `/persona/${id}`)) : null);
  const extras = createUserExtrasHandlers(core, {
    getAgent: fullAgent,
    patchAgent: (id, values) => { agentOrg().personas[id] = { ...fullAgent(id), ...values }; },
    deleteAgent: (id) => { agentOrg().deleted[id] = true; delete agentOrg().personas[id]; },
    currentUser: () => agentUser(),
  });
  const agentGroups = () => adminGroups.listGroups()
    .filter((g) => g.users?.some((u) => u.id === agentUser()?.id || u.email === agentUser()?.email)).map((g) => g.id);
  const agentAccess = (a) => {
    const user = agentUser(), groups = agentGroups();
    const owner = a.owner?.id === user?.id || (a.owner_group && groups.includes(a.owner_group.id));
    const shares = [
      ...(a.user_shares || []).filter((s) => s.user.id === user?.id),
      ...(a.group_shares || []).filter((s) => groups.includes(s.group_id)),
    ];
    const editor = owner || shares.some((s) => s.permission === "EDITOR") || (a.is_public && a.public_permission === "EDITOR");
    return {
      owner, editor: agentManager() || editor,
      view: agentManager() || agentPermission("read:agents") || owner || (a.is_public && a.is_listed) || (a.is_listed && shares.length > 0),
    };
  };
  const agentSnapshot = (a) => {
    const access = agentAccess(a), admin = agentAdmin(), manager = agentManager(), owner = access.owner || manager;
    return { default_model_configuration_id: null, uploaded_image_id: null, ...a,
      owner: a.owner ? { ...a.owner, email: owner ? a.owner.email : "" } : null,
      user_permission: access.owner ? "OWNER" : access.editor ? "EDITOR" : "VIEWER",
      permissions: { edit: access.editor, share: access.editor,
        view_stats: owner && agentPermission("read:agent_analytics"),
        delete: owner && agentPermission("add:agents"), publish: owner,
        feature: manager, list: manager, reorder: admin },
    };
  };
  const minimalAgent = (a) => Object.fromEntries([
    "id", "name", "description", "tools", "starter_messages", "document_sets", "knowledge_sources",
    "default_model_configuration_id", "uploaded_image_id", "icon_name", "is_public", "is_listed",
    "display_priority", "is_featured", "builtin_persona", "labels", "owner", "owner_group", "user_permission", "permissions",
  ].map((k) => [k, a[k]]).concat([
    ["hierarchy_node_count", a.hierarchy_nodes?.length || 0], ["attached_document_count", a.attached_documents?.length || 0],
  ]));
  const agentCatalog = ({ full = false } = {}) => {
    const seeds = seedAgents();
    const seeded = seeds.map((a) => fullAgent(a.id)).filter((a) => a && extras.visibleAgent(a));
    const added = Object.values(agentOrg().personas).filter((a) => !seeds.some((s) => s.id === a.id));
    return [...seeded, ...added]
      .filter((a) => a && agentAccess(a).view)
      .sort((a, b) => (a.display_priority ?? Infinity) - (b.display_priority ?? Infinity) || a.id - b.id)
      .map((a) => full ? agentSnapshot(a) : minimalAgent(agentSnapshot(a)));
  };
  const curateAgent = async (ctx, field) => {
    if (!agentManager()) return ctx.send(403, { detail: "Not enough permissions" });
    const id = Number(ctx.params.id), persona = fullAgent(id);
    if (!persona) return ctx.send(404, { detail: `Agent with ID ${ctx.params.id} does not exist` });
    const body = await ctx.body();
    if (typeof body[field] !== "boolean")
      return ctx.send(422, { detail: `${field} must be a boolean` });
    agentOrg().personas[id] = { ...persona, [field]: body[field] };
    ctx.send(200, null);
  };
  const pinnedAgents = () => (agentOrg().pins[agentUser()?.id] ??
    extras.seedPins(core.fixture("GET", "/user/pinned-assistants") ?? agentUser()?.preferences?.pinned_assistants ?? []))
    .filter((id) => { const value = fullAgent(id); return value && agentAccess(value).view; });
  const saveAgent = async (ctx, id = null) => {
    const org = agentOrg(), body = await ctx.body(), existing = id == null ? null : fullAgent(id);
    if (id == null && !agentPermission("add:agents")) return ctx.send(403, { detail: "Not enough permissions" });
    if (id != null && (!existing || !agentAccess(existing).editor))
      return ctx.send(403, { detail: `Persona with ID ${id} does not exist or user is not authorized to access it` });
    if (existing?.builtin_persona) return ctx.send(400, { detail: "Cannot update builtin persona with non-builtin." });
    if (body.is_featured && !agentManager())
      return ctx.send(400, { detail: "Only users with agent management permissions can make a featured persona" });
    // The native service sends a complete PersonaUpsertRequest. Match FastAPI's missing-field response.
    const missing = ["name", "description", "system_prompt", "task_prompt", "document_set_ids", "tool_ids", "datetime_aware"]
      .filter((k) => !(k in body));
    if (missing.length) return ctx.send(422, { detail: missing.map((k) => ({ type: "missing", loc: ["body", k], msg: "Field required", input: body })) });
    const duplicate = [...seedAgents().map((a) => fullAgent(a.id)), ...Object.values(org.personas)]
      .find((a) => a && a.id !== id && a.name === body.name && (agentManager() || a.owner?.id === agentUser()?.id));
    if (duplicate) return ctx.send(400, { detail: `Assistant with name '${body.name}' already exists. Please rename your assistant.` });
    const tools = (core.fixture("GET", "/tool") || []).filter((t) => body.tool_ids.includes(t.id));
    if (body.tool_ids.length && !tools.length) return ctx.send(400, { detail: "Tools not found" });
    const documentSets = documentSetForms.list().filter((d) => body.document_set_ids.includes(d.id));
    // Attach the current fictional document-set snapshots, including in-run edits.
    const files = core.fixture("GET", "/user/files/recent") || [];
    if (body.user_file_ids?.some((id) => !userFiles.getFile(id) && !files.some((f) => f.id === id)))
      return ctx.send(400, { detail: "user_files not found" });
    const hierarchy = existing?.hierarchy_nodes || [], documents = existing?.attached_documents || [];
    if (body.hierarchy_node_ids?.some((id) => !hierarchy.some((n) => n.id === id)) ||
        body.document_ids?.some((id) => !documents.some((d) => d.id === id)))
      return ctx.send(400, { detail: "Attached knowledge not found in fixtures" });
    const user = agentUser(), canPublish = !existing || agentAccess(existing).owner || agentManager();
    const users = body.users == null ? existing?.users || [] :
      adminUsers.acceptedUsers().filter((u) => body.users.includes(u.id) && u.id !== user.id)
        .map(({ id, email }) => ({ id, email }));
    const groups = body.groups ?? existing?.groups ?? [];
    const groupNames = adminGroups.listGroups();
    const persona = { ...existing,
      id: id ?? (org.nextId ??= Math.max(0, ...seedAgents().map((a) => a.id)) + 1),
      name: body.name, description: body.description, system_prompt: body.system_prompt, task_prompt: body.task_prompt,
      datetime_aware: body.datetime_aware, replace_base_system_prompt: body.replace_base_system_prompt ?? false,
      tools, document_sets: documentSets, starter_messages: body.starter_messages ?? null,
      default_model_configuration_id: body.default_model_configuration_id ?? null,
      search_start_date: body.search_start_date ?? null, icon_name: body.icon_name ?? null,
      uploaded_image_id: body.remove_image || body.uploaded_image_id ? body.uploaded_image_id ?? null : existing?.uploaded_image_id ?? null,
      is_public: canPublish ? body.is_public ?? existing?.is_public ?? true : existing.is_public,
      is_featured: agentManager() ? body.is_featured ?? existing?.is_featured ?? false : existing?.is_featured ?? false,
      is_listed: existing?.is_listed ?? true, builtin_persona: existing?.builtin_persona ?? false,
      display_priority: existing?.display_priority ?? body.display_priority ?? null,
      labels: body.label_ids == null ? existing?.labels || [] :
        extras.labels().filter((l) => body.label_ids.includes(l.id)),
      user_file_ids: body.user_file_ids ?? existing?.user_file_ids ?? [],
      hierarchy_nodes: body.hierarchy_node_ids == null ? hierarchy : hierarchy.filter((n) => body.hierarchy_node_ids.includes(n.id)),
      attached_documents: body.document_ids == null ? documents : documents.filter((d) => body.document_ids.includes(d.id)),
      owner: existing ? existing.owner : { id: user.id, email: user.email }, owner_group: existing?.owner_group ?? null,
      users, groups,
      user_shares: body.users == null ? existing?.user_shares || [] : users.map((u) => ({
        user: u, permission: existing?.user_shares?.find((s) => s.user.id === u.id)?.permission ?? "VIEWER",
      })),
      group_shares: body.groups == null ? existing?.group_shares || [] :
        groupNames.filter((g) => groups.includes(g.id)).map((g) => ({
          group_id: g.id, group_name: g.name,
          permission: existing?.group_shares?.find((s) => s.group_id === g.id)?.permission ?? "VIEWER",
        })),
      public_permission: existing ? existing.public_permission : "VIEWER",
      admin_count: existing?.admin_count ?? fullAgent(0)?.admin_count ?? 0, ownership_vacant: false,
    };
    persona.sharing_status = persona.is_public ? "PUBLIC" :
      persona.owner_group || persona.user_shares.length || persona.group_shares.length ? "SHARED" : "PRIVATE";
    persona.knowledge_sources = [...new Set([
      ...documentSets.flatMap((d) => (d.cc_pair_summaries || []).map((p) => p.source)),
      ...persona.hierarchy_nodes.map((n) => n.source), ...persona.attached_documents.map((d) => d.source).filter(Boolean),
      ...(persona.user_file_ids.length ? ["user_file"] : []),
    ])];
    org.personas[persona.id] = persona;
    if (id == null) org.nextId++;
    // POST/PATCH return PersonaSnapshot; detail is full and the catalog is minimal.
    const { search_start_date, user_permission, admin_count, ownership_vacant, knowledge_sources, ...snapshot } = persona;
    ctx.send(200, { ...snapshot, permissions: {} });
  };
  const chatKey = (id) => `${state.org}:${id}`;
  const chatSession = (id) => state.chatSessions[chatKey(id)];
  const chatEdit = (id) => state.edits[chatKey(id)] || {};
  const edit = (id) => (state.edits[chatKey(id)] ||= {});
  // #31 owns settings writes and GET /me. Read its lazy preference overlay without seeding or replacing it.
  const defaultChatModel = () => {
    const user = core.fixture("GET", "/me");
    const preferences = state.userSettings?.[`${state.org}:${user.id}`]?.preferences;
    return preferences && Object.hasOwn(preferences, "default_model")
      ? preferences.default_model : user.preferences?.default_model ?? null;
  };
  // Pinned structureValue/parseLlmDescriptor: provider display name__provider__model[__mc:<id>].
  const modelOverride = (value) => {
    if (!value) return null;
    const parts = value.split("__"), last = parts.at(-1);
    const hasId = parts.length >= 4 && /^mc:\d+$/.test(last);
    return { model_provider: parts[0], model_version: parts.slice(2, hasId ? -1 : undefined).join("__"),
      model_configuration_id: hasId ? Number(last.slice(3)) : null };
  };
  const answerModel = (override, personaId) => {
    const catalog = providerCatalog() || core.fixture("GET", `/llm/persona/${personaId}/providers`) || core.fixture("GET", "/llm/provider");
    const providers = catalog?.providers || [];
    let provider, model;
    if (override?.model_configuration_id != null) {
      provider = providers.find((p) => p.model_configurations.some((m) => m.id === override.model_configuration_id));
      model = provider?.model_configurations.find((m) => m.id === override.model_configuration_id);
    } else if (override?.model_version) {
      provider = providers.find((p) => p.name === override.model_provider || p.provider === override.model_provider);
      model = provider?.model_configurations.find((m) => m.name === override.model_version);
    } else {
      provider = providers.find((p) => p.id === catalog?.default_text?.provider_id);
      model = provider?.model_configurations.find((m) => m.name === catalog?.default_text?.model_name);
    }
    return { ...override, model_provider: provider?.name ?? override?.model_provider,
      model_version: model?.name ?? override?.model_version,
      model_configuration_id: model?.id ?? override?.model_configuration_id ?? null,
      display_name: model?.custom_display_name || model?.display_name || model?.name || override?.display_name || override?.model_version || null };
  };
  state.userSettings = {};
  // Lazy fixture seeding respects the active overlay and never mutates fixture objects.
  // A live overlay switch preserves each fake user's edits; a fresh run clears them.
  const userSettings = () => {
    const user = extras.seedUser(core.fixture("GET", "/me"));
    const key = `${state.org}:${user.id}`;
    if (state.userSettings[key]) return state.userSettings[key];
    const pats = structuredClone(core.fixture("GET", "/user/pats") || []);
    const prompts = structuredClone(core.fixture("GET", "/input_prompt") || []);
    return (state.userSettings[key] = {
      preferences: {}, personalization: {},
      nextMemoryId: (user.personalization?.memories || []).reduce((max, m) => Math.max(max, m.id || 0), 0) + 1,
      pats, nextPatId: pats.reduce((max, pat) => Math.max(max, pat.id), 0) + 1,
      connectors: structuredClone(core.fixture("GET", "/federated/oauth-status") || []),
      grants: structuredClone(core.fixture("GET", "/oauth-provider/grants") || []),
      prompts, nextPromptId: prompts.reduce((max, prompt) => Math.max(max, prompt.id), 0) + 1,
    });
  };
  // Extras decorates the fixture first; #31 writes and explicit Craft edits win.
  // The public /me applies fake Auth last, after pins and Groups permissions.
  const currentUser = (value) => {
    if (value?.__status === 401) return value;
    const user = extras.seedUser(value), settings = userSettings();
    const craftUser = Object.hasOwn(state.adminCraftEnabled, user.email) ? adminUsers.getUser(user.email) : null;
    return { ...user, ...(craftUser ? { craft_enabled: craftUser.craft_enabled } : {}),
      preferences: { ...user.preferences, ...settings.preferences },
      personalization: { ...user.personalization, ...settings.personalization } };
  };
  const personalConnector = (id) => userSettings().connectors.find((c) => c.federated_connector_id === Number(id));
  const fixtureSessions = () => sharing.seedSessions(core.fixture("GET", "/chat/get-user-chat-sessions")?.sessions || []);
  // The sidebar list: live chats of the current org first, then fixture history, with in-run renames/deletes applied.
  const sidebarSessions = (fixtureList = fixtureSessions()) => {
    // Sharing histories must be listed before detail materialization; explicit empty-sidebar fixtures stay empty.
    const hist = state.deletedAll[state.org] ? [] : fixtureList.length ? sharing.seedSessions(fixtureList) : fixtureList;
    const live = Object.values(state.chatSessions).filter((s) => s.org === state.org && !s.fromFixture &&
      !hist.some((h) => h.id === s.id)).reverse().map((s) => ({
      id: s.id, name: s.description, persona_id: s.persona_id, time_created: s.created, time_updated: s.updated || s.created,
      shared_status: "private", current_alternate_model: s.model ?? null, current_temperature_override: s.temperature ?? null, current_reasoning_effort_override: null,
      folder_id: null, project_id: s.project_id ?? null,
    }));

    return sharing.decorateSessions([...live, ...hist.map((s) => ({ ...s, time_updated: chatSession(s.id)?.updated || s.time_updated,
      current_alternate_model: chatSession(s.id)?.model ?? s.current_alternate_model ?? null }))]
      .filter((s) => !chatEdit(s.id).deleted)
      .map((s) => projects.decorateChatSession({ ...s, ...(chatEdit(s.id).name ? { name: chatEdit(s.id).name } : {}),
        ...(chatEdit(s.id).shared_status ? { shared_status: chatEdit(s.id).shared_status } : {}),
        ...("project_id" in chatEdit(s.id) ? { project_id: chatEdit(s.id).project_id } : {}) })));
  };
  // Open a Recents (fixture) chat: fixtures/<layer>/history/<session id>.yaml lists its turns
  // ({message, script?: inline chat script}); without a file the session name is replayed as the one question.
  const materialize = (id) => {
    if (chatEdit(id).deleted || state.deletedAll[state.org]) return null;
    const meta = sharing.seedSessions(fixtureSessions()).find((s) => s.id === id);
    if (!meta) return null;
    const file = core.layerDirs("history").map((d) => path.join(d, `${id}.yaml`)).find((f) => fs.existsSync(f));
    const sharingTurns = file ? undefined : sharing.seedTurns(id);
    const turns = file ? core.parseYaml(file).turns || [] : sharingTurns ?? [{ message: meta.name }];
    const sess = { id, persona_id: meta.persona_id ?? 0, nodes: [], description: meta.name, created: meta.time_created, org: state.org,
      model: meta.current_alternate_model ?? null, project_id: projects.projectIdForSession(id, meta.project_id),
      owner_name: sharing.seedOwner(id), fromFixture: fixtureSessions().some((s) => s.id === id) };
    let parent = null;
    for (const t of turns) {
      const user = { id: state.nextMsgId++, type: "user", parent, message: t.message, time: meta.time_created,
        files: userFiles.attachMessage(id, t.files || []) };
      const history = historyTo(sess, parent);
      const llm = answerModel(modelOverride(sess.model), sess.persona_id);
      let script = t.script ? withContext(t.script, history, llm.model_version)
        : pickScript(core.layerDirs("chat"), t.message, core.parseYaml, history, llm.model_version);
      // Only explicit Sharing seed answers keep their inventory; existing file histories retain Main's selection.
      if (!sharingTurns || !t.script) script = userFiles.scriptForFiles(user.files) || script;
      const agent = { id: state.nextMsgId++, type: "assistant", parent: user.id, script,
        llm, time: meta.time_created };
      sess.nodes.push(user, agent);
      parent = agent.id;
    }
    return (state.chatSessions[chatKey(id)] = sess);
  };
  const newId = () => `00000000-0000-4000-8000-${String(state.nextSessionN++).padStart(12, "0")}`;
  const nowIso = () => new Date(core.demoNow()).toISOString();
  // A cited document by id, from any chat script or history turn of the active layers (first hit wins).
  const findDoc = (id) => {
    const extensionDoc = browserExtension.findDocument(id);
    if (extensionDoc) return extensionDoc;
    const searchDoc = userSearch.findDocument(id);
    if (searchDoc) return searchDoc;
    const scripts = [];
    for (const d of core.layerDirs("chat")) for (const f of fs.readdirSync(d).sort()) if (/\.ya?ml$/.test(f)) scripts.push(core.parseYaml(path.join(d, f)));
    for (const d of core.layerDirs("history")) for (const f of fs.readdirSync(d)) if (/\.ya?ml$/.test(f)) scripts.push(...(core.parseYaml(path.join(d, f)).turns || []).map((t) => t.script || {}));
    for (const s of scripts) {
      for (const response of [s, ...Object.values(s.model_variants || {})]) {
        const doc = (response?.documents || []).find((x) => x.id === id);
        if (doc) return doc;
      }
    }
    return null;
  };
  // Document text: fixtures/<layer>/sources/<id>.md (file ids may also be the part after "__", as the preview modal sends)
  const docBody = (...ids) => {
    const extensionBody = browserExtension.documentBody(...ids);
    if (extensionBody !== null) return extensionBody;
    const searchBody = userSearch.documentBody(...ids);
    if (searchBody !== null) return searchBody;
    for (const d of core.layerDirs("sources")) for (const id of ids) {
      if (!/^[\w.-]+$/.test(id) || id.includes("..")) continue; // ids are fixture file names, never paths
      const f = path.join(d, `${id}.md`);
      if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
    }
    return null;
  };
  const nodeOf = (sess, id) => sess.nodes.find((n) => n.id === id);
  // earlier turns on the branch ending at node id, oldest first
  const historyTo = (sess, id) => {
    const out = [];
    for (let n = nodeOf(sess, id); n; n = nodeOf(sess, n.parent)) {
      if (n.type === "assistant") out.unshift({ message: nodeOf(sess, n.parent)?.message, script: n.script });
    }
    return out;
  };
  // Selected links live on the same saved nodes, including the first-user/root branch.
  // Fixture history has real message IDs only after the existing loader materializes it.
  const markMessageLatest = (id) => {
    for (const sess of Object.values(state.chatSessions)) {
      if (sess.org !== state.org || chatEdit(sess.id).deleted) continue;
      const selected = nodeOf(sess, id);
      if (!selected) continue;
      for (let child = selected; child;) {
        const parent = child.parent != null ? nodeOf(sess, child.parent) : null;
        if (parent) parent.latestChildId = child.id;
        else sess.latestRootId = child.id;
        child = parent;
      }
      return true;
    }
    return false;
  };
  // All callbacks are lazy; construction does not materialize chats or seed context.
  const browserExtension = createBrowserExtensionHandlers(core, { markMessageLatest });
  const readSession = (id) => chatEdit(id).deleted ? null : chatSession(id) || materialize(id);
  const sharing = createSharingFeedbackHandlers(core, {
    readSession,
    listSessions: () => Object.values(state.chatSessions)
      .filter((sess) => sess.org === state.org && !chatEdit(sess.id).deleted),
  });
  // Extras' dynamic reads bypass fixture transforms: compose only the real
  // overlapping notification readers, retaining both modules' owned state.
  const adminBannerDismiss = adminPages.routes.find((route) => route.path === "/notifications/65065/dismiss");
  const extrasRoutes = extras.routes.map((route) => {
    if (route.method === "GET" && (route.path === "/notifications" || route.path === "/notifications/summary")) {
      const project = adminPages.transform[`GET ${route.path}`];
      return { ...route, handle: (ctx) => route.handle({ ...ctx,
        send: (status, value, headers) => ctx.send(status, project(value, ctx), headers),
      }) };
    }
    if (route.method === "POST" && route.path === "/notifications/dismiss-all") {
      return { ...route, async handle(ctx) {
        // One response for the native bulk action; each existing owner dismisses its rows.
        let response;
        await adminBannerDismiss.handle({ ...ctx, send: (...value) => { response = value; } });
        if (response[0] !== 200) return ctx.send(...response);
        return route.handle(ctx);
      } };
    }
    return route;
  });

  const handlers = {
    // a live overlay switch (keep: true) keeps chats; each chat stays with the org/persona overlay it was created under
    reset(body) {
      state.org = (body.overlays || []).join(",");
      if (body.resetChats !== false) reset();
      if (!body.keep) resetAgents();
      if (!body.keep) state.userSettings = {};
      mcp.reset(body);
      documentSetForms.reset(body);

      extras.reset(body);
      saveControls.reset(body);
      userFiles.reset(body);
      projects.reset(body);
      adminGroups.reset(body);
      adminUsers.reset(body);
      authAnonymous.reset(body);
      userConditional.reset(body);
      browserExtension.reset(body);
      adminPages.reset(body);
      craft.reset(body);
      sharing.reset(body);
    },

    routes: [
      ...authAnonymous.routes,
      ...userConditional.routes,
      // The exact Admin banner dismiss must precede Extras' generic notification :id.
      adminBannerDismiss,
      ...extrasRoutes,
      ...adminPages.routes.filter((route) => route !== adminBannerDismiss),
      ...craft.routes,
      ...userFiles.routes,
      ...projects.routes,
      ...sharing.routes,
      { method: "GET", path: "/persona", handle(ctx) {
        const ids = new URL(ctx.req.url, "http://mockshop").searchParams.getAll("persona_ids").map(Number);
        ctx.send(200, agentCatalog().filter((a) => !ids.length || ids.includes(a.id)));
      } },
      { method: "GET", path: "/persona/:id", handle(ctx) {
        if (!/^\d+$/.test(ctx.params.id)) return false; // /labels remains a fixture route
        const persona = fullAgent(Number(ctx.params.id));
        if (!persona || !agentAccess(persona).view)
          return ctx.send(404, { detail: `Agent with ID ${ctx.params.id} does not exist` });
        ctx.send(200, agentSnapshot(persona));
      } },
      { method: "POST", path: "/persona", handle: (ctx) => saveAgent(ctx) },
      { method: "PATCH", path: "/persona/:id", handle: (ctx) => saveAgent(ctx, Number(ctx.params.id)) },
      { method: "GET", path: "/admin/persona", handle(ctx) {
        ctx.send(200, agentCatalog({ full: true }));
      } },
      { method: "GET", path: "/admin/agents", handle(ctx) {
        const items = agentCatalog({ full: true })
          .filter((a) => ctx.query.include_default !== "false" || !a.builtin_persona);
        const page = Math.max(0, Number(ctx.query.page_num) || 0);
        const size = Math.max(1, Number(ctx.query.page_size) || items.length || 1);
        ctx.send(200, { items: items.slice(page * size, (page + 1) * size), total_items: items.length });
      } },
      { method: "PATCH", path: "/admin/persona/:id/featured", handle: (ctx) => curateAgent(ctx, "is_featured") },
      { method: "PATCH", path: "/admin/persona/:id/listed", handle: (ctx) => curateAgent(ctx, "is_listed") },
      { method: "PATCH", path: "/admin/agents/display-priorities", async handle(ctx) {
        if (!agentAdmin()) return ctx.send(403, { detail: "Not enough permissions" });
        const { display_priority_map: priorities } = await ctx.body();
        if (!priorities || typeof priorities !== "object" || Array.isArray(priorities))
          return ctx.send(422, { detail: "display_priority_map must be an object" });
        const changes = Object.entries(priorities);
        for (const [id, priority] of changes) {
          if (!/^\d+$/.test(id) || !fullAgent(Number(id)))
            return ctx.send(404, { detail: `Agent with ID ${id} does not exist` });
          if (!Number.isInteger(priority))
            return ctx.send(422, { detail: "Display priorities must be integers" });
        }
        for (const [id, display_priority] of changes)
          agentOrg().personas[id] = { ...fullAgent(Number(id)), display_priority };
        ctx.send(200, null);
      } },
      { method: "GET", path: "/user/pinned-assistants", handle(ctx) { ctx.send(200, pinnedAgents()); } },
      { method: "PATCH", path: "/user/pinned-assistants", async handle(ctx) {
        const body = await ctx.body();
        if (!("ordered_assistant_ids" in body))
          return ctx.send(422, { detail: [{ type: "missing", loc: ["body", "ordered_assistant_ids"], msg: "Field required", input: body }] });
        if (!Array.isArray(body.ordered_assistant_ids))
          return ctx.send(422, { detail: [{ type: "list_type", loc: ["body", "ordered_assistant_ids"], msg: "Input should be a valid list", input: body.ordered_assistant_ids }] });
        // Upstream collapses duplicate pins and drops inaccessible/nonexistent ids and Assistant (id 0).
        agentOrg().pins[agentUser()?.id] = [...new Set(body.ordered_assistant_ids)]
          .filter((id) => id !== 0 && fullAgent(id) && agentAccess(fullAgent(id)).view);
        ctx.send(200, null);
      } },
      ...mcp.routes,
      ...documentSetForms.routes,
      ...saveControlRoutes,
      ...adminGroups.routes,
      ...adminUsers.routes,
      ...userSearch.routes,
      ...browserExtension.routes,
      ...PREFERENCE_ROUTES.map(([path, field, query]) => ({ method: "PATCH", path, async handle(ctx) {
        const value = query ? ctx.query[field] === "true" : (await ctx.body())[field];
        userSettings().preferences[field] = value;
        if (field === "language") {
          state.locale = value;
          return ctx.send(200, null, { "set-cookie": `NEXT_LOCALE=${value}; Path=/; SameSite=Lax; HttpOnly` });
        }
        ctx.send(200, null);
      } })),
      { method: "PATCH", path: "/voice/settings", async handle(ctx) {
        const body = await ctx.body();
        for (const field of ["auto_send", "auto_playback", "playback_speed"]) {
          if (field in body) userSettings().preferences[`voice_${field}`] = body[field];
        }
        ctx.send(200, null);
      } },
      { method: "PATCH", path: "/user/personalization", async handle(ctx) {
        const body = await ctx.body(), settings = userSettings();
        for (const field of ["name", "role", "use_memories", "enable_memory_tool", "user_preferences"]) {
          if (body[field] != null) settings.personalization[field] = body[field];
        }
        if (body.memories != null) settings.personalization.memories = body.memories.map((memory) => ({
          id: memory.id == null ? settings.nextMemoryId++ : memory.id, content: memory.content,
        }));
        ctx.send(200, null);
      } },
      { method: "GET", path: "/user/pats", handle(ctx) { ctx.send(200, userSettings().pats); } },
      { method: "POST", path: "/user/pats", async handle(ctx) {
        const body = await ctx.body(), settings = userSettings(), id = settings.nextPatId++;
        // Deliberately nonfunctional, deterministic demo text. No credential or auth state is created.
        const token = `mockshop-not-a-real-token-${String(id).padStart(4, "0")}`;
        const expires = body.expiration_days == null ? null : new Date(core.demoNow() + body.expiration_days * 864e5);
        // Match the native expiration note (SettingsPage:349–357), including UTC end-of-day.
        expires?.setUTCHours(23, 59, 59, 999);
        const pat = { id, name: body.name, token_display: `mockshop…${String(id).padStart(4, "0")}`,
          created_at: nowIso(), expires_at: expires?.toISOString() ?? null,
          last_used_at: null, scopes: body.scopes ?? null };
        settings.pats.push(pat);
        ctx.send(200, { ...pat, token });
      } },
      { method: "DELETE", path: "/user/pats/:id", handle(ctx) {
        const settings = userSettings();
        settings.pats = settings.pats.filter((pat) => pat.id !== Number(ctx.params.id));
        ctx.send(200, null);
      } },
      // Existing SettingsPage's source-gated Connected apps section; fake grants only, no OAuth flow.
      { method: "GET", path: "/oauth-provider/grants", handle(ctx) { ctx.send(200, userSettings().grants); } },
      { method: "DELETE", path: "/oauth-provider/grants/:id", handle(ctx) {
        const settings = userSettings();
        settings.grants = settings.grants.filter((grant) => grant.id !== decodeURIComponent(ctx.params.id));
        ctx.send(200, null);
      } },
      { method: "GET", path: "/federated/oauth-status", handle(ctx) { ctx.send(200, userSettings().connectors); } },
      { method: "DELETE", path: "/federated/:id/oauth", handle(ctx) {
        const connector = personalConnector(ctx.params.id);
        if (!connector) return ctx.send(404, { detail: "Personal connector not found" });
        connector.has_oauth_token = false;
        connector.oauth_token_expires_at = null;
        ctx.send(200, null);
      } },
      // Next Link prefetches authorize_url: GET must never reconnect a fake account.
      // This local-only landing page explicitly submits a simulation, without OAuth or credentials.
      { method: "GET", path: "/mockshop/personal-connectors/:id/connect", handle(ctx) {
        const connector = personalConnector(ctx.params.id);
        if (!connector) return ctx.send(404, { detail: "Personal connector not found" });
        ctx.send(200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mockshop Gmail simulation</title>
          <main style="font:16px/1.6 system-ui;max-width:640px;margin:48px auto">
            <h1>Fake Gmail connection</h1><p>This is a local Mockshop simulation. No OAuth, credentials, permissions or live account changes.</p>
            <form method="post" action="/api/mockshop/personal-connectors/${connector.federated_connector_id}/connect">
              <button type="submit">Connect fake Gmail account</button>
            </form>
          </main></html>`, { "content-type": "text/html; charset=utf-8" });
      } },
      { method: "POST", path: "/mockshop/personal-connectors/:id/connect", handle(ctx) {
        const connector = personalConnector(ctx.params.id);
        if (!connector) return ctx.send(404, { detail: "Personal connector not found" });
        connector.has_oauth_token = true;
        ctx.send(303, "", { location: "/app/settings/connectors" });
      } },
      { method: "GET", path: "/input_prompt", handle(ctx) { ctx.send(200, userSettings().prompts); } },
      { method: "POST", path: "/input_prompt", async handle(ctx) {
        const body = await ctx.body(), settings = userSettings();
        const prompt = { ...body, id: settings.nextPromptId++, user_id: core.fixture("GET", "/me").id };
        settings.prompts.push(prompt);
        ctx.send(200, prompt);
      } },
      { method: "PATCH", path: "/input_prompt/:id", async handle(ctx) {
        const prompt = userSettings().prompts.find((p) => p.id === Number(ctx.params.id));
        if (!prompt) return ctx.send(404, { detail: "Prompt shortcut not found" });
        Object.assign(prompt, await ctx.body());
        ctx.send(200, prompt);
      } },
      { method: "DELETE", path: "/input_prompt/:id", handle(ctx) {
        const settings = userSettings();
        settings.prompts = settings.prompts.filter((p) => p.id !== Number(ctx.params.id));
        ctx.send(200, null);
      } },
      { method: "GET", path: "/user/usage", handle(ctx) {
        const usage = core.fixture("GET", "/user/usage");
        const rows = usage.per_day_by_model.filter((row) =>
          (!ctx.query.start || row.day >= ctx.query.start) && (!ctx.query.end || row.day <= ctx.query.end));
        const chosen = userSettings().preferences.default_model ?? core.fixture("GET", "/me").preferences.default_model;
        const model = chosen?.split("__")[2];
        ctx.send(200, { ...usage, per_day_by_model: rows,
          window_cost_cents: rows.reduce((sum, row) => sum + row.cost_cents, 0),
          selected_model_price: usage.available_model_prices.find((price) => price.model === model) ?? usage.selected_model_price });
      } },
      // Streamed answer in Onyx's NDJSON packet format (see chat.mjs).
      // parent_message_id = an assistant node (normal follow-up or edit of a later message), null (first message or
      // edit of the first message) or a user node (regenerate: reuse that user message, add a sibling answer).
      { method: "POST", path: "/chat/send-chat-message", async handle(ctx) {
        const body = await ctx.body();
        const sendError = browserExtension.takeSendError(body);
        if (sendError) {
          await core.streamNdjson(ctx.res, [{ delay: 0, packet: sendError }]);
          return;
        }
        const info = body.chat_session_info;
        const sid = body.chat_session_id || newId();
        let sess = chatSession(sid) || materialize(sid);
        if (!sess && body.chat_session_id) return ctx.send(404, { detail: "Chat session not found" });
        if (!sess) {
          sess = state.chatSessions[chatKey(sid)] = {
            id: sid, persona_id: info?.persona_id ?? 0, nodes: [], description: info?.description || null,
            project_id: info?.project_id ?? null, model: defaultChatModel(), created: nowIso(), org: state.org,
          };
          projects.onSessionCreated(sid, info?.project_id);
        }
        const parent = body.parent_message_id != null ? nodeOf(sess, body.parent_message_id) : null;
        const regenerate = parent?.type === "user";
        const userNode = regenerate ? parent : { id: state.nextMsgId++, type: "user", parent: parent?.id ?? null,
          message: body.message, time: nowIso(), files: userFiles.attachMessage(sid, body.file_descriptors || []) };
        if (!regenerate) sess.nodes.push(userNode);
        const history = historyTo(sess, userNode.parent);
        const llm = answerModel(body.llm_override || modelOverride(sess.model), sess.persona_id);
        let script = pickScript(core.layerDirs("chat"), userNode.message || "", core.parseYaml, history, llm.model_version);
        script = userSearch.selectChatScript(script, { ...body, message: userNode.message });
        script = browserExtension.selectChatScript(script, { ...body, message: userNode.message });

        if (regenerate) {
          const k = sess.nodes.filter((n) => n.parent === userNode.id).length; // answers already there
          const alt = script.regenerate?.length ? script.regenerate[(k - 1) % script.regenerate.length] : null;
          if (alt) script = { ...script, answer: alt };
        }
        // Select normal model/context/regeneration first, then ground only the saved known file descriptors.
        script = userFiles.scriptForFiles(userNode.files) || script;
        if (!sess.description) sess.description = script.title || userNode.message?.slice(0, 60);
        const agent = { id: state.nextMsgId++, type: "assistant", parent: userNode.id, script,
          llm, time: nowIso() };
        sess.nodes.push(agent);
        markMessageLatest(agent.id);
        sess.updated = nowIso();
        let sofar = "", stopped = false;
        sess.stop = false;
        const ids = { user: userNode.id, agent: agent.id };
        const stream = buildChatStream(script, ids, {
          sessionId: sid, isNew: !body.chat_session_id, llm: agent.llm, onText: (t) => { sofar = t; },
          stopped: () => (stopped = sess.stop || ctx.res.destroyed),
        });
        // Native regeneration starts with empty composer files; its user_files consumer restores the saved node.
        function* streamWithFiles() {
          for (const event of stream) {
            if (event.packet.user_message_id && userNode.files?.length) event.packet.user_files = userNode.files;
            yield event;
          }
        }
        await core.streamNdjson(ctx.res, streamWithFiles());
        if (stopped) agent.partial = sofar; // stopped by the user: replayed as a cancelled, partial answer
      } },
      { method: "POST", path: "/chat/stop-chat-session/:id", handle(ctx) {
        const sess = chatSession(ctx.params.id);
        if (sess) sess.stop = true;
        ctx.send(200, {});
      } },
      { method: "POST", path: "/chat/create-chat-session", async handle(ctx) {
        const body = await ctx.body();
        const sid = newId();
        state.chatSessions[chatKey(sid)] = { id: sid, persona_id: body.persona_id ?? 0, nodes: [],
          description: body.description || null, project_id: body.project_id ?? null,
          model: defaultChatModel(), created: nowIso(), org: state.org };
        projects.onSessionCreated(sid, body.project_id);
        ctx.send(200, { chat_session_id: sid });
      } },
      { method: "PUT", path: "/chat/update-chat-session-model", async handle(ctx) {
        const body = await ctx.body();
        const sess = chatSession(body.chat_session_id) || materialize(body.chat_session_id);
        if (!sess || chatEdit(body.chat_session_id).deleted) return ctx.send(404, { detail: "Chat session not found" });
        sess.model = body.new_alternate_model;
        ctx.send(200, null);
      } },
      { method: "PUT", path: "/chat/update-chat-session-temperature", async handle(ctx) {
        const body = await ctx.body();
        const sess = chatSession(body.chat_session_id) || materialize(body.chat_session_id);
        if (!sess || chatEdit(body.chat_session_id).deleted) return ctx.send(404, { detail: "Chat session not found" });
        sess.temperature = body.temperature_override ?? null;
        ctx.send(200, null);
      } },
      // Onyx auto-names new chats via PUT rename with name=null; answer with the script title.
      { method: "ANY", path: "/chat/rename-chat-session", async handle(ctx) {
        const body = await ctx.body();
        const sess = chatSession(body.chat_session_id);
        if (sess && body.name) sess.description = body.name;
        if (body.name) edit(body.chat_session_id).name = body.name;
        ctx.send(200, { new_name: body.name || sess?.description || "New Chat" });
      } },
      { method: "DELETE", path: "/chat/delete-chat-session/:id", handle(ctx) {
        edit(ctx.params.id).deleted = true;
        delete state.chatSessions[chatKey(ctx.params.id)];
        ctx.send(200, {});
      } },
      { method: "DELETE", path: "/chat/delete-all-chat-sessions", handle(ctx) {
        for (const s of Object.values(state.chatSessions)) if (s.org === state.org) delete state.chatSessions[chatKey(s.id)];
        state.deletedAll[state.org] = true;
        ctx.send(200, {});
      } },
      // Search Chats modal: substring match on names (and message text of opened/live chats), grouped like the backend.
      { method: "GET", path: "/chat/search", handle(ctx) {
        const q = (ctx.query.query || "").toLowerCase();
        const hits = sidebarSessions().filter((s) => !q || (s.name || "").toLowerCase().includes(q) ||
          (chatSession(s.id)?.nodes || []).some((n) => (n.message || "").toLowerCase().includes(q)));
        const now = core.demoNow();
        const group = (s) => { const d = (now - Date.parse(s.time_updated || s.time_created)) / 864e5; return d < 1 ? "Today" : d < 7 ? "Previous 7 Days" : d < 30 ? "Previous 30 Days" : "Older"; };
        const groups = [];
        for (const s of hits) { const t = group(s); (groups.find((g) => g.title === t) || groups[groups.push({ title: t, chats: [] }) - 1]).chats.push(s); }
        ctx.send(200, { groups, has_more: false, next_page: null });
      } },
      // Local viewer for a cited source (chat.mjs points every non-file citation link here, opened in a new tab
      // through Onyx's /api proxy): the fixture's title, source, owners, blurb and sources/<id>.md as plain HTML.
      { method: "GET", path: "/mockshop/source/:id", handle(ctx) {
        const id = decodeURIComponent(ctx.params.id);
        const doc = findDoc(id);
        if (!doc) return ctx.send(404, sourcePage({ title: "Document not found", blurb: `No fixture document with id ${id}.` }), HTML);
        ctx.send(200, sourcePage(doc, docBody(id)), HTML);
      } },
      // Onyx's preview modal for file sources (document_id "FILE__<name>" -> GET /chat/file/<name>).
      { method: "GET", path: "/chat/file/:id", handle(ctx) {
        const id = decodeURIComponent(ctx.params.id);
        const body = docBody(id, `FILE__${id}`);
        if (body == null) return false;
        const doc = findDoc(`FILE__${id}`) || findDoc(id);
        const name = (doc?.title || `${id}.md`).replace(/"/g, "");
        ctx.send(200, body, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `inline; filename="${name}"` });
      } },
      // Only sessions belonging to the active org can be replayed.
      { method: "GET", path: "/chat/get-chat-session/:id", handle(ctx) {
        const sess = readSession(ctx.params.id);
        if (!sess || (String(ctx.query.is_shared).toLowerCase() === "true" && !sharing.canReadShared(sess.id)))
          return ctx.send(404, { detail: "Chat session not found" });
        ctx.send(200, sharing.decorateDetail(projects.decorateChatSession({ ...sessionFromNodes(sess),
          description: chatEdit(sess.id).name || sess.description,
          shared_status: chatEdit(sess.id).shared_status || "private" })));
      } },
    ],

    transform: {
      // Seed before sequential module readers apply saved Admin overrides.
      "GET /settings": (value) => authAnonymous.transform["GET /settings"](extras.seedSettings(value)),
      "GET /me": (val) => {
        if (val?.__status === 401) return val;
        const settings = userSettings(), user = currentUser(val);
        const decorated = adminGroups.transform["GET /me"]({ ...user,
          preferences: { ...user.preferences, pinned_assistants: pinnedAgents() } });
        return decorated?.__status === 401 ? decorated : authAnonymous.currentUser(decorated, settings.personalization);
      },
      // live sessions created during this run go first in the sidebar; in-run renames/deletes apply to history too
      "GET /chat/get-user-chat-sessions": (val) => ({ ...val, sessions: sidebarSessions(val.sessions || []).filter((s) => s.project_id == null) }),
      // emulate the backend's server-side filters so search / source paging look real
      "POST /manage/admin/connector/indexing-status": async (val, ctx) => {
        if (!Array.isArray(val)) return val;
        const body = await ctx.body();
        const q = (body.name_filter || "").toLowerCase();
        return val
          .filter((g) => !body.source || g.source === body.source)
          .map((g) => ({ ...g, indexing_statuses: g.indexing_statuses.filter((s) => !q || s.name.toLowerCase().includes(q)) }))
          .filter((g) => g.indexing_statuses.length);
      },
    },
  };
  // Seed Extras before saved owners; Groups is composed once above, Pages saves win, Craft reconciles last.
  for (const module of [mcp, documentSetForms, extras, saveControls, userFiles, adminUsers, adminGroups, adminPages, craft]) {
    for (const [key, transform] of Object.entries(module.transform)) {
      // Root already composes Auth-last/current user/preferences/Craft/pins/Groups once.
      if (key === "GET /me") continue;
      const previous = handlers.transform[key];
      handlers.transform[key] = previous
        ? async (value, ctx) => {
          const result = await previous(value, ctx);
          return result?.__status === 401 ? result : transform(result, ctx);
        }
        : transform;
    }
  }
  return handlers;
}
