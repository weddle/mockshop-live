// Source-shaped Craft DTOs and finite fictional turns, not a sandbox/job/provider engine.
import { Readable } from "node:stream";

export default function createUserCraft(core, companions = {}) {
  let data;
  const seed = () => core.fixture("GET", "/mockshop/user-craft");
  const now = () => new Date(core.demoNow()).toISOString();
  const copy = value => structuredClone(value);
  const state = () => data ||= { skills: copy(seed().skills), tasks: copy(seed().tasks),
    runs: copy(seed().runs), sessions: copy(seed().sessions), library: copy(seed().library),
    credentials: copy(seed().credentials), turns: {}, approvals: copy(seed().approvals), sequence: 0, views: {}, connections: {}, appAssociations: {} };
  // The admin-pages module owns these mutable rows. Never seed a competing app store.
  const apps = () => {
    if (!companions.apps) throw new Error("Craft requires the current admin-pages apps() callback");
    return companions.apps();
  };
  const mcpServers = () => {
    if (!companions.mcpServers) throw new Error("Craft requires the current MCP metadata callback");
    return companions.mcpServers();
  };
  const missing = ctx => ctx.send(404, { detail: "Fictional Craft record not found." });
  const invalid = (ctx, detail, error_code) => ctx.send(400, { detail, ...(error_code ? { error_code } : {}) });
  const send = (ctx, value, headers) => ctx.send(200, value, headers);
  const routes = [];
  const emptyViews = { "/skills": { builtins: [], customs: [] }, "/build/apps": [],
    "/build/scheduled-tasks": { items: [] }, "/build/scheduled-tasks/:id/runs": { items: [], next_cursor: null },
    "/build/user-library/tree": [], "/build/sessions/:id/files": { path: "", entries: [] },
    "/build/sessions/:id/artifacts": [], "/build/sessions/:id/webapp-info": { has_webapp: false, webapp_url: null, status: "none", ready: false },
    "/build/sessions/:id/artifacts/*": "", "/build/sessions": { sessions: [] },
    "/build/sessions/:id/pptx-preview/*": { slide_count: 0, slide_paths: [], cached: true },
    "/mcp/servers/craft": { mcp_servers: [] } };
  const actionErrors = new Set(["/build/apps/:id/credentials", "/build/apps/connect/:id/decision",
    "/skills/custom/:id", "/build/user-library/directories", "/build/user-library/upload", "/build/user-library/upload-zip"]);
  const route = (method, path, handle) => routes.push({ method, path, async handle(ctx) {
    if (method !== "GET" && actionErrors.has(path) && state().views[path]?.state === "error")
      return ctx.send(500, { detail: "Intentional fictional Craft action error; no state changed." });
    const view = method === "GET" ? state().views[path] : null;
    if (view?.delay_ms) await new Promise(resolve => setTimeout(resolve, view.delay_ms));
    if (view?.state === "error") return ctx.send(500, { detail: "Intentional fictional Craft read error." });
    if (view?.state === "empty" && path in emptyViews) return send(ctx, copy(emptyViews[path]));
    if (view?.state === "starting" && path === "/build/sessions/:id/webapp-info") return send(ctx, { ...seed().webapp_info, ready: false, status: "starting", sharing_scope: "private" });
    return handle(ctx);
  } });
  // Explicit proof staging only; does not mutate any other owner's state or product configuration.
  route("POST", "/mockshop/user-craft/stage", async ctx => {
    const body = await ctx.body();
    if (body.path === "/build/sessions/:id/send-message" && ["loaded", "error", "limited"].includes(body.state)) {
      state().views[body.path] = { state: body.state }; return send(ctx, { staged: body.path, state: body.state });
    }
    if (actionErrors.has(body.path) && ["loaded", "error"].includes(body.state)) {
      state().views[body.path] = { state: body.state }; return send(ctx, { staged: body.path, state: body.state });
    }
    if (!(body.path in emptyViews) || !["loaded", "empty", "error", "starting"].includes(body.state) ||
      (body.state === "starting" && body.path !== "/build/sessions/:id/webapp-info")) return invalid(ctx, "Choose a declared Craft read surface and state.");
    state().views[body.path] = { state: body.state, delay_ms: body.delay_ms || 0 }; send(ctx, { staged: body.path, state: body.state });
  });
  const find = (rows, id) => rows.find(row => String(row.id) === String(id));
  const nextId = kind => `craft-${kind}-${++state().sequence}`;
  const stale = () => { for (const session of state().sessions) session.skills_stale = true; };
  const user = () => { const me = core.fixture("GET", "/me"); return { id: me.id, email: me.email }; };
  const allSkills = () => [...state().skills.builtins, ...state().skills.customs];
  const appDependency = skill => {
    const app = apps().find(row => row.associated_skills.some(item => item.id === skill.id));
    return app ? { external_app_id: app.id, name: app.name, enabled: app.enabled,
      ready: app.enabled && (state().credentials[app.id]?.authenticated ??
        app.credential_placeholder_keys.every(key => !!app.organization_credentials[key])) } : null;
  };
  const skillView = skill => ({ ...skill, external_app: appDependency(skill),
    is_personal: !skill.public_permission && !skill.user_shares.length && !skill.group_shares.length });
  const listSkills = () => {
    reconcileApps(apps());
    return { builtins: state().skills.builtins.map(skillView), customs: state().skills.customs.map(skillView) };
  };
  const reconcileApps = rows => {
    const skills = allSkills();
    const currentIds = new Set(rows.map(row => String(row.id)));
    for (const [id, skillIds] of Object.entries(state().appAssociations)) if (!currentIds.has(id)) {
      for (const skillId of skillIds) { const skill = find(skills, skillId); if (skill) skill.enabled = false; }
      delete state().credentials[id]; delete state().appAssociations[id]; stale();
    }
    for (const row of rows) row.associated_skills = row.associated_skills.map(item => find(skills, item.id))
      .filter(Boolean).map(skill => ({ id: skill.id, name: skill.name, is_valid: skill.is_valid }));
    for (const row of rows) {
      row.credential_placeholder_keys = [...new Set(Object.values(row.auth_template)
        .flatMap(value => [...String(value).matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1])))].sort();
      state().appAssociations[row.id] = row.associated_skills.map(skill => skill.id);
    }
    return rows;
  };
  // #65 selects current skill summaries; this owner promotes the actual custom skill records.
  const afterAppWrite = (row, body) => {
    if (body.associated_skill_ids) {
      for (const id of body.associated_skill_ids) {
        const skill = find(state().skills.customs, id);
        if (skill) skill.public_permission ||= "VIEWER";
      }
    }
    reconcileApps(apps());
    stale();
    return row;
  };
  const multipart = async ctx => {
    const request = new Request("http://localhost/mockshop-craft-upload", { method: "POST",
      headers: { "content-type": ctx.req.headers["content-type"] || "" }, body: Readable.toWeb(ctx.req), duplex: "half" });
    return request.formData();
  };
  const bundle = file => {
    // Canned editable fictional bundle, never execute/read arbitrary uploaded scripts or archives.
    if (!file || typeof file === "string" || !file.size) return null;
    const result = copy(seed().upload_bundle);
    if (!/\.zip$|^skill\.md$/i.test(file.name)) result.files = [{ path: file.name, size: file.size }];
    return result;
  };
  const conflict = (name, except) => allSkills().some(skill => skill.id !== except && skill.name === name && skill.enabled);
  const newSkill = (fields, enabled = true) => ({ ...copy(seed().skill_defaults), ...fields,
    id: nextId("skill"), source: "custom", enabled, owner: user(), author_user_id: user().id,
    author_email: user().email, created_at: now(), updated_at: now(), files: fields.files || [] });
  route("GET", "/skills", ctx => send(ctx, listSkills()));
  route("GET", "/skills/:id/preview", ctx => {
    const skill = find(allSkills(), ctx.params.id); skill ? send(ctx, skillView(skill)) : missing(ctx);
  });
  route("GET", "/skills/custom/:id/edit", ctx => {
    const skill = find(state().skills.customs, ctx.params.id); skill ? send(ctx, skillView(skill)) : missing(ctx);
  });
  route("POST", "/skills/custom/bundle/inspect", async ctx => {
    const value = bundle((await multipart(ctx)).get("upload")); value ? send(ctx, value) : invalid(ctx, "Select a fictional nonempty skill bundle.");
  });
  route("POST", "/skills/custom/editor", async ctx => {
    const form = await multipart(ctx), name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim(), instructions_markdown = String(form.get("instructions_markdown") || "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !description || !instructions_markdown) return invalid(ctx, "Use a lowercase hyphenated name, description and instructions.");
    const appId = form.get("external_app_id"), app = appId == null ? null : find(apps(), appId);
    if (appId != null && !app) return missing(ctx);
    if (app?.associated_skills.some(skill => skill.name === name) || (form.get("auto_enable") !== "false" && conflict(name))) {
      return invalid(ctx, "Only one skill with this name may be enabled, or associated with this app.", "SKILL_NAME_CONFLICT");
    }
    const uploaded = bundle(form.get("upload"));
    const skill = newSkill({ name, description, instructions_markdown, files: uploaded?.files || [], public_permission: app ? "VIEWER" : null }, form.get("auto_enable") !== "false");
    state().skills.customs.push(skill);
    if (app) app.associated_skills.push({ id: skill.id, name, is_valid: true });
    stale(); send(ctx, skillView(skill));
  });
  route("PUT", "/skills/:id/enabled", async ctx => {
    const skill = find(allSkills(), ctx.params.id); if (!skill) return missing(ctx);
    const body = await ctx.body();
    if (body.enabled && conflict(skill.name, skill.id) && !body.replace_conflict) return invalid(ctx, "Another skill with this name is enabled.", "SKILL_NAME_CONFLICT");
    if (body.enabled && body.replace_conflict) for (const other of allSkills()) if (other.name === skill.name) other.enabled = false;
    skill.enabled = body.enabled; stale(); send(ctx, skillView(skill));
  });
  route("PATCH", "/skills/custom/:id", async ctx => {
    const skill = find(state().skills.customs, ctx.params.id); if (!skill) return missing(ctx);
    const body = await ctx.body();
    if (!body.description?.trim() || !body.instructions_markdown?.trim()) return invalid(ctx, "Description and instructions are required.");
    Object.assign(skill, { description: body.description.trim(), instructions_markdown: body.instructions_markdown.trim(), updated_at: now() });
    stale(); send(ctx, skillView(skill));
  });
  route("POST", "/skills/custom/:id/files", async ctx => {
    const skill = find(state().skills.customs, ctx.params.id); if (!skill) return missing(ctx);
    const file = (await multipart(ctx)).get("upload"), uploaded = bundle(file);
    if (!uploaded) return invalid(ctx, "Select a nonempty fictional supporting file.");
    if (/\.zip$|^skill\.md$/i.test(file.name)) {
      if (uploaded.name !== skill.name) return invalid(ctx, "Replacement bundle must use the same skill name.");
      Object.assign(skill, uploaded);
    } else skill.files = [...skill.files.filter(item => item.path !== file.name), ...uploaded.files];
    skill.updated_at = now(); stale(); send(ctx, skillView(skill));
  });
  route("DELETE", "/skills/custom/:id/files", ctx => {
    const skill = find(state().skills.customs, ctx.params.id); if (!skill) return missing(ctx);
    skill.files = skill.files.filter(file => file.path !== ctx.query.path); stale(); send(ctx, skillView(skill));
  });
  route("PATCH", "/skills/custom/:id/share", async ctx => {
    const skill = find(state().skills.customs, ctx.params.id); if (!skill) return missing(ctx);
    const body = await ctx.body(), users = companions.users?.() || core.fixture("GET", "/users") || [];
    const groups = companions.groups?.() || core.fixture("GET", "/manage/user-groups/minimal") || [];
    if (body.user_shares) skill.user_shares = body.user_shares.map(share => ({ user: find(users, share.user_id), permission: share.permission })).filter(share => share.user);
    if (body.group_shares) skill.group_shares = body.group_shares.map(share => ({ group_id: share.group_id,
      group_name: find(groups, share.group_id)?.name || `Group ${share.group_id}`, permission: share.permission }));
    if ("public_permission" in body) skill.public_permission = body.public_permission;
    stale(); send(ctx, skillView(skill));
  });
  route("POST", "/skills/custom/:id/transfer-ownership", async ctx => {
    const skill = find(state().skills.customs, ctx.params.id); if (!skill) return missing(ctx);
    const body = await ctx.body(), owner = find(companions.users?.() || core.fixture("GET", "/users") || [], body.new_owner_user_id);
    if (!owner) return invalid(ctx, "Select an available fictional user.");
    skill.owner = { id: owner.id, email: owner.email }; skill.user_permission = "EDITOR"; skill.ownership_vacant = false;
    if (owner.id !== user().id && !skill.user_shares.some(share => share.user.id === user().id)) skill.user_shares.push({ user: user(), permission: "EDITOR" });
    stale(); send(ctx, skillView(skill));
  });
  route("DELETE", "/skills/custom/:id", ctx => {
    if (!find(state().skills.customs, ctx.params.id)) return missing(ctx);
    state().skills.customs = state().skills.customs.filter(skill => skill.id !== ctx.params.id);
    reconcileApps(apps()); stale(); send(ctx, null);
  });
  route("POST", "/skills/github/preview", async ctx => {
    const body = await ctx.body();
    if (body.repository !== seed().github.repository) return invalid(ctx, "Only the editable fictional repository in fixture64 is available offline.");
    send(ctx, seed().github);
  });
  route("POST", "/skills/github/import", async ctx => {
    const body = await ctx.body();
    if (body.repository !== seed().github.repository) return invalid(ctx, "Fictional repository not available offline.");
    const imported = [], not_imported = [];
    for (const path of body.paths || []) {
      const item = seed().github.skills.find(skill => skill.path === path);
      if (!item || item.unavailable_reason) { not_imported.push({ path, name: item?.name || path, reason: item?.unavailable_reason || "Skill not found." }); continue; }
      const enabled = !conflict(item.name), skill = newSkill({ name: item.name, description: item.description,
        instructions_markdown: seed().upload_bundle.instructions_markdown }, enabled);
      state().skills.customs.push(skill); imported.push({ skill: skillView(skill), disabled_reason: enabled ? null : "Another skill with this name is enabled." });
    }
    stale(); send(ctx, { imported, not_imported });
  });

  const userApps = () => reconcileApps(apps()).filter(app => app.enabled).map(app => {
    const credential = state().credentials[app.id];
    const keys = app.credential_placeholder_keys.filter(key => !app.organization_credentials[key]);
    return { id: app.id, name: app.name, app_type: app.app_type, credential_keys: keys,
      credential_values: credential?.values || {}, authenticated: credential?.authenticated ?? (keys.length === 0 && !seed().credentials[app.id]?.supports_oauth),
      supports_oauth: !!seed().credentials[app.id]?.supports_oauth };
  });
  route("GET", "/build/apps", ctx => send(ctx, userApps()));
  route("POST", "/build/apps/:id/credentials", async ctx => {
    const app = find(userApps(), ctx.params.id); if (!app) return missing(ctx);
    const body = await ctx.body();
    if (app.credential_keys.some(key => !String(body.user_credentials?.[key] || "").trim())) return invalid(ctx, "Every fictional credential field is required.");
    state().credentials[app.id] = { authenticated: true, values: Object.fromEntries(app.credential_keys.map(key => [key, seed().fake_credential])) };
    stale(); send(ctx, null);
  });
  route("DELETE", "/build/apps/:id/credentials", ctx => {
    if (!find(apps(), ctx.params.id)) return missing(ctx);
    state().credentials[ctx.params.id] = { authenticated: false, values: {} }; stale(); send(ctx, null);
  });
  // Redirect only to the native callback with fictional markers; no OAuth provider contacted.
  route("GET", "/build/apps/:id/oauth/start", ctx => {
    if (!find(apps(), ctx.params.id)) return missing(ctx);
    send(ctx, { authorize_url: `/craft/v1/apps/oauth/callback?code=mockshop-craft-only&state=${ctx.params.id}` });
  });
  route("POST", "/build/apps/oauth/callback", async ctx => {
    const body = await ctx.body(), app = find(apps(), body.state);
    if (!app || body.code !== "mockshop-craft-only") return invalid(ctx, "This is a fictional local-only connection receipt.");
    await new Promise(resolve => setTimeout(resolve, seed().oauth_delay_ms));
    state().credentials[app.id] = { authenticated: true, supports_oauth: true, values: {} }; stale();
    send(ctx, { success: true, external_app_id: app.id });
  });
  route("GET", "/mcp/servers/craft", ctx => send(ctx, { mcp_servers: mcpServers().filter(server => server.available_in_craft) }));

  const schedule = (mode, payload) => {
    if (mode === "advanced") return payload.cron?.trim()?.split(/\s+/).length === 5 ? payload.cron.trim() : null;
    if (mode === "interval") {
      const every = Number(payload.every);
      if (!Number.isInteger(every) || every < 1) return null;
      if (payload.unit === "minutes" && every <= 59) return `*/${every} * * * *`;
      if (payload.unit === "hours" && every <= 23) return `0 */${every} * * *`;
      return null;
    }
    if (mode === "daily_weekly" && /^\d\d:\d\d$/.test(payload.time_of_day)) {
      const [hour, minute] = payload.time_of_day.split(":").map(Number);
      if (hour > 23 || minute > 59) return null;
      return `${minute} ${hour} * * ${payload.weekdays?.length ? [...payload.weekdays].sort().join(",") : "*"}`;
    }
    return null;
  };
  const sessionView = session => ({ ...session, session_loaded_in_sandbox: session.sandbox?.status === "running" });
  const createSession = (name, origin = "INTERACTIVE") => {
    const session = { ...copy(seed().session_defaults), id: nextId("session"), user_id: user().id,
      name: name || "Fresh Craft", origin, created_at: now(), last_activity_at: now(), artifacts: [], files: [] };
    state().sessions.push(session); return session;
  };
  const messages = session => session.messages ||= [];
  const runTask = task => {
    const session = createSession(task.name, "SCHEDULED");
    const run = { id: nextId("run"), status: "SUCCEEDED", trigger_source: "MANUAL_RUN_NOW", started_at: now(), finished_at: now(),
      session_id: session.id, summary: seed().task_output, skip_reason: null, error_class: null };
    messages(session).push({ id: nextId("message"), session_id: session.id, turn_index: 0, type: "assistant", content: seed().task_output,
      message_metadata: { type: "agent_message", content: { type: "text", text: seed().task_output } }, created_at: now() });
    session.artifacts = copy(seed().output_artifacts).map(artifact => ({ ...artifact, session_id: session.id, created_at: now(), updated_at: now() }));
    session.files = copy(seed().output_files);
    session.scheduled_run_context = { run_id: run.id, task_id: task.id, task_name: task.name, status: run.status, started_at: run.started_at, finished_at: run.finished_at };
    (state().runs[task.id] ||= []).unshift(run); task.last_run = run; return run;
  };
  route("GET", "/build/scheduled-tasks", ctx => send(ctx, { items: state().tasks }));
  route("POST", "/build/scheduled-tasks", async ctx => {
    const body = await ctx.body(), cron = schedule(body.editor_mode, body.editor_payload || {});
    if (!body.name?.trim() || !body.prompt?.trim() || !cron) return invalid(ctx, "Name, prompt and a valid schedule are required.");
    const task = { ...body, id: nextId("task"), status: body.status || "ACTIVE", cron_expression: cron,
      human_readable_schedule: cron, next_run_at: seed().next_run_at, next_runs: [seed().next_run_at], last_run: null,
      pre_approved_app_ids: body.pre_approved_app_ids || [], pre_approved_mcp_server_ids: body.pre_approved_mcp_server_ids || [], created_at: now(), updated_at: now() };
    state().tasks.push(task); if (body.run_immediately) runTask(task); send(ctx, task);
  });
  route("GET", "/build/scheduled-tasks/:id", ctx => { const task = find(state().tasks, ctx.params.id); task ? send(ctx, task) : missing(ctx); });
  route("PATCH", "/build/scheduled-tasks/:id", async ctx => {
    const task = find(state().tasks, ctx.params.id); if (!task) return missing(ctx);
    const body = await ctx.body(), cron = body.editor_payload ? schedule(body.editor_mode || task.editor_mode, body.editor_payload) : task.cron_expression;
    if (!cron || ("name" in body && !body.name.trim()) || ("prompt" in body && !body.prompt.trim())) return invalid(ctx, "Name, prompt and a valid schedule are required.");
    Object.assign(task, body, { cron_expression: cron, updated_at: now() });
    task.next_run_at = task.status === "PAUSED" ? null : seed().next_run_at; task.next_runs = task.next_run_at ? [task.next_run_at] : [];
    send(ctx, task);
  });
  route("DELETE", "/build/scheduled-tasks/:id", ctx => {
    if (!find(state().tasks, ctx.params.id)) return missing(ctx);
    state().tasks = state().tasks.filter(task => task.id !== ctx.params.id); send(ctx, null);
  });
  route("POST", "/build/scheduled-tasks/:id/run-now", ctx => {
    const task = find(state().tasks, ctx.params.id); if (!task) return missing(ctx);
    const run = runTask(task); send(ctx, { run_id: run.id, status: run.status });
  });
  route("GET", "/build/scheduled-tasks/:id/runs", ctx => {
    const rows = state().runs[ctx.params.id]; if (!rows) return find(state().tasks, ctx.params.id) ? send(ctx, { items: [], next_cursor: null }) : missing(ctx);
    const start = Number(ctx.query.cursor || 0), limit = Number(ctx.query.limit || 20), end = start + limit;
    send(ctx, { items: rows.slice(start, end), next_cursor: end < rows.length ? String(end) : null });
  });

  route("GET", "/build/sessions", ctx => send(ctx, { sessions: state().sessions.filter(session => messages(session).length || session.name !== "Fresh Craft").map(sessionView) }));
  route("POST", "/build/sessions", async ctx => send(ctx, sessionView(createSession((await ctx.body()).name))));
  route("GET", "/build/sessions/:id", ctx => { const session = find(state().sessions, ctx.params.id); session ? send(ctx, sessionView(session)) : missing(ctx); });
  for (const suffix of ["restore", "skills/reload"]) route("POST", `/build/sessions/:id/${suffix}`, ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    session.skills_stale = false; session.sandbox.status = "running";
    send(ctx, suffix === "restore" ? sessionView(session) : { skills_stale: false });
  });
  route("GET", "/build/sessions/:id/sandbox-status", ctx => { const session = find(state().sessions, ctx.params.id); session ? send(ctx, { status: session.sandbox.status }) : missing(ctx); });
  route("GET", "/build/sessions/:id/pre-provisioned-check", ctx => {
    const session = find(state().sessions, ctx.params.id), valid = !!session && messages(session).length === 0;
    send(ctx, { valid, session_id: valid ? session.id : null });
  });
  route("GET", "/build/sessions/:id/messages", ctx => { const session = find(state().sessions, ctx.params.id); session ? send(ctx, { messages: messages(session) }) : missing(ctx); });
  route("POST", "/build/sessions/:id/generate-name", ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    session.name = seed().generated_name; send(ctx, { name: session.name });
  });
  route("PUT", "/build/sessions/:id/name", async ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const body = await ctx.body(); if (!body.name?.trim()) return invalid(ctx, "A session name is required.");
    session.name = body.name.trim(); send(ctx, null);
  });
  route("PATCH", "/build/sessions/:id/public", async ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    session.sharing_scope = (await ctx.body()).sharing_scope; send(ctx, { session_id: session.id, sharing_scope: session.sharing_scope });
  });
  route("DELETE", "/build/sessions/:id", ctx => {
    if (!find(state().sessions, ctx.params.id)) return missing(ctx);
    state().sessions = state().sessions.filter(session => session.id !== ctx.params.id); delete state().turns[ctx.params.id]; send(ctx, null);
  });
  route("POST", "/build/sessions/:id/send-message", async ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const view = state().views["/build/sessions/:id/send-message"];
    if (view?.state === "error") return ctx.send(500, { detail: "Intentional fictional Craft prompt error." });
    if (view?.state === "limited") return ctx.send(429, { error_code: "RATE_LIMITED", detail: "Fictional Craft usage limit reached.",
      scope: "user", reset_at: seed().next_run_at, retry_after_seconds: 60 });
    const body = await ctx.body(); if (!body.content?.trim()) return invalid(ctx, "Write a Craft prompt before sending.");
    const catalog = companions.providerCatalog?.() || core.state.saveControlsProviderCatalog?.() || core.fixture("GET", "/llm/provider");
    const provider = catalog.providers.find(row => row.id === body.provider_id) || catalog.providers.find(row => row.id === catalog.default_craft?.provider_id) || catalog.providers.find(row => row.id === catalog.default_text?.provider_id);
    if (!provider) return invalid(ctx, "Configure a supported fictional Craft provider first.");
    session.agent_provider = provider.provider; session.agent_model = body.model || catalog.default_craft?.model_name || catalog.default_text?.model_name;
    const turn = { turn_id: nextId("turn"), session_id: session.id, turn_index: messages(session).filter(row => row.type === "user").length, status: "RUNNING", packets: copy(seed().turn_packets) };
    for (const packet of turn.packets) {
      if (packet.type === "approval_requested") {
        const template = find(state().approvals.map(row => ({ ...row, id: row.approval_id })), packet.approval_id);
        if (template) {
          const approval = { ...copy(template), approval_id: nextId("approval"), session_id: session.id, decision: null, decided_at: null, is_live: true };
          delete approval.id; state().approvals.push(approval); packet.approval_id = approval.approval_id;
        }
        packet.session_id = session.id;
      }
      if (packet.type === "connect_app_request") packet.request_id = nextId("connect-request");
      if (packet.parent_session_id === "$session") packet.parent_session_id = session.id;
      if (packet._meta?.parentSessionId === "$session") packet._meta.parentSessionId = session.id;
    }
    messages(session).push({ id: nextId("message"), session_id: session.id, turn_index: turn.turn_index, type: "user", content: body.content,
      created_at: now(), message_metadata: { type: "user_message", content: { type: "text", text: body.content }, attachments: body.attachments || [] } });
    state().turns[session.id] = turn; session.last_activity_at = now(); send(ctx, turn);
  });
  route("GET", "/build/sessions/:id/turns/active", ctx => {
    const turn = state().turns[ctx.params.id]; send(ctx, turn?.status === "RUNNING" ? turn : null);
  });
  route("POST", "/build/sessions/:id/interrupt", ctx => {
    const turn = state().turns[ctx.params.id]; if (turn) turn.status = "CANCELLED"; send(ctx, null);
  });
  route("GET", "/build/sessions/:id/turns/:turn/events", async ctx => {
    const current = state(), turn = current.turns[ctx.params.id], session = find(current.sessions, ctx.params.id);
    if (!session || turn?.turn_id !== ctx.params.turn) return missing(ctx);
    ctx.res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const packet of turn.packets) {
      if (data !== current || turn.status !== "RUNNING" || ctx.res.destroyed) break;
      // Native completed-write packets immediately expose/open the written file.
      // Publish its actual fictional bytes before emitting that packet, not only
      // after the whole turn; already-uploaded attachments stay in this catalog.
      if (packet.type === "tool_call_progress" && packet.status === "completed" && packet.kind === "edit") {
        const written = seed().output_files.find(file => file.path === packet.raw_input?.filePath);
        const files = outputFiles(session);
        if (written && !files.some(file => file.path === written.path)) files.push(copy(written));
      }
      ctx.res.write(`event: message\ndata: ${JSON.stringify(packet)}\n\n`);
      if (!["agent_message_chunk", "context_usage", "artifact_created"].includes(packet.type))
        messages(session).push({ id: nextId("message"), session_id: session.id, turn_index: turn.turn_index, type: "assistant",
          content: packet.content?.text || "", created_at: now(), message_metadata: copy(packet) });
      await new Promise(resolve => setTimeout(resolve, seed().packet_delay_ms));
    }
    if (data === current && turn.status === "RUNNING") {
      turn.status = "SUCCEEDED";
      messages(session).push({ id: nextId("message"), session_id: session.id, type: "assistant", turn_index: turn.turn_index,
        content: seed().answer, created_at: now(), message_metadata: { type: "agent_message", content: { type: "text", text: seed().answer } } });
      session.artifacts = copy(seed().output_artifacts).map(artifact => ({ ...artifact, session_id: session.id, created_at: now(), updated_at: now() }));
      session.files = [...copy(seed().output_files), ...outputFiles(session).filter(file => file.path.startsWith("user_uploaded_files/"))];
      ctx.res.write(`event: message\ndata: ${JSON.stringify({ type: "prompt_response" })}\n\n`);
    }
    ctx.res.end();
  });
  route("GET", "/build/sessions/:id/scheduled-run-context", ctx => send(ctx, find(state().sessions, ctx.params.id)?.scheduled_run_context || null));
  route("GET", "/build/sessions/:id/scheduled-run-events", ctx => ctx.send(200, "event: message\ndata: {\"type\":\"prompt_response\"}\n\n", { "content-type": "text/event-stream" }));
  route("GET", "/build/approvals/sessions/:id/live", ctx => send(ctx, { items: state().approvals.filter(row => row.session_id === ctx.params.id && row.is_live) }));
  for (const suffix of ["decision", "session-grant"]) route("POST", `/build/approvals/:id/${suffix}`, async ctx => {
    const approval = state().approvals.find(row => row.approval_id === ctx.params.id); if (!approval) return missing(ctx);
    if (approval.decision) return ctx.send(409, { detail: "This fictional approval is already resolved." });
    approval.decision = suffix === "session-grant" ? "APPROVED" : (await ctx.body()).decision;
    approval.decided_at = now(); approval.is_live = false; send(ctx, approval);
  });

  route("POST", "/build/apps/connect/:id/decision", async ctx => {
    const body = await ctx.body();
    if (!["connected", "declined"].includes(body.decision)) return invalid(ctx, "Choose connected or declined.");
    const current = state();
    current.connections[ctx.params.id] = body.decision;
    // Settle the stored native request too; reopening a session must not ask again.
    for (const session of current.sessions) {
      const rows = messages(session);
      for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
        const message = rows[rowIndex], metadata = message.message_metadata;
        if (metadata?.request_id !== ctx.params.id || !Array.isArray(metadata.streamItems)) continue;
        for (let index = metadata.streamItems.length - 1; index >= 0; index--) {
          const item = metadata.streamItems[index];
          if (item.type === "connect_app_request" && item.requestId === ctx.params.id) metadata.streamItems.splice(index, 1);
        }
        // A request-only row has no remaining content after settlement.
        if (!metadata.streamItems.length && !message.content) rows.splice(rowIndex, 1);
      }
    }
    send(ctx, null);
  });
  route("GET", "/build/mockshop-preview", ctx => send(ctx, seed().preview_html, { "content-type": "text/html; charset=utf-8" }));
  const archiveDownload = ctx => {
    if (!find(state().sessions, ctx.params.id)) return missing(ctx);
    ctx.res.writeHead(200, { "content-type": "application/zip", "content-disposition": "attachment; filename=fictional-craft-output.zip" });
    ctx.res.end(Buffer.from(seed().archive_base64, "base64"));
  };
  route("GET", "/build/sessions/:id/download-directory/*", archiveDownload);
  route("GET", "/build/sessions/:id/webapp-download", archiveDownload);
  route("GET", "/build/sessions/:id/export-docx/*", ctx => {
    if (!find(state().sessions, ctx.params.id)) return missing(ctx);
    if (!companions.serveFile) throw new Error("#70 DOCX button requires #28 byte-serving callback");
    return companions.serveFile({ ...ctx, params: { ...ctx.params, id: seed().downloads.docx_file_id } });
  });
  const outputFiles = session => session.files ||= copy(seed().output_files);
  route("GET", "/build/sessions/:id/artifacts", ctx => { const session = find(state().sessions, ctx.params.id); session ? send(ctx, session.artifacts) : missing(ctx); });
  route("GET", "/build/sessions/:id/webapp-info", ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const preview = copy(seed().webapp_info);
    if (session.artifacts.length) {
      if (!companions.previewOrigin) throw new Error("#70 sharing requires the parent's browser previewOrigin(ctx) callback");
      preview.webapp_url = new URL(preview.webapp_url, companions.previewOrigin(ctx)).href;
    }
    send(ctx, session.artifacts.length ? { ...preview, sharing_scope: session.sharing_scope }
      : { has_webapp: false, webapp_url: null, status: "none", ready: false, sharing_scope: session.sharing_scope });
  });
  route("GET", "/build/sessions/:id/files", ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const path = ctx.query.path || "", prefix = path ? `${path}/` : "", entries = new Map();
    for (const file of outputFiles(session)) {
      if (!file.path.startsWith(prefix)) continue;
      const suffix = file.path.slice(prefix.length), name = suffix.split("/")[0], directory = suffix.includes("/");
      entries.set(name, { name, path: `${prefix}${name}`, is_directory: directory, size: directory ? null : file.size,
        mime_type: directory ? null : file.mime_type });
    }
    send(ctx, { path, entries: [...entries.values()] });
  });
  route("GET", "/build/sessions/:id/pptx-preview/*", ctx => {
    if (!find(state().sessions, ctx.params.id)) return missing(ctx);
    send(ctx, seed().pptx_preview);
  });
  route("GET", "/build/sessions/:id/artifacts/*", ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const path = decodeURIComponent(ctx.path.slice(`/build/sessions/${ctx.params.id}/artifacts/`.length));
    const file = outputFiles(session).find(row => row.path === path); if (!file) return missing(ctx);
    // Reuse #28's byte-serving handler for existing file catalog IDs. Craft only adapts its URL.
    if (file.shared_file_id) {
      if (!companions.serveFile) throw new Error("#70 binary previews require #28 byte-serving callback");
      return companions.serveFile({ ...ctx, params: { ...ctx.params, id: file.shared_file_id } });
    }
    if (file.fixture_bytes) {
      ctx.res.writeHead(200, { "content-type": file.mime_type });
      return ctx.res.end(Buffer.from(seed()[file.fixture_bytes], "base64"));
    }
    send(ctx, file.content, { "content-type": file.mime_type });
  });
  route("POST", "/build/sessions/:id/upload", async ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const file = (await multipart(ctx)).get("file"); if (!file || typeof file === "string") return invalid(ctx, "Select a fictional attachment.");
    const path = `user_uploaded_files/${file.name}`;
    const shared_file_id = file.type.startsWith("image/") ? seed().downloads.image_file_id
      : file.type === "application/pdf" ? seed().downloads.pdf_file_id
      : /\.docx$/i.test(file.name) ? seed().downloads.docx_file_id
      : /\.xlsx$/i.test(file.name) ? "demo-xlsx" : null;
    outputFiles(session).push({ path, size: file.size, mime_type: file.type || "text/plain", content: seed().upload_text,
      ...(shared_file_id ? { shared_file_id } : {}), ...(/\.pptx$/i.test(file.name) ? { fixture_bytes: "presentation_base64" } : {}) });
    send(ctx, { filename: file.name, path, size_bytes: file.size });
  });
  route("DELETE", "/build/sessions/:id/files/*", ctx => {
    const session = find(state().sessions, ctx.params.id); if (!session) return missing(ctx);
    const path = decodeURIComponent(ctx.path.slice(`/build/sessions/${ctx.params.id}/files/`.length));
    session.files = outputFiles(session).filter(file => file.path !== path); send(ctx, null);
  });
  route("GET", "/build/user-library/tree", ctx => send(ctx, state().library));
  route("POST", "/build/user-library/directories", async ctx => {
    const body = await ctx.body(), name = body.name?.trim();
    if (!name || name.includes("/") || state().library.some(row => row.name === name && row.is_directory)) return invalid(ctx, "Use a unique nonempty folder name.");
    const row = { id: nextId("library"), name, path: `${body.parent_path === "/" ? "user_library" : body.parent_path}/${name}`,
      is_directory: true, file_size: null, mime_type: null, sync_enabled: true, created_at: now() };
    state().library.push(row); send(ctx, row);
  });
  for (const suffix of ["upload", "upload-zip"]) route("POST", `/build/user-library/${suffix}`, async ctx => {
    const form = await multipart(ctx), files = form.getAll(suffix === "upload" ? "files" : "file").filter(file => typeof file !== "string");
    if (!files.length) return invalid(ctx, "Select a fictional library file.");
    const path = String(form.get("path") || "/");
    const prefix = path === "/" ? "user_library" : path.startsWith("user_library/") ? path : `user_library/${path.replace(/^\/+/, "")}`;
    const entries = files.flatMap(file => suffix === "upload-zip" ? seed().library_zip_entries
      : [{ name: file.name, path: file.name, file_size: file.size, mime_type: file.type, is_directory: false }])
      .map(file => ({ ...copy(file), id: nextId("library"), path: `${prefix}/${file.path}`,
        sync_enabled: true, created_at: now() }));
    state().library.push(...entries); send(ctx, { entries, total_uploaded: entries.length, total_size_bytes: entries.reduce((sum, row) => sum + row.file_size, 0) });
  });
  route("DELETE", "/build/user-library/files/:id", ctx => {
    const row = find(state().library, ctx.params.id); if (!row) return missing(ctx);
    state().library = state().library.filter(item => item.id !== row.id && !item.path.startsWith(`${row.path}/`)); send(ctx, null);
  });
  return { routes, transform: { "GET /build/admin/apps": () => reconcileApps(apps()) }, listSkills, reconcileApps, afterAppWrite, userApps,
    reset(body = {}) { if (!body.keep) data = undefined; } };
}
