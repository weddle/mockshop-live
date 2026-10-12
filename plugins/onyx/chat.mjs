// Scripted chat answers -> Onyx NDJSON streaming packets.
// Packet shapes mirror backend/onyx/server/query_and_chat/streaming_models.py
// and session_loading.py (replay), and web/tests/e2e/utils/chatMock.ts.
import fs from "node:fs";
import path from "node:path";

// dirs: chat script dirs in priority order (highest layer first); parse: YAML loader with time templating.
// history: earlier turns on this branch of the chat, oldest first ({message, script}).
// A script with `after: <regex>` only matches when an earlier user message or script title matches it,
// so a fixed-wording follow-up can answer in the context of the first question.
// A script with `follow_up_default: true` is the fallback for any later turn (before `default: true`).
// model: the canonical model_version already resolved by the caller (not its display label).
export function pickScript(dirs, message, parse, history = [], model = null) {
  let fallback = null, followFallback = null;
  const earlier = history.flatMap((t) => [t.message || "", t.script?.title || ""]);
  for (const d of dirs) {
    for (const f of fs.readdirSync(d).sort()) {
      if (!/\.ya?ml$/.test(f)) continue;
      const s = { ...parse(path.join(d, f)), _file: f };
      if (s.turn != null) continue; // Exact scripted turns are never a manual-browsing fallback.
      const ctxOk = !s.after || earlier.some((m) => new RegExp(s.after, "i").test(m));
      if (s.match && ctxOk && new RegExp(s.match, "i").test(message)) return withContext(s, history, model);
      if (s.follow_up_default && history.length && !followFallback) followFallback = s;
      if (s.default && !fallback) fallback = s;
    }
  }
  const s = followFallback || fallback || { answer: "No prepared answer is available for this question.", documents: [] };
  return withContext(s, history, model);
}

// Select a partial response override before expanding "{{prev.*}}" / "{{first.*}}".
// Copy response fields; neither parsed seeds nor earlier answer snapshots are modified.
export function withContext(s, history = [], model = null) {
  const variant = model != null && s.model_variants && Object.hasOwn(s.model_variants, model)
    ? s.model_variants[model] : null;
  const selected = variant ? { ...s, ...variant } : s;
  const prev = history[history.length - 1], first = history[0];
  const vars = {
    "prev.title": prev?.script?.title ?? "", "prev.message": prev?.message ?? "",
    "first.title": first?.script?.title ?? "", "first.message": first?.message ?? "",
  };
  const fill = (v) => (typeof v === "string" ? v.replace(/\{\{(prev|first)\.(title|message)\}\}/g, (k) => vars[k.slice(2, -2)]) : v);
  return { ...selected, title: fill(selected.title), answer: fill(selected.answer), regenerate: selected.regenerate?.map(fill) };
}

// Files have no link: Onyx opens them in its own preview modal (GET /chat/file/{id}, see handlers.mjs).
const FILE_SOURCES = ["file", "user_file"];

// Cited sources open the mock's local viewer (/api/mockshop/source/{id}) instead of the dead fixture URL;
// `external: true` keeps the fixture link as is.
export function sourceLink(d) {
  if (FILE_SOURCES.includes(d.source)) return null;
  if (d.external) return d.link ?? null;
  return `/api/mockshop/source/${encodeURIComponent(d.id)}`;
}

function toSearchDoc(d, i) {
  return {
    document_id: d.id,
    chunk_ind: 0,
    semantic_identifier: d.title,
    link: sourceLink(d),
    blurb: d.blurb ?? "",
    source_type: d.source,
    boost: 0,
    hidden: false,
    metadata: d.metadata ?? {},
    score: d.score ?? Number((0.92 - i * 0.04).toFixed(3)),
    is_relevant: null,
    relevance_explanation: null,
    match_highlights: d.highlights ?? [d.blurb ?? ""],
    updated_at: d.updated ?? null,
    primary_owners: d.owners ?? null,
    secondary_owners: null,
    is_internet: d.is_internet ?? false,
    file_id: null,
    db_doc_id: 9000 + i,
  };
}

