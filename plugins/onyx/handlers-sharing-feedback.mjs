// Run-local sharing and feedback only. The parent owns all session nodes and serialization.
// Callbacks: readSession(id) materializes through the existing engine; listSessions() exposes its current nodes.
export default function createSharingFeedbackHandlers(core, { readSession, listSessions }) {
  const state = core.state;
  const fixture = () => core.fixture("GET", "/mockshop/sharing-feedback/seeds");
  const key = (id) => `${state.org || ""}:${id}`;
  const reset = (body = {}) => {
    if (!body.keep || body.resetChats !== false) {
      state.sharingFeedback = { shares: {}, feedback: {}, failNext: {} };
      // resetChats:false may deliberately retain the engine tree in a fresh run.
      for (const session of listSessions()) for (const message of session.nodes) message.feedback = null;
    }
  };
  reset();
  const local = () => state.sharingFeedback;
  const seeds = () => fixture()?.sessions || [];
  const seed = (id) => seeds().find((s) => s.id === id);
  const status = (id, fallback = "private") => local().shares[key(id)] ?? seed(id)?.shared_status ?? fallback;
  const node = (id) => {
    // Shared and live views vote on the same engine-owned assistant, never a parallel message registry.
    for (const session of listSessions()) {
      const message = session.nodes.find((n) => n.id === Number(id) && n.type === "assistant");
      if (message) return { session, message };
    }
    return null;
  };
  const fail = (ctx, operation) => {
    if (!local().failNext[operation]) return false;
    delete local().failNext[operation];
    ctx.send(400, { detail: fixture()?.errors?.[operation] || "Fictional local operation did not complete." });
    return true;
  };

  return {
    reset,
    // Feed these into the existing fixtureSessions/materialize/sidebar/detail paths, not a second engine.
    seedSessions(existing = []) {
      return [...existing, ...seeds().filter((s) => !existing.some((e) => e.id === s.id)).map(({ turns, owner_name, ...s }) => s)];
    },
    seedTurns: (id) => seed(id)?.turns,
    seedOwner: (id) => seed(id)?.owner_name,
    status,
    decorateSessions: (sessions) => sessions.map((s) => ({ ...s, shared_status: status(s.id, s.shared_status) })),
    decorateDetail(detail) {
      // sessionFromNodes serializes the authoritative engine node.feedback for both live and shared reads.
      return { ...detail, shared_status: status(detail.chat_session_id, detail.shared_status) };
    },
    // The parent's existing GET handler calls this after resolving the actual session. No duplicate GET route.
    canReadShared: (id) => status(id) === "public",
    routes: [
      { method: "PATCH", path: "/chat/chat-session/:id", async handle(ctx) {
        const session = readSession(ctx.params.id);
        if (!session) return ctx.send(404, { detail: "Chat session not found" });
        const body = await ctx.body();
        if (!["public", "private"].includes(body.sharing_status)) return ctx.send(400, { detail: "Choose public or private sharing." });
        if (fail(ctx, body.sharing_status === "public" ? "share" : "private")) return;
        local().shares[key(session.id)] = body.sharing_status;
        ctx.send(200, null);
      } },
      { method: "POST", path: "/chat/create-chat-message-feedback", async handle(ctx) {
        const body = await ctx.body(), target = node(body.chat_message_id);
        if (!target) return ctx.send(404, { detail: "Chat message not found" });
        if (fail(ctx, "feedback")) return;
        const vote = body.is_positive ? "like" : "dislike";
        target.message.feedback = vote;
        local().feedback[key(target.message.id)] = { vote, feedback_text: body.feedback_text || "",
          predefined_feedback: body.predefined_feedback ?? null, chat_session_id: target.session.id };
        ctx.send(200, null);
      } },
      { method: "DELETE", path: "/chat/remove-chat-message-feedback", handle(ctx) {
        const target = node(ctx.query.chat_message_id);
        if (!target) return ctx.send(404, { detail: "Chat message not found" });
        if (fail(ctx, "remove")) return;
        target.message.feedback = null;
        delete local().feedback[key(target.message.id)];
        ctx.send(200, null);
      } },
      // Stages the native error toast/rollback once. No UI, account, auth or public publishing is introduced.
      { method: "POST", path: "/mockshop/sharing-feedback/outcome", async handle(ctx) {
        const { operation, fail: enabled } = await ctx.body();
        if (!["share", "private", "feedback", "remove"].includes(operation)) return ctx.send(400, { detail: "Unknown sharing/feedback operation" });
        local().failNext[operation] = enabled === true;
        ctx.send(200, null);
      } },
    ],
  };
}
