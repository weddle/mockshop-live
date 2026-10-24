// Index runs (v5.0.0-beta.2): apps.onyx.cc_pairs.<source> and apps.onyx.index_runs.<source> -> IndexAttemptSnapshot, CCPairRun,
// per-attempt stage metrics and the pair's indexing state, with the pinned backend's rules (backend/onyx/server/documents/
// index_monitoring.py `_connector_status`, models.py `IndexAttemptSnapshot`, `CCPairFullInfo`, `synthesize_unaccounted`).
// Times are authored as durations before the demo anchor ("40m", "2h30m") and emitted as {{ago:<n>s}} templates.
import { entries, fail } from "./shared.mjs";

const UNIT = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
const ACTIVE = new Set(["not_started", "in_progress"]);
const SUCCEEDED = new Set(["success", "completed_with_errors"]);
// IndexAttemptStage in declaration (pipeline) order; onyx/db/index_attempt_metrics_models.py.
export const STAGES = ["CONNECTOR_VALIDATION", "PERMISSION_VALIDATION", "CHECKPOINT_LOAD", "CONNECTOR_FETCH", "HIERARCHY_UPSERT", "DOC_BATCH_STORE",
  "DOC_BATCH_ENQUEUE", "QUEUE_WAIT", "DOCPROCESSING_SETUP", "BATCH_LOAD", "DOC_DB_PREPARE", "IMAGE_PROCESSING", "CHUNKING", "CONTEXTUAL_RAG",
  "EMBEDDING", "EMBEDDING_RATE_LIMIT_WAIT", "EMBEDDING_PROVIDER_THROTTLE_WAIT", "DOC_LOCK_ACQUIRE_WAIT", "ENRICHMENT_PREP", "VECTOR_DB_WRITE",
  "POST_INDEX_DB_UPDATE", "COORD_LOCK_ACQUIRE_WAIT", "COORDINATION_UPDATE", "FINALIZATION", "GC_COLLECT", "BATCH_UNACCOUNTED", "BATCH_TOTAL"];
const ATTEMPT_LEVEL = new Set(["CONNECTOR_VALIDATION", "PERMISSION_VALIDATION", "CHECKPOINT_LOAD"]);
// The docfetching stages one fetch worker runs in sequence, and the docprocessing stages BATCH_TOTAL spans (_BATCH_TOTAL_COMPONENT_STAGES).
const FETCH = new Set(["CONNECTOR_FETCH", "HIERARCHY_UPSERT", "DOC_BATCH_STORE", "DOC_BATCH_ENQUEUE"]);
const COMPONENTS = new Set(["DOC_DB_PREPARE", "IMAGE_PROCESSING", "CHUNKING", "CONTEXTUAL_RAG", "EMBEDDING", "DOC_LOCK_ACQUIRE_WAIT", "ENRICHMENT_PREP",
  "COORD_LOCK_ACQUIRE_WAIT", "VECTOR_DB_WRITE", "POST_INDEX_DB_UPDATE", "COORDINATION_UPDATE", "FINALIZATION", "GC_COLLECT"]);

/** Seconds before the anchor for "40m", "2h30m", "0s". */
export function agoSeconds(value, field, script) {
  if (typeof value !== "string" || !/^(\d+(\.\d+)?[smhdw])+$/.test(value.trim())) fail(field, `expected a duration before now such as "40m" or "2h30m" (got ${JSON.stringify(value)})`, script);
  let seconds = 0;
  for (const [, n, , unit] of value.trim().matchAll(/(\d+(\.\d+)?)([smhdw])/g)) seconds += Number(n) * UNIT[unit];
  return seconds;
}
const ago = (seconds) => `{{ago:${Math.round(seconds)}s}}`;

