// Connectors: shared sources -> connectors, credentials, cc-pairs, indexing status and per-pair routes. apps.onyx.cc_pairs and
// apps.onyx.index_runs (adapter/index-runs.mjs) set a pair's state and its runs; a pair with neither keeps the neutral "indexed" summary.
import { rejectUnderived, vendors, labels, own, entries, fail, urlFor, checkUrl } from "./shared.mjs";
import { derivePair, statusCounts } from "./index-runs.mjs";

export const sections = ["connectors"];

export function derive(ctx) {
  rejectUnderived(ctx.app, sections, ctx.script);
  const { content, app, script, routes, number, sourceMap } = ctx;
  for (const field of ["cc_pairs", "index_runs"]) for (const key of Object.keys(app[field] || {})) {
    if (!own(content.sources || {}, key)) fail(`apps.onyx.${field}.${key}`, "unknown shared sources key", script);
    if (!vendors.has(content.sources[key].vendor)) fail(`apps.onyx.${field}.${key}`, `unsupported Onyx source vendor ${content.sources[key].vendor}`, script);
  }
  const fleetRuns = [];
  for (const [key, source] of entries(content.sources)) {
    if (!vendors.has(source.vendor)) {
      if (own(app.sources || {}, key)) fail(`sources.${key}.vendor`, `unsupported Onyx source vendor ${source.vendor}`, script);
      // Unused background sources remain portable. Any requested document/screen rejects below.
      sourceMap[key] = { unsupported: true, source };
      continue;
    }
    const mapping = app.sources?.[key] || {};
    const pairSpec = app.cc_pairs?.[key];
    if (pairSpec?.id !== undefined && mapping.id !== undefined && pairSpec.id !== mapping.id) fail(`apps.onyx.cc_pairs.${key}.id`, `differs from apps.onyx.sources.${key}.id`, script);
    const id = number("sources", key, mapping.id ?? pairSpec?.id), connectorId = number("connectors", key, mapping.connector_id), credentialId = number("credentials", key, mapping.credential_id);
    checkUrl(source.url, source.vendor, `sources.${key}.url`, script, mapping.url_vendor);
    const label = mapping.name || `${labels[source.vendor]} – ${source.name}`;
    const docCount = Object.values(content.documents || {}).filter((d) => d.source === key).length;
    const runSpecs = app.index_runs?.[key];
    const pair = pairSpec !== undefined || runSpecs !== undefined ? derivePair({ key, pair: pairSpec, runs: runSpecs, script, number, defaultDocs: docCount }) : null;
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
    Object.assign(credential, { user_personal_name: null, is_owner: true, usages: [{ cc_pair_id: id, cc_pair_name: label, connector_id: connectorId }], ...mapping.credential }); // v5.0.0-beta.2 Credential fields
    const connector = { id: connectorId, name: label, source: source.vendor, input_type: "poll", connector_specific_config: config, refresh_freq: 1800, prune_freq: 86400, check_freq: null, indexing_start: null, access_type: "public", credential_ids: [credentialId], time_created: "{{ago:120d}}", time_updated: "{{ago:3d}}", ...mapping.connector };
    Object.assign(connector, { id: connectorId, name: label, source: source.vendor, credential_ids: [credentialId], connector_specific_config: config });
    if (pairSpec?.access_type) connector.access_type = pairSpec.access_type;
    // A pair created recently was set up with its connector and account at that time.
    if (pairSpec?.created) connector.time_created = connector.time_updated = credential.time_created = credential.time_updated = `{{ago:${Math.round(pair.createdAgo)}s}}`;
    const detail = { id, name: label, creator: routes["GET /me"]?.id, creator_email: routes["GET /me"]?.email, status: "ACTIVE", in_repeated_error_state: false, latest_deletion_attempt: null, access_type: connector.access_type, is_editable_for_current_user: true, permissions: { operate: true, edit: true, delete: true, publish: true }, deletion_failure_message: null, indexing: false, last_pruned: null, overall_indexing_speed: null, supports_targeted_reindex: false, groups: [], auto_sync_options: null, processing_mode: "REGULAR", indexing_hold: null, latest_checkpoint_description: null, last_full_permission_sync: null, last_permission_sync_attempt_status: null, permission_syncing: false, last_permission_sync_attempt_finished: null, last_permission_sync_attempt_error_message: null, num_docs_indexed: docCount, number_of_index_attempts: 0, last_index_attempt_status: "success", last_indexed: "{{ago:1h}}", ...mapping.detail, connector, credential };
    Object.assign(detail, { id, name: label, connector, credential, pending_backfills: [], has_named_checks: false, ...mapping.detail }); // v5.0.0-beta.2 CCPairFullInfo fields
    // CCPairFullInfo from the authored pair: overall_indexing_speed is documents per minute since the connector was created.
    if (pair) Object.assign(detail, { status: pair.status, in_repeated_error_state: pair.repeated, indexing: pair.running, num_docs_indexed: pair.docs,
      number_of_index_attempts: pair.derived.length, last_index_attempt_status: pair.latest?.status ?? null, last_indexed: pair.lastSuccess,
      overall_indexing_speed: pair.speed, ...Object.fromEntries(["indexing_hold", "pending_backfills", "has_named_checks"].filter((f) => own(pairSpec || {}, f)).map((f) => [f, pairSpec[f]])),
      ...mapping.detail });
    const row = { cc_pair_id: id, name: label, source: source.vendor, access_type: detail.access_type, in_progress: detail.indexing, cc_pair_status: detail.status, last_finished_status: "success", last_status: detail.last_index_attempt_status, is_editable: true, permissions: detail.permissions, in_repeated_error_state: false, last_success: detail.last_indexed, docs_indexed: detail.num_docs_indexed, latest_index_attempt_docs_indexed: 0, ...mapping.row };
    Object.assign(row, { cc_pair_id: id, name: label, source: source.vendor });
    if (pair) Object.assign(row, { last_finished_status: pair.derived.find(({ attempt }) => attempt.time_finished !== null)?.attempt.status ?? null,
      latest_index_attempt_docs_indexed: pair.latest?.total_docs_indexed ?? 0, in_repeated_error_state: pair.repeated, ...mapping.row });
    const visible = mapping.visible !== false;
    sourceMap[key] = { id, key, source, connector, credential, detail, row, pair, visible };
    routes[`GET /manage/admin/cc-pair/${id}`] = detail;
    if (pair && mapping.attempts) fail(`apps.onyx.sources.${key}.attempts`, `derived from apps.onyx.index_runs.${key}; remove one`, script);
    for (const [suffix, field] of [["index-attempts", "attempts"], ["errors", "errors"], ["permission-sync-attempts", "permission_sync"], ["external-group-sync-attempts", "group_sync"]]) routes[`GET /manage/admin/cc-pair/${id}/${suffix}`] = mapping[field] || { applicable: false, total_items: 0, items: [] };
    if (pair) {
      // Newest first; handlers-index-monitoring.mjs applies the runs, throughput and overview query parameters per request.
      const runs = pair.derived.map(({ run }) => run);
      routes[`GET /manage/admin/cc-pair/${id}/index-attempts`] = { items: runs.map((run) => run.attempt), total_items: runs.length };
      routes[`GET /manage/admin/cc-pair/${id}/runs`] = { items: runs, total_items: runs.length,
        kinds: connector.prune_freq ? ["indexing", "pruning"] : ["indexing"], status_counts: statusCounts(runs) };
      for (const { attempt, stages } of pair.derived) routes[`GET /manage/admin/index-attempt/${attempt.id}/stage-metrics`] = { index_attempt_id: attempt.id, stages: stages || [] };
      const ref = { id, name: label, source: source.vendor, can_resolve: detail.supports_targeted_reindex && detail.permissions.operate, can_resolve_runs: detail.permissions.operate };
      if (visible) for (const { createdAgo, run } of pair.derived) fleetRuns.push({ createdAgo, item: { cc_pair: ref, run } });
    }
  }
  const connectorRows = Object.values(sourceMap).filter((s) => !s.unsupported);
  const groups = new Map();
  for (const { row } of connectorRows) { if (!groups.has(row.source)) groups.set(row.source, []); groups.get(row.source).push(row); }
  routes["POST /manage/admin/connector/indexing-status"] = [...groups].map(([source, rows]) => ({ source, summary: { total_connectors: rows.length, active_connectors: rows.filter((r) => r.cc_pair_status === "ACTIVE").length, public_connectors: rows.filter((r) => r.access_type === "public").length, total_docs_indexed: rows.reduce((n, r) => n + r.docs_indexed, 0) }, current_page: 1, total_pages: 1, indexing_statuses: rows }));
  routes["GET /manage/connector-status"] = connectorRows.filter((s) => s.visible).map(({ id, row, pair }) => ({ cc_pair_id: id, has_successful_run: pair ? pair.hasSuccess : true, source: row.source, status: row.cc_pair_status }));
  routes["GET /manage/admin/credential"] = connectorRows.map((s) => s.credential);
  for (const vendor of groups.keys()) routes[`GET /manage/admin/similar-credentials/${vendor}`] = connectorRows.filter((s) => s.row.source === vendor).map((s) => s.credential);
  // Indexing status page list (beta.2): one row per visible pair, derived from the same rows as the other connector routes. A queued
  // attempt's place in line counts every pair's queued attempts by age (_queue_positions).
  const queued = connectorRows.flatMap(({ id, pair }) => (pair?.derived || []).filter(({ attempt }) => attempt.status === "not_started").map(({ createdAgo }) => ({ id, createdAgo })))
    .sort((a, b) => b.createdAgo - a.createdAgo);
  const positions = new Map();
  queued.forEach(({ id }, index) => { if (!positions.has(id)) positions.set(id, index + 1); });
  const statusRows = connectorRows.filter((s) => s.visible).map(({ id, row, detail, pair }) => ({
    cc_pair_id: id, name: row.name, source: row.source, access_type: detail.access_type, cc_pair_status: detail.status, status: pair ? pair.bucket : "indexed",
    creator_email: detail.creator_email ?? null, creator_name: null, docs_indexed: row.docs_indexed ?? 0, last_success: pair ? pair.lastSuccess : "{{ago:1h}}",
    latest_index_attempt: pair?.latest ?? null, queue_position: positions.get(id) ?? null, permissions: detail.permissions,
  }));
  const statusCountsByBucket = { indexing: 0, failed: 0, paused: 0, scheduled: 0, indexed: 0 };
  for (const row of statusRows) statusCountsByBucket[row.status] += 1;
  routes["GET /manage/admin/index-monitoring/connectors"] = { items: statusRows, total_items: statusRows.length, status_counts: statusCountsByBucket, federated_connectors: [] };
  if (fleetRuns.length) {
    const items = fleetRuns.sort((a, b) => a.createdAgo - b.createdAgo).map(({ item }) => item);
    routes["GET /manage/admin/index-monitoring/runs"] = { items, total_items: items.length, status_counts: statusCounts(items.map(({ run }) => run)) };
  }
  routes["GET /mockshop/world-screen"] = { hidden_connectors: connectorRows.filter((s) => !s.visible).map((s) => s.id) };
  const connectorSeeds = routes["GET /manage/admin/connector/status"] || [];
  routes["GET /manage/admin/connector/status"] = connectorRows.map((source) => ({
    cc_pair_id: source.id, name: source.row.name, connector: source.connector, credential: source.credential, groups: [],
    status: source.detail.status, access_type: source.detail.access_type, has_successful_run: source.pair ? source.pair.hasSuccess : true,
    ...connectorSeeds.find((seed) => seed.cc_pair_id === source.id),
  }));
  Object.assign(ctx, { groups });
}
