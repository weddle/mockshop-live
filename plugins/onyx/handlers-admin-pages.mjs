// Native remaining-admin controls, fictional run-local configuration only.
// No provider calls, authentication, account writes, real billing or durable storage.
export default function createAdminPages(core, composition = {}) {
  let data;
  let documentsLoaded = false;
  const reset = (body = {}) => {
    if (!body.keep) { data = null; documentsLoaded = body.admin_documents_fixture === "loaded"; core.state.adminCraftEnabled = {}; }
  };
  reset();
  const seed = (path) => structuredClone(core.fixture("GET", path));
  const defaults = () => core.fixture("GET", "/mockshop/admin-pages/defaults");
  const now = () => new Date(core.demoNow()).toISOString();
  const fake = () => defaults().fake_secret;
  const nextId = (rows, field = "id") => Math.max(6500, ...rows.map((r) => Number(r[field]) || 0)) + 1;
  const billingSeed = () => {
    const kind = core.fixture("GET", "/mockshop/admin-pages/billing-case");
    return kind ? structuredClone(core.fixture("GET", "/mockshop/admin-pages/billing-snapshots")[kind]) : null;
  };
  const state = () => data ||= {
    settings: {}, enterprise: {}, security: seed("/admin/security"), assistant: seed("/admin/default-assistant/configuration"),
    webSearch: seed("/admin/web-search/search-providers"), webContent: seed("/admin/web-search/content-providers"),
    voice: seed("/admin/voice/providers"), tracing: seed("/admin/tracing/providers"), images: seed("/admin/image-generation/config"), imageCredentials: {},
    apiKeys: seed("/admin/api-key"), sso: seed("/admin/sso/provider"), domains: {}, scim: seed("/admin/enterprise-settings/scim/token"),
    code: seed("/admin/code-interpreter"), search: seed("/search-settings/get-current-search-settings"), secondary: seed("/search-settings/get-secondary-search-settings"),
    embedding: seed("/admin/embedding/embedding-provider"), unstructured: seed("/search-settings/unstructured-api-key-set"),
    bots: seed("/manage/admin/slack-app/bots"), channels: seed("/manage/admin/slack-app/channel"), discord: seed("/manage/admin/discord-bot/config"),
    guilds: seed("/manage/admin/discord-bot/guilds"), discordChannels: { 6501: seed("/manage/admin/discord-bot/guilds/6501/channels") },
    hooks: seed("/admin/hooks"), hookLogs: {}, answers: seed("/manage/admin/standard-answer"), categories: seed("/manage/admin/standard-answer/category"),
    apps: seed("/build/admin/apps"), reports: seed("/admin/usage-report"), exports: [], logs: {}, banner: seed("/admin/banner"), bannerDismissed: false,
    federated: seed("/federated/6501"), modelDefaults: {}, customAnalytics: undefined, logo: null, license: null,
    openapi: seed("/tool/openapi"), oauthConfigs: [],
    globalLimits: seed("/admin/token-rate-limits/global"), userLimits: seed("/admin/token-rate-limits/users"),
    billing: billingSeed(),
    billingHandoffs: { checkout: null, portal: null },
    documents: documentsLoaded ? seed("/mockshop/admin-pages/documents") : [],
  };
  // Expose the owned mutable rows; a composed Skills module can reconcile them.
  const apps = () => state().apps;
  const afterAppWrite = (row, body) => {
    if (body.associated_skill_ids) {
      const { builtins, customs } = composition.listSkills?.() ?? { builtins: [], customs: [] };
      row.associated_skills = [
        ...row.associated_skills.filter((item) => builtins.some((skill) => skill.id === item.id)),
        ...customs.filter((skill) => body.associated_skill_ids.includes(skill.id))
          .map((skill) => ({ id: skill.id, name: skill.name, is_valid: skill.is_valid })),
      ];
    }
    composition.afterAppWrite?.(row, body);
  };
  const routes = [];
  const route = (method, path, fn) => routes.push({ method, path, async handle(ctx) { return fn(ctx, state()); } });
  const send = (ctx, value) => ctx.send(200, value);
  const missing = (ctx) => ctx.send(404, { detail: "Fictional admin row not found." });
  const byId = (rows, id, field = "id") => rows.find((r) => String(r[field]) === String(id));
  const scrub = (body) => {
    const out = structuredClone(body);
    for (const key of Object.keys(out)) {
      if (/secret|token|api_key|private_key|x509_cert|credential/i.test(key) && out[key] != null) {
        out[key] = typeof out[key] === "object" ? Object.fromEntries(Object.keys(out[key]).map((k) => [k, fake()])) : fake();
      } else if (key === "config" || key === "custom_config") out[key] = scrub(out[key] || {});
      else if (key === "custom_headers") out[key] = out[key].map((header) => ({ key: header.key, value: fake() }));
    }
    return out;
  };
  const simulatedTest = (ctx) => send(ctx, { simulated: true, message: "Local fictional configuration accepted; no provider was contacted." });

  route("PATCH", "/admin/settings", async (ctx, s) => {
    Object.assign(s.settings, await ctx.body()); send(ctx, { ...core.fixture("GET", "/settings"), ...defaults().settings, ...s.settings });
  });
  route("PATCH", "/admin/default-assistant", async (ctx, s) => {
    Object.assign(s.assistant, await ctx.body()); send(ctx, s.assistant);
  });
  for (const [suffix, field] of [["default-chat-naming", "default_chat_naming"], ["default-craft", "default_craft"]]) {
    route("POST", `/admin/llm/${suffix}`, async (ctx, s) => { s.modelDefaults[field] = await ctx.body(); send(ctx, s.modelDefaults[field]); });
    route("DELETE", `/admin/llm/${suffix}`, (ctx, s) => { s.modelDefaults[field] = null; send(ctx, null); });
  }
  route("POST", "/admin/llm/default-vision", async (ctx, s) => { s.modelDefaults.default_vision = await ctx.body(); send(ctx, s.modelDefaults.default_vision); });
  route("PATCH", "/manage/admin/users/craft-enabled", async (ctx) => {
    const body = await ctx.body();
    for (const email of body.user_emails) core.state.adminCraftEnabled[email] = body.craft_enabled;
    send(ctx, { simulated: true, updated_count: body.user_emails.length });
  });
  // Two opt-in fictional admin rows; no production search or feedback engine.
  route("POST", "/admin/search", async (ctx, s) => {
    const query = String((await ctx.body()).query ?? "").trim().toLowerCase();
    const documents = s.documents.filter((row) => `${row.semantic_identifier} ${row.blurb}`.toLowerCase().includes(query));
    send(ctx, { documents: documents.map(({ feedback_bucket, ...document }) => document) });
  });
  route("GET", "/manage/admin/doc-boosts", (ctx, s) => {
    const bucket = ctx.query.ascending === "true" ? "disliked" : "liked";
    send(ctx, s.documents.filter((row) => row.feedback_bucket === bucket).map((row) => ({
      document_id: row.document_id, semantic_id: row.semantic_identifier, link: row.link, boost: row.boost, hidden: row.hidden,
    })));
  });
  for (const [path, field] of [["/manage/admin/doc-boosts", "boost"], ["/manage/admin/doc-hidden", "hidden"]]) {
    route("POST", path, async (ctx, s) => {
      const body = await ctx.body(), row = s.documents.find((document) => document.document_id === body.document_id);
      if (!row) return false;
      row[field] = body[field]; send(ctx, { simulated: true });
    });
  }
  route("PUT", "/admin/security", async (ctx, s) => {
    const body = await ctx.body();
    for (const key of Object.keys(s.security)) if (key in body) s.security[key] = body[key] ?? seed("/admin/security")[key];
    send(ctx, s.security);
  });
  route("PUT", "/admin/code-interpreter", async (ctx, s) => { s.code.enabled = (await ctx.body()).enabled; send(ctx, s.code); });

  // Two native provider categories; activation selects one default in its own category.
  for (const [category, field] of [["search", "webSearch"], ["content", "webContent"]]) {
    const path = `/admin/web-search/${category}-providers`;
    route("POST", `${path}/test`, simulatedTest);
    route("POST", path, async (ctx, s) => {
      const body = await ctx.body(), previous = byId(s[field], body.id);
      const row = { id: previous?.id ?? nextId(s[field]), name: body.name, provider_type: body.provider_type,
        config: scrub(body.config || {}), masked_api_key: body.api_key ? fake() : previous?.masked_api_key ?? null,
        is_active: body.activate ?? previous?.is_active ?? false };
      if (row.is_active) for (const item of s[field]) item.is_active = false;
      if (previous) Object.assign(previous, row); else s[field].push(row);
      send(ctx, row);
    });
    for (const active of [true, false]) route("POST", `${path}/:id/${active ? "activate" : "deactivate"}`, (ctx, s) => {
      const row = byId(s[field], ctx.params.id); if (!row) return missing(ctx);
      if (active) for (const item of s[field]) item.is_active = false;
      row.is_active = active; send(ctx, row);
    });
  }
  route("POST", "/admin/web-search/content-providers/reset-default", (ctx, s) => {
    for (const row of s.webContent) row.is_active = row.provider_type === "onyx_web_crawler"; send(ctx, s.webContent);
  });

  route("POST", "/admin/voice/providers/test", simulatedTest);
  route("POST", "/admin/voice/providers", async (ctx, s) => {
    const body = await ctx.body(), existing = byId(s.voice, body.id);
    const row = { ...existing, ...scrub(body), id: existing?.id ?? nextId(s.voice),
      api_key: body.api_key ? fake() : existing?.api_key ?? null, api_secret: body.api_secret ? fake() : existing?.api_secret ?? null,
      target_uri: body.target_uri ?? existing?.target_uri ?? null, is_default_stt: body.activate_stt,
      is_default_tts: body.activate_tts };
    if (row.is_default_stt) for (const item of s.voice) item.is_default_stt = false;
    if (row.is_default_tts) for (const item of s.voice) item.is_default_tts = false;
    if (existing) Object.assign(existing, row); else s.voice.push(row); send(ctx, row);
  });
  for (const mode of ["stt", "tts"]) for (const active of [true, false]) {
    route("POST", `/admin/voice/providers/:id/${active ? "activate" : "deactivate"}-${mode}`, (ctx, s) => {
      const row = byId(s.voice, ctx.params.id); if (!row) return missing(ctx);
      if (active) for (const item of s.voice) item[`is_default_${mode}`] = false;
      row[`is_default_${mode}`] = active;
      if (ctx.query.tts_model) row.tts_model = ctx.query.tts_model; send(ctx, row);
    });
  }
  route("DELETE", "/admin/voice/providers/:id", (ctx, s) => { s.voice = s.voice.filter((r) => String(r.id) !== ctx.params.id); send(ctx, {}); });
  route("POST", "/admin/tracing/providers/test", simulatedTest);
  route("POST", "/admin/tracing/providers", async (ctx, s) => {
    const body = await ctx.body(), row = s.tracing.find((r) => r.provider_type === body.provider_type);
    if (!row) return missing(ctx);
    const hasKey = body.api_key_changed ? !!body.api_key : !!row.masked_api_key;
    Object.assign(row, { config: scrub(body.config || {}), enabled: body.enabled,
      connected: body.enabled && hasKey, source: hasKey ? "db" : "none",
      masked_api_key: hasKey ? fake() : null }); send(ctx, row);
  });

  route("POST", "/admin/image-generation/test", simulatedTest);
  const imageSave = (body, s, id) => {
    const existing = s.images.find((r) => r.image_provider_id === id);
    const source = core.fixture("GET", "/admin/llm/provider").providers.find((p) => p.id === body.source_llm_provider_id);
    const row = { image_provider_id: id, model_name: body.model_name, model_configuration_id: existing?.model_configuration_id ?? nextId(s.images, "model_configuration_id"),
      llm_provider_id: source?.id ?? 6501, llm_provider_name: source?.name ?? "Fictional image configuration", is_default: body.is_default ?? existing?.is_default ?? false };
    s.imageCredentials[id] = { api_key: fake(), api_base: body.api_base ?? null, api_version: body.api_version ?? null,
      deployment_name: body.deployment_name ?? null, custom_config: scrub(body.custom_config || {}) };
    if (row.is_default) for (const item of s.images) item.is_default = false;
    if (existing) Object.assign(existing, row); else s.images.push(row); return row;
  };
  route("POST", "/admin/image-generation/config", async (ctx, s) => { const b = await ctx.body(); send(ctx, imageSave(b, s, b.image_provider_id)); });
  route("PUT", "/admin/image-generation/config/:id", async (ctx, s) => send(ctx, imageSave(await ctx.body(), s, ctx.params.id)));
  route("GET", "/admin/image-generation/config/:id/credentials", (ctx, s) => s.imageCredentials[ctx.params.id] ? send(ctx, s.imageCredentials[ctx.params.id]) : missing(ctx));
  for (const active of [true, false]) route(active ? "POST" : "DELETE", "/admin/image-generation/config/:id/default", (ctx, s) => {
    const row = s.images.find((r) => r.image_provider_id === ctx.params.id); if (!row) return missing(ctx);
    if (active) for (const item of s.images) item.is_default = false;
    row.is_default = active; send(ctx, row);
  });
  route("DELETE", "/admin/image-generation/config/:id", (ctx, s) => { s.images = s.images.filter((r) => r.image_provider_id !== ctx.params.id); delete s.imageCredentials[ctx.params.id]; send(ctx, {}); });

  const keyGroups = (ids) => (core.fixture("GET", "/manage/admin/user-group") || []).filter((g) => ids.includes(g.id)).map(({ id, name }) => ({ id, name }));
  route("POST", "/admin/api-key", async (ctx, s) => {
    const b = await ctx.body(), id = nextId(s.apiKeys, "api_key_id");
    const row = { api_key_id: id, api_key_display: defaults().api_key_display, api_key: null, api_key_name: b.name ?? null, groups: keyGroups(b.group_ids || []), user_id: `fake-service-${id}` };
    s.apiKeys.push(row); send(ctx, { ...row, api_key: fake() });
  });
  route("PATCH", "/admin/api-key/:id", async (ctx, s) => {
    const row = byId(s.apiKeys, ctx.params.id, "api_key_id"); if (!row) return missing(ctx);
    const b = await ctx.body(); Object.assign(row, { api_key_name: b.name ?? row.api_key_name, groups: keyGroups(b.group_ids || []) }); send(ctx, row);
  });
  route("POST", "/admin/api-key/:id/regenerate", (ctx, s) => {
    const row = byId(s.apiKeys, ctx.params.id, "api_key_id"); if (!row) return missing(ctx);
    row.api_key_display = `${defaults().api_key_display}-regenerated`; send(ctx, { ...row, api_key: fake() });
  });
  route("DELETE", "/admin/api-key/:id", (ctx, s) => { s.apiKeys = s.apiKeys.filter((r) => String(r.api_key_id) !== ctx.params.id); send(ctx, {}); });
  route("POST", "/admin/enterprise-settings/scim/token", async (ctx, s) => {
    const b = await ctx.body(); s.scim = { id: (s.scim?.id ?? 6500) + 1, name: b.name, token_display: defaults().api_key_display, is_active: true, created_at: now(), last_used_at: null, idp_domain: null };
    send(ctx, { ...s.scim, raw_token: fake() });
  });
  route("POST", "/admin/sso/provider", async (ctx, s) => {
    const b = scrub(await ctx.body()), row = { ...b, id: nextId(s.sso), enabled: false, redirect_uri: `/mockshop/fake-sso/${b.name}` };
    s.sso.push(row); send(ctx, row);
  });
  route("PATCH", "/admin/sso/provider/:id", async (ctx, s) => {
    const row = byId(s.sso, ctx.params.id); if (!row) return missing(ctx);
    Object.assign(row, scrub(await ctx.body())); send(ctx, row);
  });
  route("POST", "/admin/sso/provider/:id/enabled", async (ctx, s) => {
    const row = byId(s.sso, ctx.params.id); if (!row) return missing(ctx);
    row.enabled = (await ctx.body()).enabled; send(ctx, row);
  });
  const domainRecords = (s, domains) => ({ domains: domains.map((domain) => ({ domain, verified: !!s.domains[domain],
    claimed: s.sso.some((p) => p.allowed_email_domains.includes(domain)), record_host: `_onyx-demo.${domain}`, record_value: "mock-only-no-dns-verification" })) });
  route("POST", "/admin/sso/domain/records", async (ctx, s) => send(ctx, domainRecords(s, (await ctx.body()).domains)));
  route("POST", "/admin/sso/domain/verify-dns", async (ctx, s) => {
    const { domain } = await ctx.body(); s.domains[domain] = true; send(ctx, { ...domainRecords(s, [domain]), simulated: true });
  });

  route("PUT", "/admin/embedding/embedding-provider", async (ctx, s) => {
    const b = scrub(await ctx.body()), row = s.embedding.find((r) => r.provider_type === b.provider_type);
    if (row) Object.assign(row, b); else s.embedding.push(b); send(ctx, b);
  });
  route("POST", "/admin/embedding/test-embedding", simulatedTest);
  route("DELETE", "/admin/embedding/embedding-provider/:id", (ctx, s) => { s.embedding = s.embedding.filter((r) => r.provider_type !== ctx.params.id); send(ctx, {}); });
  route("POST", "/search-settings/set-new-search-settings", async (ctx, s) => {
    const b = scrub(await ctx.body()); s.search = { ...s.search, ...b, use_port_flow: true }; s.secondary = null; send(ctx, s.search);
  });
  route("POST", "/search-settings/update-inference-settings", async (ctx, s) => { Object.assign(s.search, scrub(await ctx.body())); send(ctx, s.search); });
  route("POST", "/search-settings/cancel-new-embedding", (ctx, s) => { s.secondary = null; send(ctx, {}); });
  route("PUT", "/search-settings/upsert-unstructured-api-key", async (ctx, s) => {
    const b = await ctx.body(); s.unstructured = !!b.unstructured_api_key; send(ctx, s.unstructured);
  });
  route("DELETE", "/search-settings/delete-unstructured-api-key", (ctx, s) => { s.unstructured = false; send(ctx, s.unstructured); });

  const botView = (s, bot) => { const channels = s.channels.filter((c) => c.slack_bot_id === bot.id); return { ...bot, configs_count: channels.length, slack_channel_configs: channels }; };
  route("GET", "/manage/admin/slack-app/bots/:id", (ctx, s) => { const row = byId(s.bots, ctx.params.id); row ? send(ctx, botView(s, row)) : missing(ctx); });
  route("GET", "/manage/admin/slack-app/bots/:id/config", (ctx, s) => send(ctx, s.channels.filter((c) => String(c.slack_bot_id) === ctx.params.id)));
  route("POST", "/manage/admin/slack-app/bots", async (ctx, s) => {
    const b = scrub(await ctx.body()), row = { ...b, id: nextId(s.bots), configs_count: 0, slack_channel_configs: [] }; s.bots.push(row); send(ctx, row);
  });
  route("PATCH", "/manage/admin/slack-app/bots/:id", async (ctx, s) => { const row = byId(s.bots, ctx.params.id); if (!row) return missing(ctx); Object.assign(row, scrub(await ctx.body())); send(ctx, botView(s, row)); });
  route("DELETE", "/manage/admin/slack-app/bots/:id", (ctx, s) => { s.bots = s.bots.filter((r) => String(r.id) !== ctx.params.id); s.channels = s.channels.filter((r) => String(r.slack_bot_id) !== ctx.params.id); send(ctx, {}); });
  const channelSave = (b, s, previous) => {
    const persona = b.persona_id != null ? core.fixture("GET", `/persona/${b.persona_id}`) : null;
    const row = { ...previous, id: previous?.id ?? nextId(s.channels), slack_bot_id: b.slack_bot_id ?? previous?.slack_bot_id,
      persona_id: b.persona_id ?? null, persona: persona || { id: 0, name: "Assistant", tools: [], document_sets:
        (core.fixture("GET", "/manage/document-set") || []).filter((d) => (b.document_sets || []).includes(d.id)) },
      enable_auto_filters: b.enable_auto_filters, is_default: !b.channel_name,
      channel_config: Object.fromEntries(["channel_name", "respond_tag_only", "respond_to_bots", "is_ephemeral",
        "show_continue_in_web_ui", "respond_member_group_list", "answer_filters", "follow_up_tags", "disabled"].map((key) => [key, b[key]])),
      standard_answer_categories: s.categories.filter((c) => (b.standard_answer_categories || []).includes(c.id)) };
    if (previous) Object.assign(previous, row); else s.channels.push(row); return row;
  };
  route("POST", "/manage/admin/slack-app/channel", async (ctx, s) => send(ctx, channelSave(await ctx.body(), s)));
  route("PATCH", "/manage/admin/slack-app/channel/:id", async (ctx, s) => { const row = byId(s.channels, ctx.params.id); row ? send(ctx, channelSave(await ctx.body(), s, row)) : missing(ctx); });
  route("DELETE", "/manage/admin/slack-app/channel/:id", (ctx, s) => { s.channels = s.channels.filter((r) => String(r.id) !== ctx.params.id); send(ctx, {}); });
  route("POST", "/manage/admin/discord-bot/config", async (ctx, s) => { await ctx.body(); s.discord = { configured: true, created_at: now() }; send(ctx, s.discord); });
  route("DELETE", "/manage/admin/discord-bot/config", (ctx, s) => { s.discord = { configured: false, created_at: null }; send(ctx, {}); });
  route("POST", "/manage/admin/discord-bot/guilds", (ctx, s) => { const id = nextId(s.guilds); s.guilds.push({ id, guild_id: null, guild_name: null, registered_at: null, enabled: true, default_persona_id: null }); s.discordChannels[id] = []; send(ctx, { id, registration_key: fake() }); });
  route("GET", "/manage/admin/discord-bot/guilds/:id", (ctx, s) => { const row = byId(s.guilds, ctx.params.id); row ? send(ctx, row) : missing(ctx); });
  route("PATCH", "/manage/admin/discord-bot/guilds/:id", async (ctx, s) => { const row = byId(s.guilds, ctx.params.id); if (!row) return missing(ctx); Object.assign(row, await ctx.body()); send(ctx, row); });
  route("DELETE", "/manage/admin/discord-bot/guilds/:id", (ctx, s) => { s.guilds = s.guilds.filter((r) => String(r.id) !== ctx.params.id); delete s.discordChannels[ctx.params.id]; send(ctx, {}); });
  route("GET", "/manage/admin/discord-bot/guilds/:id/channels", (ctx, s) => send(ctx, s.discordChannels[ctx.params.id] || []));
  route("PATCH", "/manage/admin/discord-bot/guilds/:id/channels/:channel", async (ctx, s) => {
    const row = byId(s.discordChannels[ctx.params.id] || [], ctx.params.channel); if (!row) return missing(ctx); Object.assign(row, await ctx.body()); send(ctx, row);
  });

  // Keep the static specs reader ahead of /:id; "specs" is not a hook ID.
  route("GET", "/admin/hooks/specs", (ctx) => send(ctx, core.fixture("GET", "/admin/hooks/specs")));
  route("POST", "/admin/hooks", async (ctx, s) => {
    const b = await ctx.body(), row = { ...scrub(b), id: nextId(s.hooks), api_key_masked: b.api_key ? fake() : null,
      is_active: true, is_reachable: true, creator_email: defaults().hook_creator, created_at: now(), updated_at: now() };
    delete row.api_key; s.hooks.push(row); send(ctx, row);
  });
  route("GET", "/admin/hooks/:id", (ctx, s) => { const row = byId(s.hooks, ctx.params.id); row ? send(ctx, row) : missing(ctx); });
  route("PATCH", "/admin/hooks/:id", async (ctx, s) => { const row = byId(s.hooks, ctx.params.id); if (!row) return missing(ctx); const b = scrub(await ctx.body()); if ("api_key" in b) { row.api_key_masked = b.api_key; delete b.api_key; } Object.assign(row, b, { updated_at: now() }); send(ctx, row); });
  for (const active of [true, false]) route("POST", `/admin/hooks/:id/${active ? "activate" : "deactivate"}`, (ctx, s) => { const row = byId(s.hooks, ctx.params.id); if (!row) return missing(ctx); row.is_active = active; send(ctx, row); });
  route("POST", "/admin/hooks/:id/validate", (ctx, s) => { if (!byId(s.hooks, ctx.params.id)) return missing(ctx); (s.hookLogs[ctx.params.id] ||= []).push({ error_message: null, status_code: 200, duration_ms: 0, created_at: now() }); send(ctx, { status: "passed", error_message: null, simulated: true }); });
  route("GET", "/admin/hooks/:id/execution-logs", (ctx, s) => send(ctx, s.hookLogs[ctx.params.id] || []));
  route("DELETE", "/admin/hooks/:id", (ctx, s) => { s.hooks = s.hooks.filter((r) => String(r.id) !== ctx.params.id); delete s.hookLogs[ctx.params.id]; send(ctx, {}); });
  const answerSave = (b, s, previous) => { const row = { ...previous, ...b, id: previous?.id ?? nextId(s.answers), categories: s.categories.filter((c) => (b.categories || []).includes(c.id)) }; if (previous) Object.assign(previous, row); else s.answers.push(row); return row; };
  route("POST", "/manage/admin/standard-answer", async (ctx, s) => send(ctx, answerSave(await ctx.body(), s)));
  route("PATCH", "/manage/admin/standard-answer/:id", async (ctx, s) => { const row = byId(s.answers, ctx.params.id); row ? send(ctx, answerSave(await ctx.body(), s, row)) : missing(ctx); });
  route("DELETE", "/manage/admin/standard-answer/:id", (ctx, s) => { s.answers = s.answers.filter((r) => String(r.id) !== ctx.params.id); send(ctx, {}); });
  route("POST", "/manage/admin/standard-answer/category", async (ctx, s) => { const row = { ...(await ctx.body()), id: nextId(s.categories) }; s.categories.push(row); send(ctx, row); });
  route("PATCH", "/manage/admin/standard-answer/category/:id", async (ctx, s) => { const row = byId(s.categories, ctx.params.id); if (!row) return missing(ctx); Object.assign(row, await ctx.body()); for (const answer of s.answers) answer.categories = answer.categories.map((c) => c.id === row.id ? row : c); send(ctx, row); });

  for (const kind of ["built-in", "custom"]) route("POST", `/build/admin/apps/${kind}`, async (ctx, s) => {
    const b = scrub(await ctx.body()), descriptor = core.fixture("GET", "/build/admin/apps/built-in/options").find((d) => d.app_type === b.app_type);
    const row = { upstream_url_patterns: descriptor?.upstream_url_patterns || [], auth_template: descriptor?.auth_template || {},
      organization_credentials: {}, ...b, app_type: b.app_type ?? "CUSTOM", id: nextId(s.apps), enabled: true,
      credential_placeholder_keys: Object.keys(b.organization_credentials || {}), actions: (descriptor?.actions || []).map((a) => ({
        action_id: a.action_id, normalised_name: a.normalised_name, description: a.description, state: b.action_policies?.[a.action_id] ?? a.default_policy })),
      associated_skills: [], is_onyx_managed: false };
    s.apps.push(row); afterAppWrite(row, b); send(ctx, row);
  });
  route("PATCH", "/build/admin/apps/:id", async (ctx, s) => {
    const row = byId(s.apps, ctx.params.id); if (!row) return missing(ctx);
    const b = scrub(await ctx.body()); Object.assign(row, b);
    if (b.action_policies) for (const action of row.actions) action.state = b.action_policies[action.action_id] ?? action.state;
    afterAppWrite(row, b);
    send(ctx, row);
  });
  route("DELETE", "/build/admin/apps/:id", (ctx, s) => {
    composition.reconcileApps?.(s.apps);
    s.apps = s.apps.filter((r) => String(r.id) !== ctx.params.id);
    composition.reconcileApps?.(s.apps);
    send(ctx, {});
  });
  route("PUT", "/admin/enterprise-settings", async (ctx, s) => { Object.assign(s.enterprise, await ctx.body()); send(ctx, { ...core.fixture("GET", "/enterprise-settings"), ...s.enterprise }); });
  route("PUT", "/admin/enterprise-settings/custom-analytics-script", async (ctx, s) => { const b = await ctx.body(); s.customAnalytics = b.script ?? b.custom_analytics_script ?? null; send(ctx, { simulated: true }); });
  route("PUT", "/admin/banner", async (ctx, s) => { s.banner = { ...(await ctx.body()), updated_at: now() }; s.bannerDismissed = false; send(ctx, s.banner); });
  route("POST", "/admin/banner", async (ctx, s) => { s.banner = { ...(await ctx.body()), updated_at: now() }; s.bannerDismissed = false; send(ctx, s.banner); });
  route("DELETE", "/admin/banner", (ctx, s) => { s.banner = null; send(ctx, null); });

  route("POST", "/admin/usage-report", async (ctx, s) => { const b = await ctx.body(); const row = { report_name: `fictional-usage-${b.report_id}.csv`, requestor: defaults().hook_creator, time_created: now(), period_from: b.period_from, period_to: b.period_to }; s.reports.push(row); send(ctx, row); });
  const csv = (ctx) => ctx.send(200, defaults().export_csv, { "content-type": "text/csv", "content-disposition": "attachment; filename=fictional-usage.csv" });
  route("GET", "/admin/usage-report/:id", csv);
  route("POST", "/admin/query-history/start-export", async (ctx, s) => { const b = await ctx.body(), id = `fake-query-${s.exports.length + 1}`; const row = { task_id: id, request_id: id, status: "SUCCESS", start: ctx.query.start ?? b.start ?? now(), end: ctx.query.end ?? b.end ?? now(), time_created: now() }; s.exports.push(row); send(ctx, { request_id: id }); });
  route("GET", "/admin/query-history/export-status", (ctx) => send(ctx, { status: "SUCCESS" }));
  route("GET", "/admin/query-history/download", csv);
  route("POST", "/admin/log-export", (ctx, s) => { const id = (Object.keys(s.logs).length + 1).toString(16).padStart(32, "0"); s.logs[id] = { export_id: id, state: "ready", receipts: [{ worker_name: "fictional-worker", hostname: "workshop-demo", status: "no_logs_found", file_count: 0, size_bytes: 0, error: null }], pending_worker_names: [] }; send(ctx, { export_id: id }); });
  route("GET", "/admin/log-export/:id", (ctx, s) => s.logs[ctx.params.id] ? send(ctx, s.logs[ctx.params.id]) : missing(ctx));
  route("GET", "/admin/log-export/:id/download", (ctx, s) => {
    if (!s.logs[ctx.params.id]) return missing(ctx);
    // A genuine empty ZIP: the fictional workers reported no logs.
    ctx.send(200, Buffer.from("504b0506000000000000000000000000000000000000", "hex"),
      { "content-type": "application/zip", "content-disposition": "attachment; filename=fictional-no-logs.zip" });
  });
  route("GET", "/manage/connector", (ctx) => send(ctx,
    (core.fixture("GET", "/manage/admin/connector/status") || []).map(({ connector }) => connector)));
  route("POST", "/admin/search", async (ctx) => { await ctx.body(); send(ctx, { documents: [] }); });
  route("PUT", "/federated/6501", async (ctx, s) => { const b = await ctx.body(); Object.assign(s.federated, { config: b.config ?? s.federated.config, credentials: b.credentials ? scrub(b.credentials) : s.federated.credentials }); send(ctx, s.federated); });
  route("DELETE", "/federated/6501", (ctx, s) => { s.federated = null; send(ctx, {}); });
  route("POST", "/federated/sources/federated_slack/credentials/validate", simulatedTest);
  route("PUT", "/admin/enterprise-settings/logo", async (ctx, s) => {
    const chunks = [];
    for await (const chunk of ctx.req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctx.req.headers["content-type"] || "");
    const headerEnd = body.indexOf("\r\n\r\n");
    if (!boundary || headerEnd < 0) return ctx.send(400, { detail: "Choose a demo image file." });
    const end = body.indexOf(Buffer.from(`\r\n--${boundary[1] || boundary[2]}`), headerEnd + 4);
    const contentType = /Content-Type:\s*([^\r\n]+)/i.exec(body.subarray(0, headerEnd).toString())?.[1];
    if (end < 0 || !contentType?.startsWith("image/")) return ctx.send(400, { detail: "Choose a demo image file." });
    s.logo = { bytes: body.subarray(headerEnd + 4, end), contentType };
    s.enterprise.use_custom_logo = true; send(ctx, { simulated: true });
  });
  route("GET", "/enterprise-settings/logo", (ctx, s) => s.logo
    ? ctx.send(200, s.logo.bytes, { "content-type": s.logo.contentType }) : missing(ctx));
  const methods = (definition) => Object.entries(definition.paths || {}).flatMap(([path, operations]) =>
    Object.entries(operations).filter(([method]) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method))
      .map(([method, spec]) => ({ name: spec.operationId || `${method}_${path}`, summary: spec.summary || path,
        path, method, spec, custom_headers: [] })));
  route("POST", "/admin/tool/custom/validate", async (ctx) => {
    const body = await ctx.body(), value = methods(body.definition || {});
    if (!value.length) return ctx.send(400, { detail: "Add an OpenAPI path and operation." });
    send(ctx, { methods: value });
  });
  route("POST", "/admin/tool/custom", async (ctx, s) => {
    const b = scrub(await ctx.body()), row = { ...b, id: nextId(s.openapi), display_name: b.name,
      in_code_tool_id: null, enabled: true, chat_selectable: true, agent_creation_selectable: true,
      default_enabled: false, mcp_server_id: null, permissions: { manage: true, toggle: true, delete: true } };
    s.openapi.push(row); send(ctx, row);
  });
  route("PUT", "/admin/tool/custom/:id", async (ctx, s) => {
    const row = byId(s.openapi, ctx.params.id); if (!row) return missing(ctx);
    Object.assign(row, scrub(await ctx.body())); row.display_name = row.name; send(ctx, row);
  });
  route("DELETE", "/admin/tool/custom/:id", (ctx, s) => { s.openapi = s.openapi.filter((r) => String(r.id) !== ctx.params.id); send(ctx, {}); });
  route("PATCH", "/admin/tool/status", async (ctx, s) => {
    const b = await ctx.body();
    if (!b.tool_ids.every((id) => byId(s.openapi, id))) return false;
    for (const id of b.tool_ids) byId(s.openapi, id).enabled = b.enabled;
    send(ctx, { updated_count: b.tool_ids.length, tool_ids: b.tool_ids });
  });
  route("POST", "/admin/oauth-config/create", async (ctx, s) => {
    const b = scrub(await ctx.body()), row = { ...b, id: nextId(s.oauthConfigs), has_client_credentials: true,
      tool_count: 0, created_at: now(), updated_at: now() };
    s.oauthConfigs.push(row); send(ctx, row);
  });
  route("GET", "/admin/oauth-config/:id", (ctx, s) => { const row = byId(s.oauthConfigs, ctx.params.id); row ? send(ctx, row) : missing(ctx); });
  route("PUT", "/admin/oauth-config/:id", async (ctx, s) => { const row = byId(s.oauthConfigs, ctx.params.id); if (!row) return missing(ctx); Object.assign(row, scrub(await ctx.body()), { updated_at: now() }); send(ctx, row); });
  for (const [scope, field] of [["global", "globalLimits"], ["users", "userLimits"]]) {
    route("POST", `/admin/token-rate-limits/${scope}`, async (ctx, s) => {
      const body = await ctx.body();
      const row = { token_id: nextId([...s.globalLimits, ...s.userLimits], "token_id"), enabled: body.enabled,
        token_budget: body.token_budget ?? null, period_hours: body.period_hours, cost_budget_cents: body.cost_budget_cents ?? null };
      s[field].push(row); send(ctx, row);
    });
  }
  route("PUT", "/admin/token-rate-limits/rate-limit/:id", async (ctx, s) => {
    const row = byId([...s.globalLimits, ...s.userLimits], ctx.params.id, "token_id");
    if (!row) return false;
    Object.assign(row, await ctx.body()); send(ctx, row);
  });
  route("DELETE", "/admin/token-rate-limits/rate-limit/:id", (ctx, s) => {
    if (!byId([...s.globalLimits, ...s.userLimits], ctx.params.id, "token_id")) return false;
    s.globalLimits = s.globalLimits.filter((row) => String(row.token_id) !== ctx.params.id);
    s.userLimits = s.userLimits.filter((row) => String(row.token_id) !== ctx.params.id); send(ctx, {});
  });
  route("POST", "/license/upload", async (ctx, s) => {
    // Consume the selected/pasted fake file without retaining license text.
    for await (const _chunk of ctx.req) {}
    s.license = { ...core.fixture("GET", "/license"), has_license: true, issued_at: now(),
      status: "active", source: "manual_upload", expiry_warning_stage: "none" };
    delete s.license.__status; delete s.license.__body;
    send(ctx, { success: true, message: "Fictional license metadata updated for this run only." });
  });
  route("POST", "/license/refresh", (ctx, s) => {
    s.license = { ...s.license, last_refreshed_at: now() };
    send(ctx, { success: true, message: "Fictional license metadata refreshed; no license server contacted." });
  });
  route("POST", "/tenants/seats/update", async (ctx, s) => {
    if (!s.billing || "subscribed" in s.billing) return false;
    const { new_seat_count } = await ctx.body();
    const users = composition.listUsers();
    const activeCount = (rows) => rows.reduce((count, user) => count + (user.is_active ? 1 : 0), 0);
    const used_seats = activeCount(users.accepted) + activeCount(users.slack_users);
    s.billing.seats = new_seat_count;
    send(ctx, { success: true, current_seats: s.billing.seats, used_seats,
      message: "Fictional displayed seat count updated for this run; no billing provider contacted." });
  });
  route("POST", "/admin/billing/end-trial", async (ctx, s) => {
    if (s.billing?.status !== "trialing") return false;
    await ctx.body();
    s.billing.status = "active"; s.billing.trial_end = null;
    send(ctx, { success: true, stripe_subscription_id: "mock-only-display-65", status: s.billing.status });
  });
  route("POST", "/tenants/create-checkout-session", async (ctx, s) => {
    const { billing_period, seats } = await ctx.body();
    // Record only native plan choices; discard email/payment/account text.
    s.billingHandoffs.checkout = { billing_period, seats, response: "invalid-response", provider_contacted: false };
    await new Promise((resolve) => setTimeout(resolve, defaults().checkout_feedback_delay_ms));
    // The native Checkout guard renders this failure; never invent a Stripe URL.
    send(ctx, { stripe_checkout_url: "" });
  });
  route("POST", "/tenants/create-customer-portal-session", async (ctx, s) => {
    const body = await ctx.body();
    const returnUrl = new URL(body.return_url, "http://mockshop");
    s.billingHandoffs.portal = { request_keys: Object.keys(body).sort(), return_path: returnUrl.pathname + returnUrl.search,
      response_path: "/api/mockshop/admin-pages/billing-portal", provider_contacted: false };
    send(ctx, { stripe_customer_portal_url: s.billingHandoffs.portal.response_path });
  });
  route("GET", "/mockshop/admin-pages/billing-handoffs", (ctx, s) => send(ctx, s.billingHandoffs));
  // Approved explicit local boundary, matching the existing fake OAuth landing pattern.
  // GET is read-only: no portal session, charge, account or subscription mutation.
  route("GET", "/mockshop/admin-pages/billing-portal", (ctx, s) => ctx.send(200,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local fake billing portal handoff</title>
    <main><h1>LOCAL FAKE DEMO</h1>
    <p>LOCAL FAKE DEMO — billing portal handoff staged; no payment, Stripe session or live account changed</p>
    <p>${s.billingHandoffs.portal ? "Native Manage Plan POST received; same-origin handoff only." : "No native portal request has been staged."}</p>
    <p>Response field: stripe_customer_portal_url. Local destination: /api/mockshop/admin-pages/billing-portal.</p>
    <a href="/admin/billing">Back to native Billing</a></main></html>`,
    { "content-type": "text/html; charset=utf-8" }));
  route("POST", "/notifications/65065/dismiss", (ctx, s) => { s.bannerDismissed = true; send(ctx, {}); });

  const transform = {};
  // Opt-in Billing snapshots only; preserve the accepted baseline header response otherwise.
  transform["GET /tenants/billing-information"] = (value) => state().billing ?? value;
  transform["GET /admin/token-rate-limits/global"] = () => state().globalLimits;
  transform["GET /admin/token-rate-limits/users"] = () => state().userLimits;
  for (const [path, field] of [
    ["/admin/security", "security"], ["/admin/default-assistant/configuration", "assistant"], ["/admin/code-interpreter", "code"],
    ["/admin/web-search/search-providers", "webSearch"], ["/admin/web-search/content-providers", "webContent"], ["/admin/voice/providers", "voice"],
    ["/admin/tracing/providers", "tracing"], ["/admin/image-generation/config", "images"], ["/admin/api-key", "apiKeys"], ["/admin/sso/provider", "sso"],
    ["/admin/enterprise-settings/scim/token", "scim"], ["/search-settings/get-current-search-settings", "search"], ["/search-settings/get-secondary-search-settings", "secondary"],
    ["/admin/embedding/embedding-provider", "embedding"], ["/search-settings/unstructured-api-key-set", "unstructured"], ["/manage/admin/slack-app/channel", "channels"],
    ["/manage/admin/discord-bot/config", "discord"], ["/manage/admin/discord-bot/guilds", "guilds"], ["/admin/hooks", "hooks"],
    ["/manage/admin/standard-answer", "answers"], ["/manage/admin/standard-answer/category", "categories"], ["/build/admin/apps", "apps"],
    ["/admin/usage-report", "reports"], ["/admin/query-history/list", "exports"], ["/admin/banner", "banner"], ["/federated/6501", "federated"], ["/tool/openapi", "openapi"],
  ]) transform[`GET ${path}`] = () => state()[field];
  transform["GET /manage/admin/slack-app/bots"] = () => state().bots.map((bot) => botView(state(), bot));
  transform["GET /settings"] = (value) => {
    const configuration = defaults(), saved = state().settings;
    const settings = { ...value, ...configuration.settings, ...saved };
    const tier = configuration.billing_tiers?.[core.fixture("GET", "/mockshop/admin-pages/billing-case")];
    if (tier !== undefined && !Object.hasOwn(saved, "tier")) settings.tier = tier;
    return settings;
  };
  transform["GET /enterprise-settings"] = (value) => ({ ...value, ...state().enterprise });
  transform["GET /enterprise-settings/custom-analytics-script"] = (value) => {
    const saved = state().customAnalytics;
    const script = saved === undefined ? value : saved;
    // Native readers call response.json(); core otherwise sends strings as text.
    return typeof script === "string"
      ? { __status: 200, __body: JSON.stringify(script), __headers: { "content-type": "application/json" } }
      : script;
  };
  transform["GET /admin/llm/provider"] = (value) => ({ ...value, ...state().modelDefaults });
  transform["GET /llm/provider"] = (value) => ({ ...value, ...state().modelDefaults });
  transform["GET /tool"] = (value) => [...value.filter((tool) => !state().openapi.some((row) => row.id === tool.id)), ...state().openapi];
  transform["GET /license"] = (value) => value?.__status && !state().license ? value : {
    has_license: true, issued_at: null, grace_period_end: null, expiry_warning_stage: "none", plan_type: null,
    trial_end: null, ...value, ...state().license,
  };
  const announcement = () => state().banner ? {
    id: 65065, notif_type: "system_announcement", severity: state().banner.show_as_popup ? "warning" : "info",
    title: state().banner.title, description: state().banner.content, dismissed: state().bannerDismissed,
    first_shown: state().banner.updated_at, last_shown: state().banner.updated_at,
    additional_data: { show_as_popup: state().banner.show_as_popup },
  } : null;
  transform["GET /notifications"] = (value, ctx) => {
    const banner = announcement(); if (!banner) return value;
    const rows = Array.isArray(value) ? value : value.notifications || [];
    const notifications = [...rows, banner].filter((row) => !ctx.query.min_severity ||
      ["info", "warning", "error"].indexOf(row.severity) >= ["info", "warning", "error"].indexOf(ctx.query.min_severity));
    return { notifications, total_items: notifications.length, undismissed_count: notifications.filter((row) => !row.dismissed).length,
      page_num: Number(ctx.query.page_num || 0), page_size: Number(ctx.query.page_size || 20), has_more: false };
  };
  transform["GET /notifications/summary"] = (value) => announcement()
    ? { total_items: (value.total_items || 0) + 1, undismissed_count: (value.undismissed_count || 0) + (state().bannerDismissed ? 0 : 1) } : value;
  transform["GET /admin/chat-session-history"] = (value, ctx) => {
    const items = value.items.filter((r) =>
      (!ctx.query.feedback_type || ctx.query.feedback_type === "all" || r.feedback_type === ctx.query.feedback_type) &&
      (!ctx.query.start_time || new Date(r.time_created) >= new Date(ctx.query.start_time)) &&
      (!ctx.query.end_time || new Date(r.time_created) <= new Date(ctx.query.end_time)));
    const size = Number(ctx.query.page_size || 20), page = Number(ctx.query.page_num || 0);
    return { items: items.slice(page * size, (page + 1) * size), total_items: items.length };
  };
  const inRange = (date, ctx) => (!ctx.query.start || date.slice(0, 10) >= ctx.query.start.slice(0, 10)) &&
    (!ctx.query.end || date.slice(0, 10) <= ctx.query.end.slice(0, 10));
  for (const path of ["/admin/usage/export", "/admin/usage/system"]) transform[`GET ${path}`] = (value, ctx) => {
    const key = path.endsWith("export") ? "users" : "categories";
    return { ...value, start: ctx.query.start ?? value.start, end: ctx.query.end ?? value.end,
      [key]: value[key].map((row) => {
        const records = row.records.filter((record) => inRange(record.day, ctx));
        const totals = Object.fromEntries(Object.keys(row.totals).map((field) => [field, records.reduce((sum, record) => sum + (record[field] || 0), 0)]));
        return { ...row, records, totals };
      }).filter((row) => row.records.length) };
  };
  for (const path of ["/analytics/admin/query", "/analytics/admin/user", "/analytics/admin/onyxbot"]) {
    transform[`GET ${path}`] = (value, ctx) => value.filter((row) => inRange(row.date, ctx));
  }
  return { routes, transform, reset, apps };
}