function stageMetrics(run, at, script) {
  const stages = run.stages;
  if (stages === undefined) return null;
  if (run.batches === undefined) fail(`${at}.batches`, "stages need the number of batches the run processed", script);
  const batches = run.batches;
  const first = ago(run.startedAgo), last = ago(run.endAgo);
  const rows = [];
  for (const [stage, spec] of entries(stages)) {
    const field = `${at}.stages.${stage}`;
    if (!STAGES.includes(stage)) fail(field, `unknown stage; expected one of ${STAGES.join(", ")}`, script);
    if (stage === "BATCH_TOTAL" || stage === "BATCH_UNACCOUNTED") fail(field, "derived from the other stages; do not author it", script);
    const timing = typeof spec === "number" ? { avg: spec } : spec;
    const events = ATTEMPT_LEVEL.has(stage) ? 1 : batches;
    const avg = timing.avg * 1000;
    const min = Math.round((timing.min ?? (events > 1 ? timing.avg * 0.6 : timing.avg)) * 1000);
    const max = Math.round((timing.max ?? (events > 1 ? timing.avg * 1.8 : timing.avg)) * 1000);
    if (min > avg || max < avg) fail(field, "min must not exceed avg and max must not be below it", script);
    const total = Math.round(avg * events);
    rows.push({ stage, scope: ATTEMPT_LEVEL.has(stage) ? "ATTEMPT_LEVEL" : "BATCH_LEVEL", event_count: events, total_duration_ms: total,
      avg_duration_ms: total / events, std_dev_duration_ms: events > 1 ? (timing.sd ?? timing.avg * 0.25) * 1000 : null,
      min_duration_ms: min, max_duration_ms: max, time_first_event: first, time_last_event: last });
  }
  const components = rows.filter((row) => COMPONENTS.has(row.stage));
  const sum = (list, key) => list.reduce((n, row) => n + row[key], 0);
  const durationMs = (run.startedAgo - run.endAgo) * 1000;
  const fetchMs = sum(rows.filter((row) => FETCH.has(row.stage)), "total_duration_ms");
  if (fetchMs > durationMs) fail(`${at}.stages`, `fetch stages add up to ${fetchMs / 1000}s but the run lasted ${durationMs / 1000}s`, script);
  if (components.length) {
    const total = sum(components, "total_duration_ms");
    if (total > durationMs) fail(`${at}.stages`, `docprocessing stages add up to ${total / 1000}s but the run lasted ${durationMs / 1000}s`, script);
    rows.push({ stage: "BATCH_TOTAL", scope: "BATCH_LEVEL", event_count: batches, total_duration_ms: total, avg_duration_ms: total / batches,
      std_dev_duration_ms: Math.sqrt(components.reduce((n, row) => n + (row.std_dev_duration_ms ?? 0) ** 2, 0)),
      min_duration_ms: sum(components, "min_duration_ms"), max_duration_ms: sum(components, "max_duration_ms"), time_first_event: first, time_last_event: last });
  }
  rows.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  // The route appends the residual after the stored rows; the stages here add up to BATCH_TOTAL, so it is zero.
  if (components.length) rows.push({ stage: "BATCH_UNACCOUNTED", scope: "BATCH_LEVEL", event_count: batches, total_duration_ms: 0, avg_duration_ms: 0,
    std_dev_duration_ms: null, min_duration_ms: null, max_duration_ms: null, time_first_event: first, time_last_event: last });
  return rows;
}

