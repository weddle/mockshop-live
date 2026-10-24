// Index monitoring (v5.0.0-beta.2): the indexing status page and connector detail feeds. The adapter writes each pair's runs newest
// first (adapter/index-runs.mjs); these transforms apply the routes' query parameters per request, and compute the throughput and
// overview figures from the runs at request time, as the backend does (backend/onyx/server/documents/cc_pair_throughput.py,
// index_monitoring.py, cc_pair.py, db/cc_pair_runs.py). Read-only: nothing here starts, cancels or resolves a run.
export const order = 100;

// THROUGHPUT_SLICES and each window's span.
const SLICES = { "1h": 20, "12h": 72, "24h": 72, "7d": 84 };
const HOURS = { "1h": 1, "12h": 12, "24h": 24, "7d": 168 };
const GROUP = { not_started: "running", in_progress: "running", running: "running", success: "succeeded", completed_with_errors: "succeeded",
  passed: "succeeded", failed: "failed", invalid: "failed", failed_to_run: "failed", canceled: "canceled", interrupted: "canceled" };
const SUPERSEDING = new Set(["succeeded", "failed"]);
const STATUS_ORDER = ["indexing", "failed", "paused", "scheduled", "indexed"];
const ACTIVE_PAIR = new Set(["ACTIVE", "SCHEDULED", "INITIAL_INDEXING"]);

const search = (ctx) => new URL(ctx.req.url, "http://mock").searchParams;
const flag = (value) => (value === null ? null : value === "true");
const page = (items, sp, fallbackSize) => {
  const num = Math.max(0, Number(sp.get("page_num")) || 0), size = Math.max(1, Number(sp.get("page_size")) || fallbackSize);
  return items.slice(num * size, (num + 1) * size);
};
const errorText = (run) => run.attempt.error_msg ?? run.attempt.error_message ?? "";
const errorsOf = (run) => (run.kind !== "indexing" || !run.attempt.error_count ? "none" : run.attempt.open_doc_error_count > 0 ? "unresolved" : "resolved");
const counts = (runs) => {
  const out = { running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const run of runs) out[GROUP[run.attempt.status]] += 1;
  return out;
};

/** The runs feed's filters (`GET /admin/cc-pair/{id}/runs`, `GET /index-monitoring/runs`). `pairOf` names the pair a superseding run must share. */
function filterRuns(items, sp, runOf, pairOf) {
  const since = sp.get("since"), until = sp.get("until"), kinds = sp.getAll("kinds"), groups = sp.getAll("status_groups");
  const q = (sp.get("q") || "").trim().toLowerCase(), errors = sp.get("errors"), superseded = flag(sp.get("superseded")), resolved = flag(sp.get("resolved"));
  // A failed run a newer succeeded or failed run of its kind followed.
  const isSuperseded = (item) => {
    const run = runOf(item);
    if (GROUP[run.attempt.status] !== "failed") return false;
    return items.some((other) => other !== item && pairOf(other) === pairOf(item) && runOf(other).kind === run.kind
      && Date.parse(runOf(other).time_created) > Date.parse(run.time_created) && SUPERSEDING.has(GROUP[runOf(other).attempt.status]));
  };
  const matching = items.filter((item) => {
    const run = runOf(item), created = Date.parse(run.time_created);
    if (since && created < Date.parse(since)) return false;
    if (until && created >= Date.parse(until)) return false;
    if (kinds.length && !kinds.includes(run.kind)) return false;
    if (q && !errorText(run).toLowerCase().includes(q)) return false;
    if (resolved !== null && (run.resolved_at !== null) !== resolved) return false;
    const errorsMatch = errors === null || errorsOf(run) === errors;
    const supersededMatch = superseded === null || isSuperseded(item) === superseded;
    // With `errors`, superseded=true keeps the runs either matches.
    return errors !== null && superseded === true ? errorsMatch || supersededMatch : errorsMatch && supersededMatch;
  });
  const shown = groups.length ? matching.filter((item) => groups.includes(GROUP[runOf(item).attempt.status])) : matching;
  return { items: page(shown, sp, 10), total_items: shown.length, status_counts: counts(matching.map(runOf)) };
}

