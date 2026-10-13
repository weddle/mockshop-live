// Onyx is the boundary between shared content and the pinned frontend's DTOs.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { loadContent } from "../../core/content.mjs";
import { builtEdition } from "../../core/build.mjs";
import { check } from "../../core/validate.mjs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const vendors = new Set(["confluence", "notion", "google_drive", "github", "slack", "jira", "zendesk", "file", "web", "salesforce", "zoom", "sharepoint", "gmail"]);
const labels = { confluence: "Confluence", notion: "Notion", google_drive: "Google Drive", github: "GitHub", slack: "Slack", jira: "Jira", zendesk: "Zendesk", file: "Files", web: "Web", salesforce: "Salesforce", zoom: "Zoom", sharepoint: "SharePoint", gmail: "Gmail" };
const own = (v, k) => Object.hasOwn(v, k);
const entries = (v) => Object.entries(v || {});
const digest = (v) => createHash("sha256").update(v).digest("hex");
const uuid = (kind, key) => { const h = digest(`onyx:${kind}:${key}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fileKey = (key) => /^[\w.-]+$/.test(key) && key !== "." && key !== "..";
function fail(field, message, script) {
  const origins = script?._resolved?.contentOrigins || {};
  let key = field.replace(/\[(\d+)\]/g, ".$1");
  while (key && !origins[key]) key = key.replace(/\.?[^.]+$/, "");
  const origin = script?.steps?.find((step) => field.startsWith(`steps.${step.id}.`))?.origin || origins[key] || {};
  const file = origin.file || script?._resolved?.file || script?._resolved?.source || "Onyx content";
  const line = origin.line || 1;
  const error = new Error(`${file}:${line} ${field}: ${message}`);
  error.errors = [{ file, line, field, message }];
  throw error;
}
function ids(script) {
  const used = new Map();
  return (kind, key, explicit) => {
    const id = explicit ?? (parseInt(digest(`onyx:${kind}:${key}`).slice(0, 8), 16) % 2000000000 + 1000);
    if (!Number.isSafeInteger(id) || id < 0) fail(`apps.onyx.${kind}.${key}.id`, "expected a non-negative safe integer", script);
    const identity = `${kind}:${id}`;
    if (used.has(identity) && used.get(identity) !== key) fail(`apps.onyx.${kind}.${key}.id`, `ID ${id} collides with ${used.get(identity)}`, script);
    used.set(identity, key);
    return id;
  };
}
function readRoutes(dir, inputs) {
  if (!fs.existsSync(dir)) return {};
  const routes = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = path.join(dir, name), bytes = fs.readFileSync(file);
    inputs.push({ file, hash: digest(bytes) });
    const doc = YAML.parse(bytes.toString("utf8"), { merge: true, maxAliasCount: -1 });
    for (const [key, value] of entries(doc)) if (/^(GET|POST|PUT|PATCH|DELETE|ANY) \/\S*$/.test(key)) routes[key] = value;
  }
  return routes;
}
function urlFor(vendor, key, domain) {
  const host = domain || "workspace.example";
  const part = encodeURIComponent(key);
  if (vendor === "file") return null;
  const paths = { confluence: `/wiki/spaces/KNOWLEDGE/pages/${part}`, notion: `/${part}`, github: `/knowledge/blob/main/${part}`, slack: `/archives/knowledge/${part}`, google_drive: `/document/d/${part}/edit`, jira: `/browse/${part}`, zendesk: `/hc/articles/${part}`, sharepoint: `/sites/knowledge/${part}` };
  return `https://${vendor.replaceAll("_", "-")}.${host}${paths[vendor] || `/documents/${part}`}`;
}
function checkUrl(url, vendor, field, script, expectedVendor) {
  if (url == null) return;
  let parsed;
  try { parsed = new URL(url); } catch { fail(field, "expected an absolute http(s) URL", script); }
  if (!["https:", "http:"].includes(parsed.protocol)) fail(field, "only http(s) URLs are supported", script);
  if (expectedVendor && expectedVendor !== vendor) fail(field, `explicit URL/configuration belongs to ${expectedVendor}, but source vendor is ${vendor}; remove or replace the explicit value`, script);
  const host = parsed.hostname, p = parsed.pathname;
  const inferred = /notion\./.test(host) ? "notion" : /slack\./.test(host) ? "slack" : /github\./.test(host) ? "github" : /docs\.google\./.test(host) ? "google_drive" : /\/wiki(?:\/|$)/.test(p) ? "confluence" : /\/browse\//.test(p) ? "jira" : null;
  if (inferred && inferred !== vendor) fail(field, `URL identifies ${inferred}, not ${vendor}; remove it to derive a ${vendor} URL`, script);
}
function writeYaml(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false })); }
function validateApp(app, script) {
  const file = fileURLToPath(new URL("./world.schema.json", import.meta.url));
  const bytes = fs.readFileSync(file), schema = JSON.parse(bytes);
  const errors = check(schema, app);
  if (errors.length) fail(`apps.onyx.${errors[0].path}`, errors[0].message, script);
  for (const route of Object.keys(app.fixtures || {})) if (!/^(GET|POST|PUT|PATCH|DELETE|ANY) \/\S*$/.test(route)) fail(`apps.onyx.fixtures.${route}`, "expected an Onyx fixture route key", script);
  return { file, hash: digest(bytes) };
}