// Turn "[1]" / "[1, 2]" in the scripted markdown into Onyx's hyperlink
// citation form "[[1]](url)" and collect citation numbers in order.
function renderCitations(answer, docs, citeMap) {
  const seen = [];
  const out = answer.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_, nums) =>
    nums.split(/\s*,\s*/).map((n) => {
      const id = citeMap[n] ?? docs[Number(n) - 1]?.document_id;
      const doc = docs.find((d) => d.document_id === id);
      if (!seen.includes(Number(n))) seen.push(Number(n));
      return `[[${n}]](${doc?.link ?? ""})`;
    }).join("")
  );
  return { text: out, seen };
}

function prepare(script) {
  const docs = (script.documents || []).map(toSearchDoc);
  const citeMap = Object.fromEntries(Object.entries(script.citations || {}).map(([k, v]) => [String(k), v]));
  const { text, seen } = renderCitations(script.answer || "", docs, citeMap);
  const citations = Object.fromEntries(seen.map((n) => [n, citeMap[n] ?? docs[n - 1]?.document_id]));
  return { docs, text, citations };
}

function chunk(text, size = 24) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

function toolPackets(script, docs, turn) {
  const pl = (obj) => ({ placement: { turn_index: turn, tab_index: 0 }, obj });
  const out = [];
  if (!docs.length && !script.queries) return { packets: out, turns: 0 };
  out.push(pl({ type: "search_tool_start", is_internet_search: !!script.web_search }));
  out.push(pl({ type: "search_tool_queries_delta", queries: script.queries || [] }));
  if (docs.length) out.push(pl({ type: "search_tool_documents_delta", documents: docs }));
  out.push(pl({ type: "section_end" }));
  return { packets: out, turns: 1 };
}

// opts.onText(sofar): called with the answer text streamed so far (so a stopped answer can be replayed partially).
export function* buildChatStream(script, ids, opts = {}) {
  const { docs, text, citations } = prepare(script);
  let sofar = "";
  const speed = script.chunk_delay_ms ?? 12;
  // BackendMessage's overridden_model drives the pinned single-answer model label.
  // Freeze it from the answer node, not the session's mutable current picker selection.
  const metadata = { overridden_model: opts.llm?.model_version ?? null,
    model_display_name: opts.llm?.display_name ?? null };
  yield { delay: 0, packet: { user_message_id: ids.user, reserved_assistant_message_id: ids.agent } };
  let turn = 0;
  if (script.reasoning) {
    const pl = (obj) => ({ placement: { turn_index: turn, tab_index: 0 }, obj });
    yield { delay: 150, packet: pl({ type: "reasoning_start" }) };
    for (const c of chunk(script.reasoning, 40)) yield { delay: speed, packet: pl({ type: "reasoning_delta", reasoning: c }) };
    yield { delay: 0, packet: pl({ type: "reasoning_done" }) };
    turn += 1;
  }
  const tools = toolPackets(script, docs, turn);
  for (const [i, p] of tools.packets.entries()) yield { delay: i === 0 ? 200 : 250, packet: p };
  turn += tools.turns;
  const pl = (obj) => ({ placement: { turn_index: turn, tab_index: 0 }, obj });
  yield { delay: 200, packet: pl({ type: "message_start", final_documents: docs.length ? docs : null, pre_answer_processing_seconds: 2.4 }) };
  const emitted = new Set();
  for (const c of chunk(text)) {
    if (opts.stopped?.()) {
      // POST /chat/stop-chat-session: the backend ends the stream with a user_cancelled stop
      yield { delay: 0, packet: pl({ type: "stop", stop_reason: "user_cancelled" }) };
      yield { delay: 0, packet: { message_id: ids.agent, citations: {}, files: [], ...metadata } };
      return;
    }
    yield { delay: speed, packet: pl({ type: "message_delta", content: c }) };
    sofar += c;
    opts.onText?.(sofar);
  }
  for (const [n, docId] of Object.entries(citations)) {
    if (emitted.has(n)) continue;
    emitted.add(n);
    yield { delay: 0, packet: pl({ type: "citation_info", citation_number: Number(n), document_id: docId }) };
  }
  yield { delay: 0, packet: pl({ type: "stop", stop_reason: "finished" }) };
  yield { delay: 0, packet: { message_id: ids.agent, citations, files: [], ...metadata } };
}

