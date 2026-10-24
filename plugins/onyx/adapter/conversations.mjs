// Conversations: shared conversations -> chat sessions and history files.
import path from "node:path";
import { own, entries, uuid, fileKey, fail, writeYaml } from "./shared.mjs";

export function derive(ctx) {
  const { content, app, script, outputDir, routes, agentMap, conversationMap, project, reply } = ctx;
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
}