function materialize(content, { m, script, outputDir, overlays = script.overlays || [] }) {
  const app = content.apps?.onyx || {};
  const schemaInput = validateApp(app, script);
  const number = ids(script);
  const inputs = [schemaInput];
  const routes = readRoutes(path.join(m.fixturesDir, "base"), inputs);
  const edition = m.editions?.[builtEdition(m) || m.edition]?.fixtures;
  for (const overlay of new Set([...(edition ? [edition] : []), ...overlays])) {
    if (!/^edition-[\w-]+$/.test(overlay)) fail("overlays", `fictional overlay ${overlay} must be explicit world/content data`, script);
    Object.assign(routes, readRoutes(path.join(m.fixturesDir, overlay), inputs));
  }
  Object.assign(routes, structuredClone(app.fixtures || {}));
  for (const field of ["people", "teams", "sources", "documents", "conversations"]) for (const key of Object.keys(app[field] || {})) {
    if (!own(content[field] || {}, key)) fail(`apps.onyx.${field}.${key}`, `unknown shared ${field} key`, script);
  }
  const people = content.people || {}, sourceMap = {}, docMap = {}, agentMap = {}, conversationMap = {};
  const viewerKey = app.viewer ?? Object.keys(people)[0];
  if (viewerKey && !own(people, viewerKey)) fail("apps.onyx.viewer", `unknown person ${viewerKey}`, script);
  const personMap = new Map(), personIds = new Map();
  for (const [key, person] of entries(people)) {
    const id = app.people?.[key]?.id || uuid("people", key);
    if (personIds.has(id)) fail(`apps.onyx.people.${key}.id`, `ID ${id} collides with ${personIds.get(id)}`, script);
    personIds.set(id, key);
    personMap.set(key, { id, email: person.email || `${key}@${content.company?.domain || "workspace.example"}`, name: person.name });
  }
  const personDto = (key) => {
    if (!personMap.has(key)) fail(`people.${key}`, "unknown person", script);
    return personMap.get(key);
  };
  const user = routes["GET /me"] || {};
  if (viewerKey && !user.__status) {
    const p = people[viewerKey], view = personDto(viewerKey);
    routes["GET /me"] = { ...user, id: view.id, email: view.email, personalization: { ...user.personalization, name: p.name, role: p.title || "" } };
  }
  routes["GET /settings"] = { ...routes["GET /settings"], company_name: content.company?.name || null, company_description: content.company?.description || null, ...app.settings };
  if (routes["GET /enterprise-settings"] && !routes["GET /enterprise-settings"].__status && content.company?.name) routes["GET /enterprise-settings"].application_name = content.company.name;
  if (!own(app.fixtures || {}, "GET /users")) routes["GET /users"] = Object.keys(people).map(personDto);
  if (!own(app.fixtures || {}, "GET /manage/users")) routes["GET /manage/users"] = { accepted: Object.keys(people).map(personDto), invited: [], slack_users: [], accepted_pages: Object.keys(people).length ? 1 : 0, invited_pages: 0, slack_users_pages: 0 };
  if (!own(app.fixtures || {}, "GET /manage/users/accepted/all")) routes["GET /manage/users/accepted/all"] = Object.keys(people).map((key) => ({
    ...personDto(key), personal_name: people[key].name, account_type: "STANDARD", is_admin: key === viewerKey,
    is_active: true, password_configured: true, is_scim_synced: false, craft_enabled: false,
    created_at: "{{ago:30d}}", updated_at: "{{ago:1d}}", last_active: "{{ago:1h}}", groups: [],
  }));
  const teams = [];
  for (const [key, team] of entries(content.teams)) {
    const mapping = app.teams?.[key] || {}, id = number("teams", key, mapping.id);
    const seed = routes["GET /manage/admin/user-group"]?.find((group) => group.id === id) || {};
    const row = { id, cc_pairs: [], document_sets: [], personas: [], is_up_to_date: true, is_up_for_deletion: false,
      is_default: false, incognito_enabled: false, permissions: { manage: true, manage_members: true, delete: true, edit_permissions: true, edit_token_limits: true },
      ...seed, name: team.name, users: (team.members || []).map((person) => ({ id: personDto(person).id, email: personDto(person).email })),
      manager_ids: mapping.managers ? mapping.managers.map((person) => personDto(person).id) : seed.manager_ids || [] };
    teams.push(row);
  }
  if (teams.length) {
    routes["GET /manage/admin/user-group"] = teams;
    routes["GET /manage/user-groups/minimal"] = teams.map(({ id, name }) => ({ id, name }));
    const groupSeeds = routes["GET /mockshop/admin-groups/seeds"];
    groupSeeds.groups = teams.map((team) => ({ cc_pair_ids: [], document_set_ids: [], agent_ids: [], enabled_permissions: [], token_limits: [],
      ...groupSeeds.groups.find((group) => group.id === team.id), id: team.id, name: team.name, manager_ids: team.manager_ids }));
    groupSeeds.resource_permissions = teams[0].permissions;
  }

  for (const [key, source] of entries(content.sources)) {
    if (!vendors.has(source.vendor)) {
      if (own(app.sources || {}, key)) fail(`sources.${key}.vendor`, `unsupported Onyx source vendor ${source.vendor}`, script);
      // Unused background sources remain portable. Any requested document/screen rejects below.
      sourceMap[key] = { unsupported: true, source };
      continue;
    }
    const mapping = app.sources?.[key] || {};
    const id = number("sources", key, mapping.id), connectorId = number("connectors", key, mapping.connector_id), credentialId = number("credentials", key, mapping.credential_id);
    checkUrl(source.url, source.vendor, `sources.${key}.url`, script, mapping.url_vendor);
    const label = mapping.name || `${labels[source.vendor]} – ${source.name}`;
    const docCount = Object.values(content.documents || {}).filter((d) => d.source === key).length;
    const baseUrl = source.url || urlFor(source.vendor, key, content.company?.domain);
    const defaults = { confluence: { wiki_base: baseUrl, space: "KNOWLEDGE", is_cloud: true }, notion: { root_page_id: key }, google_drive: { shared_drive_urls: [baseUrl], include_shared_drives: true }, github: { repo_owner: content.company?.domain?.split(".")[0] || "workspace", repositories: key }, slack: { workspace: content.company?.domain || "workspace", channels: [key] }, jira: { jira_base_url: baseUrl ? new URL(baseUrl).origin : "", project_key: key }, sharepoint: { site_url: baseUrl } };
    const config = mapping.config || mapping.config_by_vendor?.[source.vendor] || defaults[source.vendor] || {};
    if (Object.keys(config).length && mapping.config_vendor && mapping.config_vendor !== source.vendor) fail(`apps.onyx.sources.${key}.config`, `configuration belongs to ${mapping.config_vendor}; replace it for ${source.vendor}`, script);
    const checkConfig = (value, field) => {
      if (typeof value === "string" && /^https?:\/\//.test(value)) checkUrl(value, source.vendor, field, script);
      else if (value && typeof value === "object") for (const [part, child] of entries(value)) checkConfig(child, `${field}.${part}`);
    };
    checkConfig(config, `apps.onyx.sources.${key}.config`);
    const credential = { id: credentialId, credential_json: {}, admin_public: true, source: source.vendor, name: `${source.name} account`, user_id: null, user_email: routes["GET /me"]?.email, time_created: "{{ago:120d}}", time_updated: "{{ago:3d}}", groups: [], ...(mapping.credential_by_vendor?.[source.vendor] || {}), ...mapping.credential };
    credential.id = credentialId; credential.source = source.vendor;
    const connector = { id: connectorId, name: label, source: source.vendor, input_type: "poll", connector_specific_config: config, refresh_freq: 1800, prune_freq: 86400, indexing_start: null, access_type: "public", credential_ids: [credentialId], time_created: "{{ago:120d}}", time_updated: "{{ago:3d}}", ...mapping.connector };
    Object.assign(connector, { id: connectorId, name: label, source: source.vendor, credential_ids: [credentialId], connector_specific_config: config });
    const detail = { id, name: label, creator: routes["GET /me"]?.id, creator_email: routes["GET /me"]?.email, status: "ACTIVE", in_repeated_error_state: false, latest_deletion_attempt: null, access_type: connector.access_type, is_editable_for_current_user: true, permissions: { operate: true, edit: true, delete: true, publish: true }, deletion_failure_message: null, indexing: false, last_pruned: null, overall_indexing_speed: null, supports_targeted_reindex: false, groups: [], auto_sync_options: null, processing_mode: "REGULAR", indexing_hold: null, latest_checkpoint_description: null, last_full_permission_sync: null, last_permission_sync_attempt_status: null, permission_syncing: false, last_permission_sync_attempt_finished: null, last_permission_sync_attempt_error_message: null, num_docs_indexed: docCount, number_of_index_attempts: 0, last_index_attempt_status: "success", last_indexed: "{{ago:1h}}", ...mapping.detail, connector, credential };
    Object.assign(detail, { id, name: label, connector, credential });
    const row = { cc_pair_id: id, name: label, source: source.vendor, access_type: detail.access_type, in_progress: detail.indexing, cc_pair_status: detail.status, last_finished_status: "success", last_status: detail.last_index_attempt_status, is_editable: true, permissions: detail.permissions, in_repeated_error_state: false, last_success: detail.last_indexed, docs_indexed: detail.num_docs_indexed, latest_index_attempt_docs_indexed: 0, ...mapping.row };
    Object.assign(row, { cc_pair_id: id, name: label, source: source.vendor });
    sourceMap[key] = { id, key, source, connector, credential, detail, row, visible: mapping.visible !== false };
    routes[`GET /manage/admin/cc-pair/${id}`] = detail;
    for (const [suffix, field] of [["index-attempts", "attempts"], ["errors", "errors"], ["permission-sync-attempts", "permission_sync"], ["external-group-sync-attempts", "group_sync"]]) routes[`GET /manage/admin/cc-pair/${id}/${suffix}`] = mapping[field] || { applicable: false, total_items: 0, items: [] };
  }
  const connectorRows = Object.values(sourceMap).filter((s) => !s.unsupported);
  const groups = new Map();
  for (const { row } of connectorRows) { if (!groups.has(row.source)) groups.set(row.source, []); groups.get(row.source).push(row); }
  routes["POST /manage/admin/connector/indexing-status"] = [...groups].map(([source, rows]) => ({ source, summary: { total_connectors: rows.length, active_connectors: rows.filter((r) => r.cc_pair_status === "ACTIVE").length, public_connectors: rows.filter((r) => r.access_type === "public").length, total_docs_indexed: rows.reduce((n, r) => n + r.docs_indexed, 0) }, current_page: 1, total_pages: 1, indexing_statuses: rows }));
  routes["GET /manage/connector-status"] = connectorRows.filter((s) => s.visible).map(({ id, row }) => ({ cc_pair_id: id, has_successful_run: true, source: row.source, status: row.cc_pair_status }));
  routes["GET /manage/admin/credential"] = connectorRows.map((s) => s.credential);
  for (const vendor of groups.keys()) routes[`GET /manage/admin/similar-credentials/${vendor}`] = connectorRows.filter((s) => s.row.source === vendor).map((s) => s.credential);
  routes["GET /mockshop/world-screen"] = { hidden_connectors: connectorRows.filter((s) => !s.visible).map((s) => s.id) };
  const connectorSeeds = routes["GET /manage/admin/connector/status"] || [];
  routes["GET /manage/admin/connector/status"] = connectorRows.map((source) => ({
    cc_pair_id: source.id, name: source.row.name, connector: source.connector, credential: source.credential, groups: [],
    status: source.detail.status, access_type: source.detail.access_type, has_successful_run: true,
    ...connectorSeeds.find((seed) => seed.cc_pair_id === source.id),
  }));

  for (const [key, doc] of entries(content.documents)) {
    const source = content.sources?.[doc.source];
    if (!source || !sourceMap[doc.source]) fail(`documents.${key}.source`, `missing source ${doc.source}`, script);
    if (sourceMap[doc.source].unsupported) continue;
    const mapping = app.documents?.[key] || {};
    const id = mapping.id || `DOC-${digest(`onyx:documents:${key}`).slice(0, 20)}`;
    if (!fileKey(id)) fail(`apps.onyx.documents.${key}.id`, "document ID must be a safe filename", script);
    if (Object.values(docMap).some((d) => d.id === id)) fail(`apps.onyx.documents.${key}.id`, `duplicate document ID ${id}`, script);
    checkUrl(doc.url, source.vendor, `documents.${key}.url`, script, mapping.url_vendor);
    docMap[key] = { ...mapping, id, title: doc.title, source: source.vendor, link: doc.url || urlFor(source.vendor, key, content.company?.domain), blurb: mapping.blurb ?? doc.body?.slice(0, 240) ?? "", owners: (doc.owners || (doc.author ? [doc.author] : [])).map((p) => personDto(p).email), content: doc.body || "" };
    delete docMap[key].url_vendor;
    fs.mkdirSync(path.join(outputDir, "sources"), { recursive: true });
    fs.writeFileSync(path.join(outputDir, "sources", `${id}.md`), doc.body || docMap[key].blurb);
  }
  if (!own(app.fixtures || {}, "GET /mockshop/user-search-seed")) routes["GET /mockshop/user-search-seed"].documents = Object.values(docMap).map((doc) => ({ ...doc, tags: [], document_sets: [], updated: doc.updated || "{{ago:1d}}" }));
  const docsById = new Map(Object.values(docMap).map((doc) => [doc.id, doc]));
  const pairsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.id, s]));
  const connectorsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.connector.id, s]));
  const credentialsById = new Map(Object.values(sourceMap).filter((s) => !s.unsupported).map((s) => [s.credential.id, s]));
  const agentsById = new Map();
  // Feature seed DTOs may embed compact document/connector snapshots. Project those
  // from the same canonical entities rather than leaving stale vendor/name copies.
  const project = (value) => {
    if (Array.isArray(value)) return value.map(project);
    if (!plain(value)) return value;
    const out = Object.fromEntries(entries(value).map(([key, v]) => [key, project(v)]));
    const doc = docsById.get(value.id || value.document_id);
    if (doc && (own(value, "source") || own(value, "source_type"))) {
      for (const field of ["title", "link", "owners", "content"]) if (own(out, field)) out[field] = doc[field] ?? out[field];
      if (own(out, "source")) out.source = doc.source;
      if (own(out, "source_type")) out.source_type = doc.source;
      if (own(out, "semantic_identifier")) out.semantic_identifier = doc.title;
    }
    const pair = pairsById.get(value.cc_pair_id);
    if (pair) {
      if (own(out, "name")) out.name = pair.row.name;
      if (own(out, "source")) out.source = pair.row.source;
      if (out.connector) out.connector = { ...out.connector, ...pair.connector };
      if (out.credential) out.credential = { ...out.credential, ...pair.credential };
    }
    const connector = connectorsById.get(value.id);
    if (connector && (own(value, "connector_specific_config") || own(value, "credential_ids"))) Object.assign(out, connector.connector);
    const credential = credentialsById.get(value.id);
    if (credential && own(value, "credential_json")) Object.assign(out, credential.credential);
    const personKey = personIds.get(value.id), person = personKey && personMap.get(personKey);
    if (person && own(out, "email")) {
      out.email = person.email;
      for (const field of ["name", "personal_name"]) if (own(out, field)) out[field] = person.name;
    }
    const agent = agentsById.get(value.id);
    if (agent && (own(value, "builtin_persona") || own(value, "knowledge_sources"))) {
      for (const field of ["name", "description", "knowledge_sources"]) if (own(out, field)) out[field] = agent[field];
    }
    return out;
  };
  const reply = (value, field) => {
    if (!plain(value) || typeof value.text !== "string") fail(field, "reply requires text", script);
    if (value.queries != null && (!Array.isArray(value.queries) || value.queries.some((q) => typeof q !== "string"))) fail(`${field}.queries`, "expected a string list", script);
    const cites = value.cites || [];
    if (!Array.isArray(cites)) fail(`${field}.cites`, "expected document keys", script);
    const documents = cites.map((key) => { if (!docMap[key]) fail(`${field}.cites`, `unknown document or unsupported source for ${key}`, script); return docMap[key]; });
    for (const match of value.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g)) for (const n of match[1].split(/\s*,\s*/).map(Number)) if (n < 1 || n > documents.length) fail(`${field}.text`, `citation [${n}] has no entry in cites`, script);
    const { text, cites: ignored, ...rest } = value;
    return project({ ...rest, answer: text, documents, citations: Object.fromEntries(documents.map((d, i) => [i + 1, d.id])) });
  };
  for (const [key, value] of entries(app.replies)) {
    if (!fileKey(key)) fail(`apps.onyx.replies.${key}`, "reply key must be a safe filename", script);
    writeYaml(path.join(outputDir, "chat", `${key}.yaml`), reply(value, `apps.onyx.replies.${key}`));
  }
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
  const sessions = [];
  for (const [key, conversation] of entries(content.conversations)) {
    const mapping = app.conversations?.[key] || {};
    const id = mapping.id || uuid("conversations", key);
    if (!fileKey(id) || Object.values(conversationMap).includes(id)) fail(`apps.onyx.conversations.${key}.id`, "unsafe or duplicate conversation ID", script);
    conversationMap[key] = id;
    const { agent, turns: explicitTurns, ...meta } = mapping;
    if (agent != null && !own(agentMap, agent)) fail(`apps.onyx.conversations.${key}.agent`, `unknown agent ${agent}`, script);
    sessions.push({ id, name: conversation.title, persona_id: agent == null ? 0 : agentMap[agent], time_created: "{{ago:1d}}", time_updated: "{{ago:1d}}", shared_status: "private", current_alternate_model: null, current_temperature_override: null, current_reasoning_effort_override: null, ...meta });
    const turns = [];
    for (const message of conversation.messages || []) {
      if (message.role === "user") turns.push({ message: message.text });
      else if (message.role === "assistant") {
        if (!turns.length || turns.at(-1).script) fail(`conversations.${key}.messages`, "assistant message must follow one user message", script);
        turns.at(-1).script = reply({ text: message.text, cites: message.documents || [] }, `conversations.${key}.messages`);
      } else fail(`conversations.${key}.messages`, `Onyx chat does not support role ${message.role}`, script);
    }
    writeYaml(path.join(outputDir, "history", `${id}.yaml`), { turns: project(explicitTurns || turns) });
  }
  routes["GET /mockshop/conversation-catalog"] = { sessions };
  if (Object.keys(content.conversations || {}).length && !own(app.fixtures || {}, "GET /chat/get-user-chat-sessions")) routes["GET /chat/get-user-chat-sessions"] = { has_more: false, sessions };
  for (const [id, history] of entries(app.history)) {
    if (!fileKey(id)) fail(`apps.onyx.history.${id}`, "unsafe history ID", script);
    writeYaml(path.join(outputDir, "history", `${id}.yaml`), project(history));
  }
  for (const [id, body] of entries(app.source_bodies)) {
    if (!fileKey(id) || typeof body !== "string") fail(`apps.onyx.source_bodies.${id}`, "expected safe source ID and text body", script);
    fs.mkdirSync(path.join(outputDir, "sources"), { recursive: true }); fs.writeFileSync(path.join(outputDir, "sources", `${id}.md`), body);
  }
  const compiledRoutes = project(routes);
  writeYaml(path.join(outputDir, "00-world.yaml"), compiledRoutes);
  return { routes: compiledRoutes, sourceMap, docMap, agentMap, conversationMap, reply, content, inputs };
}

