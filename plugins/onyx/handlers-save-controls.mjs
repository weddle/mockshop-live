// Native common writes only. No provider requests, OAuth, indexing execution or durable storage.
export default function createSaveControls(core) {
  const state = core.state;
  const reset = (body = {}) => { if (!body.keep) state.saveControls = {}; };
  reset();
  const clone = (value) => structuredClone(value);
  const data = () => {
    const key = state.org || "";
    if (state.saveControls[key]) return state.saveControls[key];
    const catalog = clone(core.fixture("GET", "/admin/llm/provider"));
    const indexing = clone(core.fixture("POST", "/manage/admin/connector/indexing-status") || []);
    const pairs = {};
    for (const group of indexing) for (const row of group.indexing_statuses) {
      const pair = core.fixture("GET", `/manage/admin/cc-pair/${row.cc_pair_id}`);
      if (pair?.connector) pairs[pair.id] = clone(pair);
    }
    const credentials = clone(core.fixture("GET", "/manage/admin/credential") || []);
    for (const pair of Object.values(pairs)) if (!credentials.some((c) => c.id === pair.credential.id)) credentials.push(clone(pair.credential));
    for (const pair of Object.values(pairs)) pair.credential = credentials.find((c) => c.id === pair.credential.id);
    return state.saveControls[key] = { catalog, indexing, pairs, credentials, seededPairs: new Set(Object.keys(pairs).map(Number)),
      connectors: Object.fromEntries(Object.values(pairs).map((p) => [p.connector.id, p.connector])),
      nextProvider: Math.max(0, ...catalog.providers.map((p) => p.id)) + 1,
      nextModel: Math.max(0, ...catalog.providers.flatMap((p) => p.model_configurations.map((m) => m.id))) + 1,
      nextConnector: Math.max(999, ...Object.values(pairs).map((p) => p.connector.id)) + 1,
      nextPair: Math.max(999, ...Object.values(pairs).map((p) => p.id)) + 1,
      nextCredential: Math.max(999, ...credentials.map((c) => c.id)) + 1, nextFile: 1000, uploads: {},
      indexingErrors: {}, targetedJobs: {}, nextTargetedJob: 1 };
  };
  // Shared with chat: call this at model resolution time; do not retain a fixture catalog snapshot. Chat resolves prepared answers'
  // models from the whole catalog, so it is not narrowed to the viewer.
  state.saveControlsProviderCatalog = () => publicCatalog(undefined, false);
  // The signed-in viewer's provider access: admins hold MANAGE_LLMS; group membership reads the live group members.
  const viewerAccess = () => {
    const me = core.fixture("GET", "/me") || {};
    const members = core.state.adminGroupMembers || {};
    const groups = new Set((core.fixture("GET", "/manage/admin/user-group") || [])
      .filter((group) => (members[group.id] ?? group.users ?? []).some((user) => user.id === me.id)).map((group) => group.id));
    return { manage: me.role === "admin", groups };
  };
  // backend/onyx/db/llm.py can_user_access_llm_provider: agent restrictions always apply (GET /llm/provider has no agent, so it
  // leaves agent-restricted providers out); a public provider is everyone's; a group-restricted one is its groups' members' and
  // MANAGE_LLMS holders'; one with neither groups nor agents is MANAGE_LLMS-only.
  const canAccess = (p, persona, access) => {
    const personas = p.personas || [], groups = p.groups || [];
    if (personas.length && !personas.includes(persona)) return false;
    if (p.is_public !== false) return true;
    if (groups.length) return access.manage || groups.some((id) => access.groups.has(id));
    return personas.length > 0 || access.manage;
  };
  const publicCatalog = (persona, forViewer = true) => {
    const catalog = data().catalog;
    const descriptors = core.fixture("GET", "/llm/provider")?.providers || [];
    const access = forViewer ? viewerAccess() : null;
    return { ...catalog, providers: catalog.providers.filter((p) => !forViewer || canAccess(p, persona, access)).map((p) => ({
      id: p.id, name: p.name, provider: p.provider,
      provider_display_name: descriptors.find((original) => original.id === p.id)?.provider_display_name || p.provider,
      model_configurations: p.model_configurations, next_model_configuration_offset: null,
    })) };
  };
  const fakeSecrets = (value = {}) => Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /token|password|secret|api_key|private_key|access_key|credentials|service_account/i.test(key) ? "mock-only-not-a-secret" : item]));
  // Only the native credential form's scalar metadata is consumed; uploaded key bytes are discarded.
  const credentialFileFields = (raw) => {
    const fields = Object.fromEntries([...raw.matchAll(/Content-Disposition: form-data; name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)]
      .map((match) => [match[1], match[2]]));
    const json = fakeSecrets(JSON.parse(fields.credential_json || "{}"));
    if (fields.field_key) json[fields.field_key] = "mock-only-not-a-secret";
    return { name: fields.name, source: fields.source, credential_json: json, admin_public: fields.admin_public === "true" };
  };
  const lite = (p) => ({ cc_pair_id: p.id, name: p.name, source: p.connector.source, access_type: p.access_type,
    cc_pair_status: p.status, in_progress: p.indexing, last_status: p.last_index_attempt_status,
    last_success: p.last_indexed, docs_indexed: p.num_docs_indexed, is_editable: true, permissions: p.permissions,
    in_repeated_error_state: false, latest_index_attempt_docs_indexed: 0 });
  const indexingRows = () => {
    const d = data();
    const groups = clone(d.indexing);
    for (const pair of Object.values(d.pairs)) {
      let group = groups.find((g) => g.source === pair.connector.source);
      if (!group) groups.push(group = { source: pair.connector.source, current_page: 1, total_pages: 1, indexing_statuses: [], summary: {} });
      const index = group.indexing_statuses.findIndex((r) => r.cc_pair_id === pair.id);
      if (index < 0) group.indexing_statuses.push(lite(pair)); else group.indexing_statuses[index] = { ...group.indexing_statuses[index], ...lite(pair) };
    }
    for (const group of groups) group.summary = { total_connectors: group.indexing_statuses.length,
      active_connectors: group.indexing_statuses.filter((p) => p.cc_pair_status === "ACTIVE").length,
      public_connectors: group.indexing_statuses.filter((p) => p.access_type === "public").length,
      total_docs_indexed: group.indexing_statuses.reduce((sum, p) => sum + p.docs_indexed, 0) };
    return groups;
  };
  // One current projection of the sole connector/pair state over the seeded admin status DTOs: keeps seeded extra
  // fields, overlays saved pair/connector/credential edits and appends new pairs. Untouched seeds read unchanged.
  const connectorRows = (seedRows = core.fixture("GET", "/manage/admin/connector/status") || []) => {
    const d = data(), seeded = new Set(seedRows.map((row) => row.cc_pair_id));
    const project = (pair, base = {}) => clone({ groups: [], has_successful_run: false, ...base, cc_pair_id: pair.id,
      name: pair.name ?? base.name, connector: { ...base.connector, ...pair.connector },
      credential: { ...base.credential, ...pair.credential }, access_type: pair.access_type ?? base.access_type,
      status: pair.status ?? base.status });
    return [...seedRows.map((row) => d.pairs[row.cc_pair_id] ? project(d.pairs[row.cc_pair_id], row) : clone(row)),
      ...Object.values(d.pairs).filter((p) => !seeded.has(p.id) && !d.seededPairs.has(p.id)).map((p) => project(p))];
  };
  // Current connectors: those of the projected rows plus saved connectors not yet bound to a pair.
  const connectorList = () => {
    const rows = connectorRows().map((row) => row.connector), ids = new Set(rows.map((c) => c.id));
    return [...rows, ...Object.values(data().connectors).filter((c) => !ids.has(c.id)).map(clone)];
  };
  // Error rows and queued requests belong to this same org store. No worker lands documents.
  const pairErrors = (id) => {
    const d = data();
    return d.indexingErrors[id] ||= clone(core.fixture("GET", `/manage/admin/cc-pair/${id}/errors`) || { items: [], total_items: 0 });
  };
  const bind = (connector, credential, body) => {
    const d = data();
    const existing = Object.values(d.pairs).find((p) => p.connector.id === connector.id && p.credential.id === credential.id);
    const seed = clone(core.fixture("GET", "/mockshop/save-controls"));
    const pair = { ...seed.pair, ...body, id: existing?.id ?? d.nextPair++, name: body.name || connector.name,
      connector, credential, access_type: body.access_type || connector.access_type, creator_email: core.fixture("GET", "/me").email };
    connector.credential_ids = [...new Set([...(connector.credential_ids || []), credential.id])];
    d.pairs[pair.id] = pair;
    return pair;
  };
  const providerError = (body, existing) => {
    if (!body.provider?.trim()) return "Provider is required";
    const models = body.model_configurations || existing?.model_configurations || [];
    if (!body.model && !models.some((m) => m.is_visible && m.name?.trim())) return "Model name is required";
    const keyRequired = ["openai", "anthropic", "azure", "openrouter", "litellm_proxy", "portkey", "vercel_ai_gateway", "nebius_tokenfactory"];
    const baseRequired = ["ollama_chat", "lm_studio", "openrouter", "litellm_proxy", "bifrost", "openai_compatible", "portkey", "vercel_ai_gateway", "nebius_tokenfactory"];
    if (keyRequired.includes(body.provider) && !(body.api_key ?? existing?.api_key)) return "API Key is required";
    if (baseRequired.includes(body.provider) && !(body.api_base ?? existing?.api_base)) return "API Base URL is required";
    return null;
  };
  return { reset, connectorRows, connectorList, providerRows: () => data().catalog.providers, routes: [
    { method: "GET", path: "/admin/llm/provider", handle(ctx) { ctx.send(200, data().catalog); } },
    { method: "GET", path: "/admin/llm/provider/:id", handle(ctx) {
      const provider = data().catalog.providers.find((p) => p.id === Number(ctx.params.id));
      ctx.send(provider ? 200 : 404, provider || { detail: "Fake provider not found" });
    } },
    { method: "GET", path: "/admin/llm/built-in/options/:provider", handle(ctx) {
      const fixture = core.fixture("GET", `/admin/llm/built-in/options/${ctx.params.provider}`);
      const models = clone(core.fixture("GET", "/mockshop/save-controls").provider_models);
      ctx.send(200, fixture || { name: ctx.params.provider, known_models: models, recommended_default_model: models[0] });
    } },
    { method: "POST", path: "/admin/llm/:provider/available-models", async handle(ctx) {
      const body = await ctx.body(), provider = ctx.params.provider;
      const supported = ["bedrock", "ollama", "openrouter", "lm-studio", "bifrost", "openai-compatible",
        "litellm", "nebius-tokenfactory", "vercel-ai-gateway", "portkey"];
      if (!supported.includes(provider)) return ctx.send(404, { detail: "No local model list for this provider" });
      if (provider === "bedrock" ? !body.aws_region_name : !body.api_base)
        return ctx.send(400, { detail: provider === "bedrock" ? "AWS region is required" : "API Base is required" });
      const fixture = core.fixture("POST", `/admin/llm/${provider}/available-models`);
      const models = clone(fixture || core.fixture("GET", "/mockshop/save-controls").provider_models);
      ctx.send(200, provider === "litellm" ? models.map((m) => ({ ...m, model_name: m.name })) : models);
    } },
    { method: "GET", path: "/llm/provider", handle(ctx) { ctx.send(200, publicCatalog()); } },
    { method: "GET", path: "/llm/persona/:id/providers", handle(ctx) { ctx.send(200, publicCatalog(Number(ctx.params.id))); } },
    { method: "POST", path: "/admin/llm/test", async handle(ctx) {
      const body = await ctx.body(), existing = data().catalog.providers.find((p) => p.id === body.id);
      const error = providerError(body, existing);
      ctx.send(error ? 400 : 200, error ? { detail: error } : { simulated: true, message: "Local fake configuration accepted; no connection tested." });
    } },
    { method: "PUT", path: "/admin/llm/provider", async handle(ctx) {
      const body = await ctx.body(), d = data();
      const existing = body.id == null ? null : d.catalog.providers.find((p) => p.id === body.id);
      if (body.id != null && !existing) return ctx.send(404, { detail: "Fake provider not found" });
      const error = providerError(body, existing);
      if (error) return ctx.send(400, { detail: error });
      const base = existing || { id: d.nextProvider++, groups: [], personas: [], is_public: true, is_auto_mode: false,
        api_base: null, api_version: null, custom_config: null, deployment_name: null, next_model_configuration_offset: null };
      const models = (body.model_configurations || existing?.model_configurations || []).map((m) => ({ ...m,
        id: existing && existing.model_configurations.some((old) => old.id === m.id) ? m.id : d.nextModel++,
        display_name: m.display_name || m.custom_display_name || m.name }));
      const provider = { ...base, ...body, id: base.id, name: body.name || body.provider,
        api_key: body.api_key === undefined ? base.api_key ?? null : body.api_key ? "mock-only-not-a-secret" : null,
        custom_config: body.custom_config ? fakeSecrets(body.custom_config) : base.custom_config,
        model_configurations: models };
      if (existing) d.catalog.providers[d.catalog.providers.indexOf(existing)] = provider; else d.catalog.providers.push(provider);
      ctx.send(200, provider);
    } },
    // Native Delete: a default provider needs ?force=true (sent only for the last provider); defaults naming it are cleared.
    { method: "DELETE", path: "/admin/llm/provider/:id", handle(ctx) {
      const catalog = data().catalog, id = Number(ctx.params.id), index = catalog.providers.findIndex((p) => p.id === id);
      if (index < 0) return ctx.send(404, { detail: "Fake provider not found" });
      if (catalog.default_text?.provider_id === id && ctx.query.force !== "true")
        return ctx.send(400, { detail: "Cannot delete the default provider" });
      catalog.providers.splice(index, 1);
      for (const key of ["default_text", "default_vision", "default_chat_naming", "default_craft"])
        if (catalog[key]?.provider_id === id) catalog[key] = null;
      ctx.send(200, null);
    } },
    { method: "POST", path: "/admin/llm/default", async handle(ctx) {
      const body = await ctx.body(), catalog = data().catalog;
      if (!catalog.providers.some((p) => p.id === body.provider_id && p.model_configurations.some((m) => m.name === body.model_name)))
        return ctx.send(400, { detail: "Select an available model" });
      catalog.default_text = body; ctx.send(200, null);
    } },
    { method: "GET", path: "/connector/oauth/details/:source", handle(ctx) {
      const fixture = core.fixture("GET", `/connector/oauth/details/${ctx.params.source}`);
      const simulated = core.fixture("GET", "/mockshop/save-controls").oauth_sources.includes(ctx.params.source);
      ctx.send(200, { additional_kwargs: [], ...fixture, supports_manual_credentials: true,
        oauth_enabled: simulated, mock_simulation: simulated });
    } },
    { method: "GET", path: "/connector/oauth/authorize/:source", handle(ctx) {
      const source = encodeURIComponent(ctx.params.source);
      const requested = ctx.query.desired_return_url || `/admin/connectors/${source}`;
      const destination = requested.startsWith("/admin/") && !requested.includes("\\") ? requested : `/admin/connectors/${source}`;
      ctx.send(200, { redirect_url: `/api/mockshop/save-controls/oauth/${source}?return=${encodeURIComponent(destination)}` });
    } },
    { method: "GET", path: "/mockshop/save-controls/oauth/:source", handle(ctx) {
      const source = encodeURIComponent(ctx.params.source);
      const destination = encodeURIComponent(ctx.query.return || `/admin/connectors/${source}`);
      ctx.send(200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local fake connector account</title>
        <main style="font:16px system-ui;max-width:680px;margin:64px auto"><h1>Local fake connector account</h1>
        <p>This is an explicitly simulated Mockshop account. No OAuth, login, credentials, permission grants or external requests occur.</p>
        <form method="post" action="/api/mockshop/save-controls/oauth/${source}?return=${destination}">
        <button type="submit">Stage local fake account</button></form></main></html>`, { "content-type": "text/html; charset=utf-8" });
    } },
    { method: "POST", path: "/mockshop/save-controls/oauth/:source", handle(ctx) {
      const d = data(), source = ctx.params.source;
      const seed = d.credentials.find((c) => c.source === source);
      const credential = { ...clone(seed || {}), id: d.nextCredential++, source, name: "Local fake account (simulated; no authentication)",
        credential_json: { authentication_method: "oauth_interactive" }, admin_public: true,
        user_email: core.fixture("GET", "/me").email, time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.credentials.push(credential);
      const requested = ctx.query.return || `/admin/connectors/${encodeURIComponent(source)}`;
      ctx.send(303, "", { location: requested.startsWith("/admin/") && !requested.includes("\\") ? requested : "/admin/connectors" });
    } },
    { method: "GET", path: "/manage/admin/credential", handle(ctx) { ctx.send(200, data().credentials); } },
    { method: "GET", path: "/manage/admin/similar-credentials/:source", handle(ctx) { ctx.send(200, data().credentials.filter((c) => c.source === ctx.params.source)); } },
    { method: "POST", path: "/manage/credential/private-key", async handle(ctx) {
      const { _raw: raw = "" } = await ctx.body(), body = credentialFileFields(raw), d = data();
      if (!body.source) return ctx.send(400, { detail: "Credential source is required" });
      const credential = { ...body, id: d.nextCredential++, user_email: core.fixture("GET", "/me").email,
        time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.credentials.push(credential); ctx.send(200, credential);
    } },
    { method: "PUT", path: "/manage/admin/credential/private-key/:id", async handle(ctx) {
      const credential = data().credentials.find((c) => c.id === Number(ctx.params.id));
      if (!credential) return ctx.send(404, { detail: "Fake credential not found" });
      const { _raw: raw = "" } = await ctx.body(), body = credentialFileFields(raw);
      Object.assign(credential, { name: body.name ?? credential.name,
        credential_json: { ...credential.credential_json, ...body.credential_json }, time_updated: new Date().toISOString() });
      ctx.send(200, credential);
    } },
    { method: "PUT", path: "/manage/admin/credential/swap", async handle(ctx) {
      const body = await ctx.body(), d = data();
      const pair = Object.values(d.pairs).find((p) => p.connector.id === body.connector_id);
      const credential = d.credentials.find((c) => c.id === body.new_credential_id);
      if (!pair || !credential) return ctx.send(404, { detail: "Fake connector or credential not found" });
      pair.credential = credential; pair.connector.credential_ids = [credential.id];
      pair.access_type = body.access_type; ctx.send(200, null);
    } },
    { method: "POST", path: "/manage/credential", async handle(ctx) {
      const body = await ctx.body(), d = data();
      const credential = { ...body, id: d.nextCredential++, credential_json: fakeSecrets(body.credential_json),
        user_email: core.fixture("GET", "/me").email, time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.credentials.push(credential); ctx.send(200, credential);
    } },
    { method: "PUT", path: "/manage/admin/credential/:id", async handle(ctx) {
      const body = await ctx.body(), credential = data().credentials.find((c) => c.id === Number(ctx.params.id));
      if (!credential) return ctx.send(404, { detail: "Fake credential not found" });
      Object.assign(credential, body, { credential_json: { ...credential.credential_json, ...fakeSecrets(body.credential_json) } }); ctx.send(200, credential);
    } },
    // Metadata-only fake uploads: bytes are discarded, never indexed or saved to disk.
    { method: "POST", path: "/manage/admin/connector/file/upload", async handle(ctx) {
      const body = await ctx.body(), d = data();
      const names = [...(body._raw || "").matchAll(/filename="([^"]+)"/g)].map((match) => match[1].split(/[\\/]/).at(-1));
      if (!names.length) return ctx.send(400, { detail: "Select a file to stage" });
      const files = names.map((name) => {
        const id = `mockshop-file-${d.nextFile++}`;
        return d.uploads[id] = { file_id: id, file_name: name, upload_date: new Date().toISOString() };
      });
      ctx.send(200, { file_paths: files.map((f) => f.file_id), file_names: files.map((f) => f.file_name), zip_metadata_file_id: null });
    } },
    { method: "GET", path: "/manage/admin/connector/:id/files", handle(ctx) {
      const d = data(), connector = d.connectors[ctx.params.id];
      if (!connector) return false;
      const config = connector.connector_specific_config;
      ctx.send(200, { files: (config.file_locations || []).map((id, index) => d.uploads[id] || {
        file_id: id, file_name: config.file_names?.[index] || id }) });
    } },
    { method: "POST", path: "/manage/admin/connector/:id/files/update", async handle(ctx) {
      const d = data(), connector = d.connectors[ctx.params.id];
      if (!connector) return false;
      const { _raw: raw = "" } = await ctx.body();
      const removedField = raw.match(/name="file_ids_to_remove"\r?\n\r?\n([^\r\n]*)/);
      const removed = removedField ? JSON.parse(removedField[1]) : [];
      const config = connector.connector_specific_config;
      const files = (config.file_locations || []).map((id, index) =>
        d.uploads[id] || { file_id: id, file_name: config.file_names?.[index] || id }).filter((file) => !removed.includes(file.file_id));
      for (const match of raw.matchAll(/filename="([^"]+)"/g)) {
        const id = `mockshop-file-${d.nextFile++}`;
        const file = { file_id: id, file_name: match[1].split(/[\\/]/).at(-1), upload_date: new Date().toISOString() };
        d.uploads[id] = file; files.push(file);
      }
      config.file_locations = files.map((f) => f.file_id); config.file_names = files.map((f) => f.file_name);
      ctx.send(200, { success: true, simulated: true });
    } },
    { method: "POST", path: "/manage/admin/connector/run-once", async handle(ctx) {
      const body = await ctx.body(), d = data(), pairs = Object.values(d.pairs);
      if (!Array.isArray(body.credentialIds) || !body.credentialIds.length || typeof body.from_beginning !== "boolean")
        return ctx.send(400, { detail: "Connector, credential IDs and indexing mode are required" });
      const selected = body.credentialIds.map((id) => pairs.find((p) => p.connector.id === body.connector_id && p.credential.id === id));
      if (selected.some((p) => !p)) return ctx.send(404, { detail: "Fake connector and credential pair not found" });
      if (selected.some((p) => p.indexing)) return ctx.send(409, { detail: "Cannot re-index while indexing is already in progress" });
      if (selected.some((p) => p.status === "PAUSED" || p.status === "INVALID"))
        return ctx.send(409, { detail: "Resume or fix the connector before re-indexing" });
      for (const pair of selected) {
        pair.indexing = true;
        const seeded = d.seededPairs.has(pair.id);
        pair.last_index_attempt_status = seeded ? "not_started" : "in_progress";
        pair.latest_checkpoint_description = seeded
          ? `Local fake ${body.from_beginning ? "complete re-index" : "indexing update"} request staged; no indexing process runs.`
          : "Local fake upload staged; no indexing process runs.";
      }
      // Existing document counts, attempt history and unresolved errors remain untouched.
      ctx.send(200, { success: true, simulated: true });
    } },
    { method: "GET", path: "/manage/admin/connector", handle(ctx) { ctx.send(200, Object.values(data().connectors).filter((c) => !ctx.query.credential || c.credential_ids.includes(Number(ctx.query.credential)))); } },
    { method: "GET", path: "/manage/connector", handle(ctx) { ctx.send(200, Object.values(data().connectors)); } },
    { method: "POST", path: "/manage/admin/connector", async handle(ctx) {
      const body = await ctx.body(), d = data();
      if (!body.name?.trim() || !body.source || !body.connector_specific_config)
        return ctx.send(400, { detail: "Connector name, source and configuration are required" });
      const connector = { ...body, id: d.nextConnector++, credential_ids: [], time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.connectors[connector.id] = connector;
      ctx.send(200, connector);
    } },
    { method: "PATCH", path: "/manage/admin/connector/:id", async handle(ctx) {
      const connector = data().connectors[ctx.params.id];
      if (!connector) return ctx.send(404, { detail: "Fake connector not found" });
      Object.assign(connector, await ctx.body()); ctx.send(200, connector);
    } },
    { method: "PUT", path: "/manage/connector/:connector/credential/:credential", async handle(ctx) {
      const d = data(), connector = d.connectors[ctx.params.connector];
      let credential = d.credentials.find((c) => c.id === Number(ctx.params.credential));
      if (connector && !credential && ctx.params.credential === "0") {
        credential = { id: 0, source: connector.source, name: "Local fake upload account (no authentication)",
          credential_json: {}, admin_public: true, user_email: core.fixture("GET", "/me").email };
        d.credentials.push(credential);
      }
      if (!connector || !credential) return ctx.send(404, { detail: "Fake connector or credential not found" });
      const pair = bind(connector, credential, await ctx.body()); ctx.send(200, { success: true, cc_pair_id: pair.id });
    } },
    { method: "POST", path: "/manage/admin/connector-with-mock-credential", async handle(ctx) {
      const body = await ctx.body(), d = data();
      if (!body.name?.trim() || !body.source || !body.connector_specific_config)
        return ctx.send(400, { detail: "Connector name, source and configuration are required" });
      const connector = { ...body, id: d.nextConnector++, credential_ids: [], time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.connectors[connector.id] = connector;
      const credential = { id: d.nextCredential++, source: body.source, name: "Local fake simulation (no authentication)",
        credential_json: {}, admin_public: true, user_email: core.fixture("GET", "/me").email };
      d.credentials.push(credential);
      bind(connector, credential, body);
      ctx.send(200, connector);
    } },
    // The Add Connector form's Create: one request makes the connector and pairs it with a saved account or a new one.
    { method: "POST", path: "/manage/admin/connector-with-credential", async handle(ctx) {
      const body = await ctx.body(), d = data(), spec = body.connector || {};
      if (!spec.name?.trim() || !spec.source || !spec.connector_specific_config)
        return ctx.send(400, { detail: "Connector name, source and configuration are required" });
      let credential = body.credential_id != null ? d.credentials.find((c) => c.id === Number(body.credential_id)) : null;
      if (body.credential_id != null && !credential)
        return ctx.send(404, { error_code: "CREDENTIAL_NOT_FOUND", detail: "Fake credential not found" });
      if (!credential) {
        credential = { id: d.nextCredential++, source: spec.source, name: body.name || `${spec.name} account`, credential_json: fakeSecrets(body.credential_json),
          admin_public: true, user_email: core.fixture("GET", "/me").email, time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
        d.credentials.push(credential);
      }
      const connector = { ...spec, id: d.nextConnector++, credential_ids: [], time_created: new Date().toISOString(), time_updated: new Date().toISOString() };
      d.connectors[connector.id] = connector;
      const pair = bind(connector, credential, body.pairing || {});
      ctx.send(200, { success: true, cc_pair_id: pair.id, connector_id: connector.id, credential_id: credential.id });
    } },
    { method: "GET", path: "/manage/admin/cc-pair/:id", handle(ctx) {
      const pair = data().pairs[ctx.params.id];
      if (!pair) return ctx.send(404, { detail: "Fake connector not found" });
      ctx.send(200, pair);
    } },
    { method: "GET", path: "/manage/admin/cc-pair/:id/errors", handle(ctx) {
      if (!data().pairs[ctx.params.id]) return ctx.send(404, { detail: "Fake connector not found" });
      const errors = pairErrors(ctx.params.id);
      const items = ctx.query.include_resolved === "false" ? errors.items.filter((e) => !e.is_resolved) : errors.items;
      const page = Math.max(0, Number(ctx.query.page_num) || 0), size = Math.max(1, Number(ctx.query.page_size) || 10);
      ctx.send(200, { items: items.slice(page * size, (page + 1) * size), total_items: items.length });
    } },
    { method: "POST", path: "/manage/admin/indexing/targeted-reindex", async handle(ctx) {
      const body = await ctx.body(), d = data();
      if (!Array.isArray(body.error_ids) || !body.error_ids.length || body.error_ids.length > 100)
        return ctx.send(400, { detail: "Provide between 1 and 100 existing indexing error IDs" });
      const errors = Object.keys(d.pairs).flatMap((id) => pairErrors(id).items);
      const selected = [...new Set(body.error_ids)].map((id) => errors.find((e) => e.id === id));
      if (selected.some((e) => !e)) return ctx.send(404, { detail: "Fake indexing error not found" });
      if (selected.some((e) => !d.pairs[e.connector_credential_pair_id]?.supports_targeted_reindex))
        return ctx.send(400, { detail: "This connector does not support targeted reindex" });
      const queued = selected.filter((e) => !e.is_resolved), skipped = selected.length - queued.length;
      const id = d.nextTargetedJob++;
      d.targetedJobs[id] = { id, status: "not_started", requested_at: new Date().toISOString(), completed_at: null,
        target_count: queued.length, resolved_count: 0, still_failing_count: queued.length, skipped_count: skipped, resolved_summary: [] };
      // Submit-only native outcome: rows stay Unresolved, no completed job/document is fabricated.
      ctx.send(200, { targeted_reindex_job_id: id, queued_count: queued.length, skipped_count: skipped });
    } },
    { method: "GET", path: "/manage/admin/indexing/targeted-reindex/:id", handle(ctx) {
      const job = data().targetedJobs[ctx.params.id];
      ctx.send(job ? 200 : 404, job || { detail: "Fake targeted reindex request not found" });
    } },
    { method: "PUT", path: "/manage/admin/cc-pair/:id/status", async handle(ctx) {
      const pair = data().pairs[ctx.params.id], body = await ctx.body();
      if (!pair) return ctx.send(404, { detail: "Fake connector not found" });
      if (!["ACTIVE", "PAUSED"].includes(body.status))
        return ctx.send(400, { detail: "Connector status must be ACTIVE or PAUSED" });
      if (pair.status === "DELETING") return ctx.send(400, { detail: "Connector deletion is already scheduled" });
      pair.status = body.status;
      ctx.send(200, null);
    } },
    { method: "POST", path: "/manage/admin/deletion-attempt", async handle(ctx) {
      const body = await ctx.body();
      const pair = Object.values(data().pairs).find((p) => p.connector.id === body.connector_id && p.credential.id === body.credential_id);
      if (!pair) return ctx.send(404, { detail: "Fake connector not found" });
      if (!["PAUSED", "INVALID"].includes(pair.status))
        return ctx.send(400, { detail: "Pause the connector before deleting" });
      // Scheduling is visible immediately; no job runs and indexed documents remain intact.
      pair.status = "DELETING";
      pair.latest_deletion_attempt = { connector_id: body.connector_id, credential_id: body.credential_id, status: "PENDING" };
      ctx.send(200, null);
    } },
    { method: "PUT", path: "/manage/admin/cc-pair/:id/name", handle(ctx) {
      const pair = data().pairs[ctx.params.id];
      if (!pair) return ctx.send(404, { detail: "Fake connector not found" });
      if (!ctx.query.new_name?.trim()) return ctx.send(400, { detail: "Connector name is required" });
      pair.name = ctx.query.new_name; pair.connector.name = pair.name; ctx.send(200, null);
    } },
    { method: "PUT", path: "/manage/admin/cc-pair/:id/property", async handle(ctx) {
      const pair = data().pairs[ctx.params.id], body = await ctx.body();
      if (!pair) return ctx.send(404, { detail: "Fake connector not found" });
      const field = { refresh_frequency: "refresh_freq", pruning_frequency: "prune_freq" }[body.name];
      const value = Number(body.value);
      if (!field) return ctx.send(400, { detail: "Unknown editable connector property" });
      if (!Number.isFinite(value) || (field === "refresh_freq" ? value < 60 || value % 60 !== 0 : value < 0.083 * 3600))
        return ctx.send(400, { detail: field === "refresh_freq" ? "Property value must be greater than or equal to 1 minute" : "Property value must be greater than or equal to 0.083 hours (5 minutes)" });
      pair.connector[field] = value;
      ctx.send(200, null);
    } },
    { method: "POST", path: "/manage/admin/connector/indexing-status", async handle(ctx) {
      const body = await ctx.body();
      ctx.send(200, indexingRows().filter((g) => !body.source || g.source === body.source).map((g) => ({ ...g,
        indexing_statuses: g.indexing_statuses.filter((r) => !body.name_filter || r.name.toLowerCase().includes(body.name_filter.toLowerCase())) })));
    } },
  ], transform: {
    "GET /manage/connector-status": (value) => {
      const d = data();
      return [...value.map((row) => {
        const pair = d.pairs[row.cc_pair_id];
        return pair ? { ...row, status: pair.status } : row;
      }), ...Object.values(d.pairs).filter((p) => !d.seededPairs.has(p.id))
        .map((p) => ({ cc_pair_id: p.id, source: p.connector.source, status: p.status, has_successful_run: false }))];
    },
    "GET /manage/admin/connector/status": (value) => connectorRows(value),
  } };
}