/** One pair's authored state and runs, newest first, with everything the connector routes read. */
export function derivePair({ key, pair = {}, runs, script, number, defaultDocs }) {
  const at = `apps.onyx.cc_pairs.${key}`;
  const status = pair.status ?? "ACTIVE";
  const createdAgo = agoSeconds(pair.created ?? "120d", `${at}.created`, script);
  const derived = (runs || []).map((run, index) => {
    const rat = `apps.onyx.index_runs.${key}[${index}]`;
    const queued = run.status === "not_started", active = ACTIVE.has(run.status);
    if (queued && (run.started !== undefined || run.finished !== undefined)) fail(rat, "a queued run has neither started nor finished", script);
    if (!queued && run.started === undefined) fail(`${rat}.started`, "required for a run that started", script);
    if (active && run.finished !== undefined) fail(`${rat}.finished`, "a running run has not finished", script);
    if (!active && run.finished === undefined) fail(`${rat}.finished`, `required for a ${run.status} run`, script);
    if (!active && run.updated !== undefined) fail(`${rat}.updated`, "only a running run has its own update time", script);
    const startedAgo = queued ? null : agoSeconds(run.started, `${rat}.started`, script);
    const createdRunAgo = run.created === undefined ? (startedAgo ?? 0) : agoSeconds(run.created, `${rat}.created`, script);
    const finishedAgo = run.finished === undefined ? null : agoSeconds(run.finished, `${rat}.finished`, script);
    const updatedAgo = run.status === "in_progress" ? agoSeconds(run.updated ?? "1m", `${rat}.updated`, script) : null;
    if (startedAgo !== null && startedAgo > createdRunAgo) fail(`${rat}.started`, "a run starts after it is created", script);
    if (finishedAgo !== null && finishedAgo > startedAgo) fail(`${rat}.finished`, "a run finishes after it starts", script);
    if (updatedAgo !== null && updatedAgo > startedAgo) fail(`${rat}.updated`, "a run updates after it starts", script);
    if (createdRunAgo > createdAgo) fail(`${rat}.created`, `the run is older than the connector (${at}.created)`, script);
    const id = number("index_attempts", `${key}.${run.id ?? index}`, run.id);
    const newDocs = run.new_docs ?? 0, totalDocs = run.total_docs ?? newDocs;
    if (newDocs > totalDocs) fail(`${rat}.new_docs`, "new documents are part of total_docs", script);
    const errorCount = run.error_count ?? 0, openErrors = run.open_error_count ?? errorCount;
    if (openErrors > errorCount) fail(`${rat}.open_error_count`, "open errors are part of error_count", script);
    const attempt = { id, status: run.status, from_beginning: run.from_beginning ?? index === runs.length - 1, new_docs_indexed: newDocs,
      total_docs_indexed: totalDocs, docs_removed_from_index: run.removed_docs ?? 0, error_msg: run.error ?? null,
      error_count: errorCount, open_doc_error_count: openErrors, full_exception_trace: run.trace ?? null,
      time_started: startedAgo === null ? null : ago(startedAgo), time_updated: ago(finishedAgo ?? updatedAgo ?? createdRunAgo),
      time_finished: finishedAgo === null ? null : ago(finishedAgo), poll_range_start: null, poll_range_end: null, is_backfill: false, is_new_model: false };
    const stages = queued ? (run.stages === undefined ? null : fail(`${rat}.stages`, "a queued run has no stage metrics", script))
      : stageMetrics({ ...run, startedAgo, endAgo: finishedAgo ?? updatedAgo ?? 0 }, rat, script);
    return { createdAgo: createdRunAgo, attempt, stages, run: { kind: "indexing", time_created: ago(createdRunAgo), attempt,
      resolved_at: run.resolved === undefined ? null : ago(agoSeconds(run.resolved, `${rat}.resolved`, script)) } };
  });
  for (let i = 1; i < derived.length; i++) if (derived[i].createdAgo < derived[i - 1].createdAgo) fail(`apps.onyx.index_runs.${key}[${i}]`, "runs are listed newest first", script);
  const ids = new Set();
  for (const [i, { attempt }] of derived.entries()) { if (ids.has(attempt.id)) fail(`apps.onyx.index_runs.${key}[${i}].id`, "duplicate run id", script); ids.add(attempt.id); }
  const latest = derived[0]?.attempt ?? null;
  const running = latest?.status === "in_progress";
  const repeated = pair.in_repeated_error_state ?? false;
  // _connector_status: the pair's own state first, then the latest attempt's; a live attempt outranks the sticky error.
  const bucket = status === "PAUSED" ? "paused" : status === "DELETING" || status === "INVALID" ? "failed" : repeated && !running ? "failed"
    : latest === null ? "scheduled" : running ? "indexing" : ["not_started", "canceled", "interrupted"].includes(latest.status) ? "scheduled"
    : latest.status === "failed" ? "failed" : "indexed";
  const success = derived.find(({ attempt }) => SUCCEEDED.has(attempt.status));
  // CCPairFullInfo: while the only attempt is still running, the pair counts that attempt's new documents.
  const docs = pair.docs_indexed ?? (running && derived.length === 1 ? latest.new_docs_indexed : defaultDocs);
  return { status, bucket, latest, running, repeated, docs, createdAgo, derived, lastSuccess: success ? success.attempt.time_finished : null,
    hasSuccess: Boolean(success), speed: docs / (createdAgo / 60) };
}

/** The runs feed's per-group counts. */
export const STATUS_GROUP = { not_started: "running", in_progress: "running", success: "succeeded", completed_with_errors: "succeeded",
  failed: "failed", invalid: "failed", canceled: "canceled", interrupted: "canceled" };
export function statusCounts(runs) {
  const counts = { running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const run of runs) counts[STATUS_GROUP[run.attempt.status]] += 1;
  return counts;
}