export function compile(content, { m, script, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const current = materialize(content, { m, script, outputDir });
  let active = current;
  const steps = [], inputs = [...current.inputs], origins = {}, snapshots = new Map();
  const editionOverlay = m.editions?.[builtEdition(m) || m.edition]?.fixtures;
  const authoredEditions = (values) => values.filter((value) => value !== editionOverlay);
  const overlay = (dir) => path.relative(m.fixturesDir, dir).split(path.sep).join("/");
  const add = (step, suffix, operation) => { const { send, state, ...metadata } = step; steps.push({ ...metadata, ...(state?.cursor !== undefined && metadata.cursor === undefined ? { cursor: state.cursor } : {}), id: `${step.id}--${suffix}`, author_id: step.author_id || step.id, ...operation }); };
  const checkLocator = (value, field) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\/admin\/connector\/([a-z_]+)\/(\d+)(?=[/?#"' ]|$)/g)) {
        const source = Object.values(active.sourceMap).find((s) => !s.unsupported && (s.id === Number(match[2]) || s.connector.id === Number(match[2])));
        if (source && source.row.source !== match[1]) fail(field, `explicit connector locator uses ${match[1]}, but source ${source.source.name} now uses ${source.row.source}; update the locator`, script);
      }
      for (const source of Object.values(active.sourceMap).filter((s) => !s.unsupported)) for (const [vendor, label] of entries(labels)) {
        if (vendor !== source.row.source && [" – ", " — ", " - "].some((separator) => value.includes(`${label}${separator}${source.source.name}`)))
          fail(field, `explicit ${label} label for source ${source.key} conflicts with ${source.row.source}; update the locator`, script);
      }
    } else if (value && typeof value === "object") for (const [key, child] of entries(value)) checkLocator(child, `${field}.${key}`);
  };
  for (const step of script.steps || []) {
    for (const field of ["goto", "click", "wait", "wait_gone", "hover", "focus", "scroll"]) if (own(step, field)) checkLocator(step[field], `steps.${step.id}.${field}`);
    if (step.send !== undefined) {
      const send = step.send;
      if (!plain(send) || typeof send.text !== "string") fail(`steps.${step.id}.send`, "expected {text, reply}", script);
      for (const key of Object.keys(send)) if (!["text", "reply", "wait"].includes(key)) fail(`steps.${step.id}.send.${key}`, "unsupported send option", script);
      const preparedReply = { ...active.reply(send.reply, `steps.${step.id}.send.reply`), turn: step.author_id || step.id, question: send.text };
      // The turn is available only in the world active at this exact point in the script.
      writeYaml(path.join(active.outputDir || outputDir, "chat", `turn-${digest(preparedReply.turn).slice(0, 24)}.yaml`), preparedReply);
      add(step, "arm", { state: { keep: true, resetChats: false, turn: preparedReply.turn } });
      add(step, "focus", { click: { selector: "#onyx-chat-input-textbox" } });
      add(step, "type", { type: { selector: "#onyx-chat-input-textbox", value: send.text } });
      add(step, "submit", { click: { selector: "#onyx-chat-input-send-button" } });
      // The last completed message may be the previous reply. Check the newest message wrapper instead;
      // live wrappers use optimistic IDs until reload, not the backend's persistent message ID.
      add(step, "complete", { eval: `(async () => { const until = Date.now() + 60000; while (Date.now() < until) { const r = await fetch('/api/mockshop/turn/' + ${JSON.stringify(encodeURIComponent(preparedReply.turn))}); if (!r.ok) throw new Error('Prepared reply status is unavailable'); const value = await r.json(); const latest = Array.from(document.querySelectorAll('[id^="message-"]')).at(-1); if (value.status === 'complete' && latest?.querySelector('[data-testid="onyx-ai-message"]')) return; if (value.status === 'stopped') throw new Error('Prepared reply was interrupted'); await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Prepared reply did not finish rendering'); })()` });
      if (send.wait) add(step, "answer", { wait: send.wait });
      continue;
    }
    if (!step.state) { steps.push(step); continue; }
    const state = step.state;
    if (state.world) {
      for (const key of Object.keys(state)) if (!["world", "overlays", "keep", "resetChats", "cursor"].includes(key))
        fail(`steps.${step.id}.state.${key}`, "put screen controls in a separate step after the whole-world switch", script);
      const declaring = step.origin?.file || script._resolved?.file || script._resolved?.source;
      if (!declaring) fail(`steps.${step.id}.state.world`, "source file is required for relative world paths", script);
      const world = path.resolve(path.dirname(declaring), state.world);
      const loaded = loadContent(world);
      const selectedOverlays = state.overlays || script.overlays || [];
      const signature = digest(JSON.stringify({ world, inputs: loaded.inputs, editionOverlay, overlays: authoredEditions(selectedOverlays) })).slice(0, 16);
      const isInitialWorld = isDeepStrictEqual(loaded.content, content) && isDeepStrictEqual(authoredEditions(selectedOverlays), authoredEditions(script.overlays || []));
      const target = isInitialWorld ? outputDir : path.join(outputDir, `world-${signature}`);
      if (isInitialWorld) active = current;
      else {
        if (!snapshots.has(signature)) snapshots.set(signature, { ...materialize(loaded.content, { m, script: { ...script, overlays: selectedOverlays, _resolved: { ...script._resolved, contentOrigins: loaded.origins } }, outputDir: target }), outputDir: target });
        active = snapshots.get(signature);
      }
      inputs.push(...loaded.inputs, ...active.inputs); Object.assign(origins, loaded.origins);
      const { world: ignored, ...rest } = state;
      steps.push({ ...step, state: { ...rest, overlays: [overlay(target)], keep: state.keep ?? true, resetChats: state.resetChats ?? false } });
      continue;
    }
    const keys = ["sidebar", "connectors", "agent", "model"].filter((key) => own(state, key));
    const allowed = new Set([...keys, "overlays", "keep", "resetChats", "turn", "screen", "cursor"]);
    for (const key of Object.keys(state)) if (!allowed.has(key)) fail(`steps.${step.id}.state.${key}`, "unsupported Onyx screen state", script);
    if (!keys.length) { steps.push(step); continue; }
    for (const key of ["overlays", "turn", "screen"]) if (own(state, key))
      fail(`steps.${step.id}.state.${key}`, "do not mix raw runtime controls with keyed screen selections", script);
    const screen = {};
    for (const [field, catalog, select] of [["sidebar", active.conversationMap, (v) => v], ["connectors", active.sourceMap, (v) => v.unsupported ? null : v.id]]) if (own(state, field)) {
      if (!Array.isArray(state[field])) fail(`steps.${step.id}.state.${field}`, "expected an ordered list of entity keys", script);
      screen[field] = state[field].map((key) => { if (!own(catalog, key) || select(catalog[key]) == null) fail(`steps.${step.id}.state.${field}`, `unsupported or missing entity ${key}`, script); return select(catalog[key]); });
      if (new Set(screen[field]).size !== screen[field].length) fail(`steps.${step.id}.state.${field}`, "duplicate screen items", script);
    }
    if (own(state, "agent")) {
      if (state.agent !== null && !own(active.agentMap, state.agent)) fail(`steps.${step.id}.state.agent`, `unknown agent ${state.agent}`, script);
      screen.agent = state.agent === null ? 0 : active.agentMap[state.agent];
    }
    if (own(state, "model")) {
      const name = active.content.apps?.onyx?.models?.[state.model]?.name || state.model;
      if (name === null) screen.model = null;
      else {
        const provider = active.routes["GET /admin/llm/provider"]?.providers?.find((p) => p.model_configurations.some((v) => v.name === name && v.is_visible !== false));
        const model = provider?.model_configurations.find((v) => v.name === name && v.is_visible !== false);
        if (!model) fail(`steps.${step.id}.state.model`, `unknown or hidden model ${state.model}`, script);
        screen.model = `${provider.name}__${provider.provider}__${model.name}__mc:${model.id}`;
      }
    }
    add(step, "state", { state: { keep: state.keep ?? true, resetChats: state.resetChats ?? false, screen } });
    const agentQuery = own(screen, "agent") ? `u.searchParams.set('agentId', ${JSON.stringify(String(screen.agent))});` : "";
    add(step, "refresh", { eval: `(() => { const u = new URL(location.href); ${agentQuery} document.documentElement.dataset.mockshopReloading = 'true'; location.replace(u.href); })()` });
    add(step, "unloaded", { wait_gone: { selector: 'html[data-mockshop-reloading="true"]', timeout: 30000 } });
    add(step, "ready", { wait: { selector: "body", timeout: 30000 } });
  }
  return { overlays: [overlay(outputDir)], steps, inputs, origins };
}