// partial: the text actually streamed before the user pressed stop (replayed as a cancelled answer).
export function replayPackets(script, partial = null) {
  const p = prepare(script);
  const { docs } = p;
  const text = partial ?? p.text;
  const citations = partial == null ? p.citations : {};
  const packets = [];
  let turn = 0;
  if (script.reasoning) {
    const pl = (obj) => ({ placement: { turn_index: turn, tab_index: 0 }, obj });
    packets.push(pl({ type: "reasoning_start" }), pl({ type: "reasoning_delta", reasoning: script.reasoning }), pl({ type: "section_end" }));
    turn += 1;
  }
  const tools = toolPackets(script, docs, turn);
  packets.push(...tools.packets);
  turn += tools.turns;
  const pl = (obj) => ({ placement: { turn_index: turn, tab_index: 0 }, obj });
  packets.push(pl({ type: "message_start", final_documents: docs.length ? docs : null }));
  packets.push(pl({ type: "message_delta", content: text }));
  packets.push(pl({ type: "section_end" }));
  for (const [n, docId] of Object.entries(citations)) packets.push(pl({ type: "citation_info", citation_number: Number(n), document_id: docId }));
  packets.push(pl({ type: "section_end" }));
  packets.push(pl({ type: "stop", stop_reason: partial == null ? "finished" : "user_cancelled" }));
  return { packets, docs, text, citations };
}

// sess.nodes: message tree in creation order, {id, type: user|assistant, parent, message, script, llm, partial, feedback, time}.
// Saved latestChildId/latestRootId retain a selected older branch; creation order remains the fallback.
export function sessionFromNodes(sess) {
  const messages = [];
  const packets = [];
  const latestChild = {};
  let latestRoot = null;
  for (const n of sess.nodes) {
    if (n.parent != null) latestChild[n.parent] = n.id;
    else latestRoot = n.id;
  }
  // Pinned messageTree.ts uses system node -3 to select among first-user siblings.
  // Keep every real message and assistant packet in its original sibling order.
  if (sess.nodes.length) messages.push({
    chat_session_id: sess.id, message_id: -3, parent_message: null,
    latest_child_message: sess.latestRootId ?? latestRoot, message_type: "system", message: "",
    time_sent: sess.created, files: [], error: null, current_feedback: null,
    preferred_response_id: null, reasoning_tokens: null, context_docs: null, citations: null,
    processing_duration_seconds: null, model_display_name: null,
  });
  for (const n of sess.nodes) {
    const base = {
      chat_session_id: sess.id, message_id: n.id, parent_message: n.parent ?? -3,
      latest_child_message: n.latestChildId ?? latestChild[n.id] ?? null,
      time_sent: n.time || sess.created, files: n.files || [], error: null, current_feedback: n.feedback ?? null,
      preferred_response_id: null,
    };
    if (n.type === "user") {
      messages.push({ ...base, message: n.message, reasoning_tokens: null, message_type: "user", context_docs: null, citations: null,
        processing_duration_seconds: null, model_display_name: null });
      continue;
    }
    const r = replayPackets(n.script, n.partial ?? null);
    messages.push({ ...base, message: r.text, reasoning_tokens: n.script.reasoning ?? null, message_type: "assistant", context_docs: r.docs,
      citations: r.citations, processing_duration_seconds: 6.2,
      model_display_name: n.llm?.display_name ?? n.llm?.model_version ?? n.script.model_display_name ?? null,
      overridden_model: n.llm?.model_version ?? null });
    packets.push(r.packets);
  }
  return {
    chat_session_id: sess.id, description: sess.description, persona_id: sess.persona_id,
    persona_name: null, personal_icon_name: null, messages, time_created: sess.created,
    shared_status: sess.shared_status || "private", current_alternate_model: sess.model ?? null, current_temperature_override: sess.temperature ?? null,
    current_reasoning_effort_override: null, deleted: false, owner_name: sess.owner_name || "",
    packets, current_stream: null, incognito: false,
  };
}