/** Documents per equal slice of the window ending now, each run's total spread evenly over its span, and the runs overlapping it. */
function throughput(runs, requested, now) {
  const window = SLICES[requested] ? requested : "1h";
  const end = now, start = end - HOURS[window] * 3_600_000, slices = SLICES[window], width = (end - start) / slices;
  const totals = new Array(slices).fill(0), overlapping = [];
  for (const run of runs) {
    if (run.kind !== "indexing") continue;
    const attempt = run.attempt;
    // A queued run has no start yet, so it starts at its creation.
    const started = Date.parse(attempt.time_started ?? run.time_created);
    const ended = attempt.time_finished === null ? null : Math.max(Date.parse(attempt.time_finished), started);
    if ((ended ?? end) < start || started >= end) continue;
    overlapping.push({ started: new Date(started).toISOString(), ended: ended === null ? null : new Date(ended).toISOString(), status: attempt.status });
    const docs = attempt.total_docs_indexed || 0;
    if (attempt.time_started === null || docs === 0) continue;
    const runEnd = ended ?? end;
    if (runEnd === started) { totals[Math.min(slices - 1, Math.floor((runEnd - start) / width))] += docs; continue; }
    const perMs = docs / (runEnd - started);
    for (let index = Math.max(0, Math.floor((started - start) / width)); index <= Math.min(slices - 1, Math.floor((runEnd - start) / width)); index++) {
      const sliceStart = start + width * index;
      totals[index] += perMs * Math.max(0, Math.min(runEnd, sliceStart + width) - Math.max(started, sliceStart));
    }
  }
  // Round the running total, not each slice, so the slices sum to the window total.
  let running = 0;
  const docsIndexed = totals.map((total) => { const previous = Math.round(running); running += total; return Math.round(running) - previous; });
  return { window_start: new Date(start).toISOString(), window_end: new Date(end).toISOString(), docs_indexed: docsIndexed, runs: overlapping };
}

/** Rows for pairs created in the UI this run (the save-controls store, not its seeded pairs): scheduled, with no attempt yet, as a new pair is until a worker picks it up. */
export function createdRows(saveControls) {
  if (!saveControls) return [];
  return Object.values(saveControls.pairs || {}).filter((pair) => !saveControls.seededPairs.has(pair.id)).map((pair) => ({
    cc_pair_id: pair.id, name: pair.name, source: pair.connector.source, access_type: pair.access_type, cc_pair_status: pair.status ?? "ACTIVE",
    status: pair.status === "PAUSED" ? "paused" : "scheduled", creator_email: pair.creator_email ?? null, creator_name: null,
    docs_indexed: pair.num_docs_indexed ?? 0, last_success: null, latest_index_attempt: null, queue_position: null,
    permissions: pair.permissions ?? { operate: true, edit: true, delete: true, publish: true },
  }));
}

export default function createIndexMonitoring(core) {
  const fleetRuns = () => (core.fixture("GET", "/manage/admin/index-monitoring/runs")?.items || []).map((item) => item.run);
  const created = () => createdRows(core.state.saveControls?.[core.state.org || ""]);
  return {
    transform: {
      "GET /manage/admin/cc-pair/:id/runs": (value, ctx) => (Array.isArray(value?.items)
        ? { ...value, ...filterRuns(value.items, search(ctx), (run) => run, () => ctx.params.id) } : value),
      "GET /manage/admin/index-monitoring/runs": (value, ctx) => (Array.isArray(value?.items)
        ? { ...value, ...filterRuns(value.items, search(ctx), (item) => item.run, (item) => item.cc_pair.id) } : value),
      "GET /manage/admin/cc-pair/:id/index-attempts": (value, ctx) => (Array.isArray(value?.items) ? { ...value, items: page(value.items, search(ctx), 10) } : value),
      // Sorted by status, then source, then name (then id); `status_counts` ignores the status filter; federated rows only on an unfiltered first page.
      "GET /manage/admin/index-monitoring/connectors": (value, ctx) => {
        if (!Array.isArray(value?.items)) return value;
        const sp = search(ctx), q = (sp.get("q") || "").trim().toLowerCase(), status = sp.get("status"), pageNum = Number(sp.get("page_num")) || 0;
        const searched = [...value.items, ...created()].filter((row) => !q || row.name.toLowerCase().includes(q));
        const statusCounts = Object.fromEntries(STATUS_ORDER.map((bucket) => [bucket, searched.filter((row) => row.status === bucket).length]));
        const matching = searched.filter((row) => !status || row.status === status).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
          || a.source.localeCompare(b.source) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.cc_pair_id - b.cc_pair_id);
        return { ...value, items: page(matching, sp, 20), total_items: matching.length, status_counts: statusCounts,
          federated_connectors: pageNum === 0 && !status ? (value.federated_connectors || []).filter((row) => !q || row.name.toLowerCase().includes(q)) : [] };
      },
      "GET /manage/admin/cc-pair/:id/throughput": (value, ctx) => throughput(core.fixture("GET", `/manage/admin/cc-pair/${ctx.params.id}/runs`)?.items || [],
        search(ctx).get("window"), core.demoNow()),
      "GET /manage/admin/index-monitoring/overview": (value, ctx) => {
        const rows = [...(core.fixture("GET", "/manage/admin/index-monitoring/connectors")?.items || []), ...created()];
        const fleet = throughput(fleetRuns(), search(ctx).get("window"), core.demoNow());
        return { indexing_connectors: rows.filter((row) => row.latest_index_attempt?.status === "in_progress").length,
          active_connectors: rows.filter((row) => ACTIVE_PAIR.has(row.cc_pair_status)).length,
          recent_docs_indexed: fleet.docs_indexed.reduce((n, docs) => n + docs, 0), total_docs_indexed: rows.reduce((n, row) => n + (row.docs_indexed || 0), 0),
          throughput: fleet };
      },
    },
  };
}
