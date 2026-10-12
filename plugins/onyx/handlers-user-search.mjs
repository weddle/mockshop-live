// Fictional search data only. The central chat engine still owns sessions and NDJSON.
import { sourceLink } from "./chat.mjs";

export default function createUserSearchHandlers(core) {
  const seed = () => core.fixture("GET", "/mockshop/user-search-seed");
  const documents = () => seed().documents;
  const matchesFilters = (doc, filters = {}) => {
    if (filters.source_type != null && !filters.source_type.includes(doc.source)) return false;
    if (filters.document_set?.length && !filters.document_set.some((name) => doc.document_sets?.includes(name))) return false;
    const range = filters.updated_at_range;
    if (range?.start && Date.parse(doc.updated) < Date.parse(range.start)) return false;
    if (range?.end && Date.parse(doc.updated) > Date.parse(range.end)) return false;
    return !filters.tags?.length || filters.tags.some((tag) =>
      doc.tags?.some((candidate) => candidate.tag_key === tag.tag_key && candidate.tag_value === tag.tag_value));
  };
  const selectedDocuments = (query, filters) => {
    if (new RegExp(seed().empty_query_match, "i").test(query)) return [];
    return documents().filter((doc) => matchesFilters(doc, filters));
  };
  const toSearchDoc = (doc, includeContent) => ({
    document_id: doc.id, chunk_ind: 0, semantic_identifier: doc.title,
    link: sourceLink(doc), blurb: doc.blurb, source_type: doc.source,
    boost: 0, hidden: false, metadata: { ...doc.metadata, tags: doc.tags.map((tag) => tag.tag_value) },
    score: doc.score, is_relevant: true, relevance_explanation: null,
    match_highlights: [doc.blurb], updated_at: doc.updated,
    primary_owners: doc.owners, secondary_owners: [], is_internet: false,
    content: includeContent ? doc.content : null,
  });

  return {
    // No server-side search session: SearchUI owns query/filter/page lifecycle.
    routes: [
      { method: "GET", path: "/query/valid-tags", handle(ctx) {
        const query = String(ctx.query.match_pattern || "").toLowerCase();
        ctx.send(200, { tags: seed().tags.filter((tag) => !query ||
          `${tag.tag_key} ${tag.tag_value}`.toLowerCase().includes(query)) });
      } },
      { method: "POST", path: "/search/search-flow-classification", async handle(ctx) {
        const body = await ctx.body();
        ctx.send(200, { is_search_flow: new RegExp(seed().auto_search_match, "i").test(body.user_query || "") });
      } },
      { method: "POST", path: "/search/send-search-message", async handle(ctx) {
        const body = await ctx.body(), config = seed();
        await new Promise((resolve) => setTimeout(resolve, config.search_delay_ms));
        const query = body.search_query || "";
        const error = new RegExp(config.error_query_match, "i").test(query) ? config.error_text : null;
        const docs = error ? [] : selectedDocuments(query, body.filters || {}).slice(0, body.num_hits ?? 30);
        // A successful JSON error response exercises SearchUI's native failure card
        // and toast without suppressing strict network/console errors.
        ctx.send(200, { all_executed_queries: [query], search_docs: docs.map((doc) => toSearchDoc(doc, body.include_content)),
          doc_selection_reasoning: null, llm_selected_doc_ids: docs.slice(0, 1).map((doc) => doc.id), error });
      } },
    ],
    // Parent calls this after pickScript and before regeneration/answer-node storage.
    // Returning the original script leaves unrelated scripted journeys untouched.
    selectChatScript(script, body) {
      const config = seed(), query = body.message || "", filters = body.internal_search_filters || {};
      const searchTool = (core.fixture("GET", "/tool") || []).find((tool) => tool.in_code_tool_id === "SearchTool");
      const searchId = searchTool?.id ?? 1;
      const disabled = Array.isArray(body.allowed_tool_ids) && !body.allowed_tool_ids.includes(searchId);
      const filtered = filters.source_type != null || filters.document_set?.length || filters.updated_at_range || filters.tags?.length;
      if (!filtered && body.forced_tool_id !== searchId && !new RegExp(config.chat_query_match, "i").test(query)) return script;
      const docs = disabled ? [] : selectedDocuments(query, filters);
      return { title: config.chat_title, queries: disabled ? undefined : [query], documents: docs,
        chunk_delay_ms: 2, answer: docs.length
          ? `${config.answer_intro}\n\n${docs.slice(0, 3).map((doc, index) => `- ${doc.title}: ${doc.blurb} [${index + 1}]`).join("\n")}`
          : config.empty_answer };
    },
    // Compose ahead of the existing source/script lookup; preserve all other docs.
    findDocument(id) { return documents().find((doc) => doc.id === id) ?? null; },
    documentBody(...ids) {
      return documents().find((doc) => ids.some((id) => doc.id === id || doc.id === `FILE__${id}`))?.content ?? null;
    },
  };
}
