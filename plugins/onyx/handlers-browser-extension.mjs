// #71 owns fictional context only. The sole existing engine owns chat/session/stream/replay.
// This server cannot authenticate browser MessageEvents; NRF's origin/source guards stay intact.
const contextFor = (url) => `The user is currently viewing: ${url}. Use the open_url tool to read this page and use its content as additional context for your response.`;
const fill = (text, tab) => String(text ?? "").replace(/\{\{tab\.(title|url|content)\}\}/g, (_, key) => tab[key]);

export default function createBrowserExtensionHandlers(core, { markMessageLatest }) {
  let edits = null;
  let failNext = false;
  const seed = () => core.fixture("GET", "/mockshop/browser-extension/seed");
  const context = () => {
    if (!edits) edits = { active_tab: seed().active_tab, tabs: structuredClone(seed().tabs) };
    return edits;
  };
  const requestMatches = (body) => body.origin === "chrome_extension" &&
    new RegExp(seed().script.match, "i").test(body.message || "");
  const tabForRequest = (body) => Object.entries(context().tabs).find(([, tab]) =>
    body.additional_context === contextFor(tab.url));
  const document = (key, tab) => ({
    id: `NRF-TAB-${key}`, title: tab.title, link: tab.url, source: "web",
    blurb: tab.content.split("\n").find((line) => line.trim()) || "Fictional page context.",
    owners: ["Fictional learning team"], is_internet: true,
  });
  return {
    reset(body) { if (!body.keep) { edits = null; failNext = false; } },
    // Parent calls before any mutation in POST /chat/send-chat-message. HTTP200 NDJSON
    // StreamingError is already supported by the pinned controller; retry uses the same engine.
    takeSendError(body) {
      if (!requestMatches(body) || !failNext) return null;
      failNext = false;
      return structuredClone(seed().script.error);
    },
    // Parent calls after #30 selectChatScript and before storing the assistant script.
    // Matching the actual additional_context, not a demo question claiming to read a tab,
    // makes disabling/waiting/new-tab submissions visibly differ from trusted-parent ones.
    selectChatScript(script, body) {
      if (!requestMatches(body)) return script;
      const selected = tabForRequest(body);
      const base = seed().script;
      if (!selected) return {
        title: base.title, answer: base.disabled_answer, chunk_delay_ms: base.chunk_delay_ms,
        regenerate: base.regenerate, documents: [],
      };
      const [key, tab] = selected;
      return {
        title: base.title, answer: fill(base.answer, tab), chunk_delay_ms: base.chunk_delay_ms,
        regenerate: base.regenerate, documents: [document(key, tab)],
      };
    },
    findDocument(id) {
      const key = String(id).replace(/^NRF-TAB-/, "");
      return String(id).startsWith("NRF-TAB-") && context().tabs[key]
        ? document(key, context().tabs[key]) : null;
    },
    documentBody(...ids) {
      const id = ids.find((value) => String(value).startsWith("NRF-TAB-"));
      return id ? context().tabs[String(id).slice(8)]?.content ?? null : null;
    },
    routes: [
      // Native shared branch action; the parent callback mutates the sole chat tree.
      { method: "PUT", path: "/chat/set-message-as-latest", async handle(ctx) {
        const { message_id } = await ctx.body();
        if (!markMessageLatest(message_id)) return ctx.send(404, { detail: "Chat message not found" });
        ctx.send(200, null);
      } },
      { method: "GET", path: "/mockshop/browser-extension/context", handle(ctx) {
        ctx.send(200, context());
      } },
      { method: "PATCH", path: "/mockshop/browser-extension/context", async handle(ctx) {
        const body = await ctx.body(), current = context();
        if (body.active_tab in current.tabs) current.active_tab = body.active_tab;
        for (const [key, patch] of Object.entries(body.tabs || {})) {
          if (!current.tabs[key]) continue;
          for (const field of ["title", "url", "content"])
            if (typeof patch[field] === "string") current.tabs[key][field] = patch[field];
        }
        ctx.send(200, current);
      } },
      { method: "POST", path: "/mockshop/browser-extension/outcome", async handle(ctx) {
        failNext = (await ctx.body()).fail === true;
        ctx.send(200, null);
      } },
    ],
  };
}
