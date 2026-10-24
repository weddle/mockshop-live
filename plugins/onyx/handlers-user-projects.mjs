// Project metadata and associations only. Chat replay remains in handlers.mjs; files in handlers-user-files.mjs.
export default function createUserProjectHandlers(core, { getFile, listChatSessions, listAgents } = {}) {
  let data;
  const reset = (body = {}) => { if (!body.keep) data = undefined; };
  const records = () => {
    if (data) return data;
    const seeds = structuredClone(core.fixture("GET", "/user/projects") || []);
    data = { projects: new Map(), memberships: new Map(), files: new Map(), nextId: 1 };
    for (const seed of seeds) {
      const { chat_session_ids = [], file_ids = [], chat_sessions = [], ...project } = seed;
      data.projects.set(project.id, project);
      data.files.set(project.id, new Set(file_ids));
      for (const id of [...chat_session_ids, ...chat_sessions.map((chat) => chat.id)]) data.memberships.set(id, project.id);
      data.nextId = Math.max(data.nextId, project.id + 1);
    }
    return data;
  };
  const sessions = () => listChatSessions?.() || core.fixture("GET", "/chat/get-user-chat-sessions")?.sessions || [];
  const projectIdForSession = (id, original = null) => {
    const current = records();
    const projectId = current.memberships.has(id) ? current.memberships.get(id) : original;
    return current.projects.has(projectId) ? projectId : null;
  };
  const decorateChatSession = (session) => ({ ...session, project_id: projectIdForSession(session.id ?? session.chat_session_id, session.project_id) });
  const filesForProject = (id) => [...(records().files.get(Number(id)) || [])]
    .map((fileId) => getFile?.(fileId)).filter(Boolean).map((file) => ({ ...file, project_id: Number(id) }));
  const projectFilesForSession = (id) => {
    const session = sessions().find((chat) => chat.id === id);
    return filesForProject(projectIdForSession(id, session?.project_id));
  };
  const snapshot = (project) => ({ ...project,
    chat_sessions: sessions().filter((chat) => projectIdForSession(chat.id, chat.project_id) === project.id).map(decorateChatSession),
  });
  const associateFiles = (projectId, fileIds) => {
    const id = Number(projectId), current = records();
    if (!current.projects.has(id) || fileIds.some((fileId) => !getFile?.(fileId))) return false;
    const links = current.files.get(id);
    for (const fileId of fileIds) links.add(fileId);
    return true;
  };
  const projectNamesForFile = (fileId) => [...records().projects.values()]
    .filter((project) => records().files.get(project.id)?.has(fileId)).map((project) => project.name);
  const removeFile = (fileId) => { for (const links of records().files.values()) links.delete(fileId); };
  // Called after the existing engine has created a session; does not allocate a second chat.
  const onSessionCreated = (id, projectId) => {
    records().memberships.set(id, records().projects.has(Number(projectId)) ? Number(projectId) : null);
  };
  const lookup = (ctx) => {
    const project = records().projects.get(Number(ctx.params.id));
    if (!project) ctx.send(404, { detail: "Project not found" });
    return project;
  };
  return {
    associateFiles, projectNamesForFile, projectFilesForSession, projectIdForSession,
    decorateChatSession, onSessionCreated, removeFile,
    routes: [
      { method: "GET", path: "/user/projects", handle(ctx) {
        ctx.send(200, [...records().projects.values()].map(snapshot));
      } },
      { method: "POST", path: "/user/projects/create", handle(ctx) {
        const name = String(ctx.query.name || "").trim();
        if (!name) return ctx.send(400, { detail: "Project name is required" });
        const current = records(), id = current.nextId++;
        const project = { id, name, description: null, created_at: new Date(core.demoNow()).toISOString(),
          user_id: core.fixture("GET", "/me").id, instructions: null };
        current.projects.set(id, project);
        current.files.set(id, new Set());
        ctx.send(200, snapshot(project));
      } },
      { method: "POST", path: "/user/projects/remove_chat_session", async handle(ctx) {
        const { chat_session_id: id } = await ctx.body();
        if (!sessions().some((chat) => chat.id === id)) return ctx.send(404, { detail: "Chat session not found" });
        records().memberships.set(id, null);
        ctx.send(200, {});
      } },
      { method: "GET", path: "/user/projects/files/:id", handle(ctx) {
        if (lookup(ctx)) ctx.send(200, filesForProject(ctx.params.id));
      } },
      { method: "GET", path: "/user/projects/:id/details", handle(ctx) {
        const project = lookup(ctx);
        if (!project) return;
        const featured = Object.fromEntries(listAgents().map((agent) => [agent.id, Boolean(agent.is_featured)]));
        ctx.send(200, { project: snapshot(project), files: filesForProject(project.id), persona_id_to_is_featured: featured });
      } },
      { method: "GET", path: "/user/projects/:id/instructions", handle(ctx) {
        const project = lookup(ctx);
        if (project) ctx.send(200, { instructions: project.instructions });
      } },
      { method: "POST", path: "/user/projects/:id/instructions", async handle(ctx) {
        const project = lookup(ctx);
        if (!project) return;
        const body = await ctx.body();
        if (typeof body.instructions !== "string") return ctx.send(400, { detail: "Instructions must be text" });
        project.instructions = body.instructions.trim() || null;
        ctx.send(200, { instructions: project.instructions });
      } },
      { method: "GET", path: "/user/projects/:id/token-count", handle(ctx) {
        // Native selected-project deletion clears details before its URL navigation completes.
        // This association aggregate remains defined as zero once the project's links are gone.
        ctx.send(200, { total_tokens: filesForProject(ctx.params.id).reduce((sum, file) => sum + (file.token_count || 0), 0) });
      } },
      { method: "POST", path: "/user/projects/:id/move_chat_session", async handle(ctx) {
        const project = lookup(ctx);
        if (!project) return;
        const { chat_session_id: id } = await ctx.body();
        if (!sessions().some((chat) => chat.id === id)) return ctx.send(404, { detail: "Chat session not found" });
        records().memberships.set(id, project.id);
        ctx.send(200, {});
      } },
      { method: "POST", path: "/user/projects/:id/files/:fileId", handle(ctx) {
        if (!lookup(ctx)) return;
        if (!associateFiles(ctx.params.id, [ctx.params.fileId])) return ctx.send(404, { detail: "File not found" });
        ctx.send(200, {});
      } },
      { method: "DELETE", path: "/user/projects/:id/files/:fileId", handle(ctx) {
        if (!lookup(ctx)) return;
        if (!records().files.get(Number(ctx.params.id)).delete(ctx.params.fileId)) return ctx.send(404, { detail: "Project file not found" });
        ctx.send(200, {});
      } },
      { method: "GET", path: "/user/projects/:id", handle(ctx) {
        const project = lookup(ctx);
        if (project) ctx.send(200, snapshot(project));
      } },
      { method: "PATCH", path: "/user/projects/:id", async handle(ctx) {
        const project = lookup(ctx);
        if (!project) return;
        const { name } = await ctx.body();
        if (typeof name !== "string" || !name.trim()) return ctx.send(400, { detail: "Project name is required" });
        project.name = name.trim();
        ctx.send(200, snapshot(project));
      } },
      { method: "DELETE", path: "/user/projects/:id", handle(ctx) {
        const project = lookup(ctx);
        if (!project) return;
        for (const chat of sessions()) if (projectIdForSession(chat.id, chat.project_id) === project.id) records().memberships.set(chat.id, null);
        records().projects.delete(project.id);
        records().files.delete(project.id);
        ctx.send(200, {});
      } },
    ],
    // Compose this after the existing fixture-backed sidebar transform.
    // Dynamic replay/search responses use decorateChatSession in the parent hooks.
    transform: {
      "GET /chat/get-user-chat-sessions": (value) => ({ ...value, sessions: (value.sessions || []).map(decorateChatSession) }),
    },
    reset({ keep } = {}) { if (!keep) reset(); },
  };
}
