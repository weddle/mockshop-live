# Chat, retrieval, models and sharing

This is a source-derived authoring contract, not a claim that every historical script passed. For the request bodies, message tree, exact-turn resolver and reset ownership, use [backend chat](backend-chat.md) and [backend runtime](backend-runtime.md). Paths below are UI paths; API paths include `/api`. Choose world keys and content for your own organization rather than borrowing a sample's names.

## Compose, stream and stop

The ordinary chat screen is `/app`; `/app?chatId=<id>` loads a saved conversation. `#onyx-chat-input-textbox` is the composer, not a human-message edit textarea. `#onyx-chat-input-send-button` sends through `POST /api/chat/send-chat-message` and becomes the stop control while that turn is running. `POST /api/chat/stop-chat-session/<id>` stops the finite stream and leaves the partial answer in the saved tree. A later regeneration is a new assistant sibling, not continuation of the canceled stream.

Prefer the script `send` operation: its `text` and `reply` arm one exact authored turn, with optional ordered document-key `cites` and `queries`. It still exercises the native send UI and backend engine. A manual fill/click requires a matching world reply. The mock does not contact the displayed model or perform retrieval: it resolves authored text, emits the native finite packet sequence, and saves messages. Exact turns are one-shot and can give different answers to identical questions in different steps; legacy regex replies have their own matching/context rules. Do not assume a question matching an old sample will receive that sample's answer in a new world.

The native thought/search trace can show **Thought for Ns** and a count such as **2 steps**. Clicking that count expands the authored search queries; clicking again collapses it. The number follows the staged `queries`, not a universal two-step locator, and the displayed elapsed thought is not measured provider reasoning.

Wait for the expected answer and a completed latest message, not merely the first `[data-testid="onyx-ai-message"]` or the previous answer's toolbar. Exact `send` waits for its prepared backend turn to complete **and** the latest `[id^="message-"]` wrapper to contain the AI-message test ID, then applies optional `send.wait`. Live wrapper IDs can be optimistic negative IDs; do not equate them to backend IDs until reload. Use explicit short-lived waits for `Stop generating`/the send-button stop state only when demonstrating interruption. A screenshot after text arrival can still capture animated source-panel layout; wait for the layout to settle before framing it.

`state.sidebar` specifies ordered conversation keys, `state.agent` a world agent key, and `state.model` a configured catalog model or world alias. State hydration can reload the same URL; wait again for the intended composer and selected model. Chat creation uses `POST /api/chat/create-chat-session`; discover its resulting `chatId` from the URL instead of guessing the allocator. Saved chat state survives a keep transition and normal navigation. A fresh state reset re-seeds the world chat tree, selections and generated chats as described in [state and reset](script-authoring.md#state-keep-and-reset).

## Composer models, answer models and branches

| Visible control and context | Operation and changed state | What to wait for and what it does not do |
| --- | --- | --- |
| `[data-testid="model-selector"] button:has-text("<label>")` in the composer | Opens the provider/model catalog. A portal `[role="dialog"] :text-is("<model>")` chooses a raw model descriptor; an existing session uses `PUT /api/chat/update-chat-session-model` with `chat_session_id` and `new_alternate_model`. | Composer label changes; subsequent sends and human edits use this selection. It does not rewrite old answer labels. Expand the provider row before choosing a nested model. |
| `[data-testid="AgentMessage/regenerate"]` in a completed answer's toolbar | Opens that answer's regeneration model action, then sends regeneration against the same user parent. The assistant node records its own overridden model/display name. | A new assistant branch appears and the answer switcher advances. It is not the composer default-model picker, even when both buttons say `GPT-5.2`. |
| Hover the intended human message, then `[data-testid="HumanMessage/edit-button"]` | Opens its native textarea; fill the actual edit field, then `Submit` sends a new user branch using the composer model. | The edited user and answer become current siblings. `Cancel` discards the draft. A broad `textarea` selector can target the composer instead. |
| `[data-testid="MessageSwitcher/container"]` under a human message or inside an answer toolbar | Chooses a sibling in the existing tree; no new provider turn. | Scope by message context before selecting previous/next. Human and assistant switchers are distinct. Reopening the chat preserves the saved current branch. |
| Settings → Default Model | `PATCH /api/user/default-model` changes the viewer's preference. | Newly created chats use it; an existing chat keeps its own alternate model. Saved answer attribution remains frozen. |

The corpus explicitly distinguishes these three lifetimes: user default, current conversation selection, and immutable answer attribution. Readback fields include the session's `current_alternate_model` and a message's `overridden_model`/`model_display_name`. A descriptor can include provider display name, provider identifier, model name and `mc:<id>`; display text alone is not necessarily a unique model identity.

A single-provider world renders a flat picker without multi-provider headers. The selected/default model must still resolve through both the ordinary catalog and agent catalog. The pinned native UI has no `Auto` model option. Agent changes can alter available models/actions; the mock does not infer new capabilities from a label. Legacy `model_variants` override selected reply fields and inherit unspecified fields; contextual `after`/history and regeneration variants are separate authored reply cases, not actual model intelligence.

## Agents, recents and chat membership

`[data-testid="AppSidebar/more-agents"]` opens `/app/agents`; selecting an agent/start-chat sets the composer context and can pin it. Use [agent authoring](script-agents-settings.md#agent-gallery-and-editor) for creation, ownership and sharing. Custom-agent chats moved to projects have an additional confirmation, documented in [project membership](script-files-projects.md#project-chat-membership).

A sidebar `ChatButton`/chat-title row opens a conversation. Hover its own menu, not a similarly named agent or project. Rename focuses the row's input; fill and press Enter to persist through the native rename operation. Delete opens a confirmation and calls `DELETE /api/chat/delete-chat-session/<id>`; the deleted chat becomes a tombstone and disappears on reopen. Search Chats uses the native command input; select the exact result, and account for project filters and folded sidebar behavior rather than treating every chat as a Recent. New chat clears conversation selection but is not a global reset.

Organization-switch scripts change staged world/fixture identity and reload `/app`; they are not proof of a real multi-tenant account switch or permission boundary. An authored permission-aware answer and a smaller citation list likewise demonstrate scripted output, not retrieval ACL enforcement.

## Sources, citations and document viewers

| Control | Backend/state contract | Visible consumer and boundary |
| --- | --- | --- |
| Answer citation marker/source chip | References a stable document ID in the saved answer's cited-document list. Hover is native tooltip behavior. | The title, vendor and blurb are authored document metadata. A citation number must agree with the ordered `cites` list. |
| Completed answer `Sources` | Opens the native **Found Sources** sidebar (some older scripts target `Cited Sources` in another context). | The sidebar is conditional on documents; a no-source reply should not require it. Row accessible names can include both title and blurb, so an exact title-only accessible-name locator can fail. |
| File-backed source | Native file preview reads `GET /api/chat/file/<backing-id>`. | Content depends on the world/source body or file fixture, not the citation blurb alone. |
| Vendor/link source row | Native link/window opening targets a local `/api/mockshop/source/<document-id>` viewer when rewritten by this plugin. | The mock viewer exposes `[data-testid="mockshop-source"]`; body comes from authored source Markdown, with a metadata fallback when no body exists. This is not the upstream vendor site. |

Opening a source can create a new tab. A historical script temporarily replaced `window.open` with `location.href` to make same-page capture deterministic; that proves neither native new-tab handling nor an upstream integration. Parent's separately reported macOS strict-shot runs of the retained incident/follow-up examples observed correct authored replies and Found Sources data, including two same-label model controls. The initial row click did not change the current page and did not independently verify a new tab. A later six-shot native smoke established the local `/api/mockshop/source/...` destination and source-vendor propagation into citations, Sources and indexing status; it did not establish an actual connector/vendor visit. For new evidence, track the actual new page or assert a native preview and its body; do not infer success from a click.

Moving the pointer to an empty margin before capture clears hover cards that otherwise obscure source rows. Wait through panel animation. Saved citations and file previews can outlive deletion of an item from the recent-file library because saved messages retain their descriptors; see [saved files](script-files-projects.md#saved-file-grounding-and-deletion).

## Search mode and filters

Enterprise search and chat both live at `/app`; there is no standalone `/search` route in this pin. **Change app mode** offers **Quick search for documents** and **Conversation and research** when that build supports them. Default App Mode in settings is Business-and-up/edition-dependent. Community does not gain the mode menu by changing mock response text.

Quick search submits `POST /api/search/send-search-message`: it produces native result packets, not a chat assistant message. Stage authored search data for loaded, loading, empty, error and paginated cases. Wait for result content or the native error/empty view, not a fixed delay. A failed query remains editable; clear/replace it and search again to show recovery. The mock performs finite fixture filtering, not a live search service.

Source quick switches (for example Google Drive and Slack) are additive until explicitly cleared. **All Time** offers 24 hours/week/month/year presets; source, timestamp and tag filters constrain fixture results. Tag suggestions read the valid-tags endpoint with `match_pattern`; loading can replace/remount dropdown content while the menu stays open. Wait for the actual option after loading, then select it. Empty suggestions are distinct from empty search results. Pagination needs enough staged documents and a loaded next page; an early spinner is not completion.

In chat, `[data-testid="action-management-toggle"]` opens actions. **Internal Search** → **Search Filters** exposes Enable All, Disable All and vendor toggles. These choices affect eligible scripted docs and an authored no-sources response; they do not grant or prove actual source permissions. URL controls `sources`, `tags`, `from`, `to`, `user-prompt`, and `send-on-load=true` can stage a filtered native chat. Full navigation discards transient search-result UI; a saved default mode remains in the preference store.

## Share links and privacy

The header `[aria-label="share-chat-button"]` and a chat-row menuitem **Share** operate on the selected chat. In the modal, `share-modal-option-private` and `share-modal-option-public` select a **draft**. Cancel/Escape discard it. A private never-shared chat has a disabled submit action; merely choosing Public is not publication.

Submitting calls `PATCH /api/chat/chat-session/<id>` with `sharing_status: "public"` or `"private"`. The mock mutates that engine chat's sharing flag; the visible public URL is same-origin `/app/shared/<id>`. After publication, the submit/copy action copies the existing link rather than creating another chat. `share-modal-copy-link` changes to a check icon after a successful clipboard call; a button click alone does not establish clipboard permission. Making private revokes the public read route. Stage finite failures with `POST /api/mockshop/sharing-feedback/outcome`, for example `{ "operation": "share", "fail": true }` or operation `private`. On failure the committed sharing state is retained; show the error and retry explicitly rather than pretending the first choice saved.

A shared page reads the same saved engine via `is_shared=True`, including later saved turns. It is read-only: no editable composer, voting controls or ordinary Sources sidebar in this pin. Model attribution is noninteractive. **Start a new chat**/StartNewSession returns to ordinary chat. Revoked/missing links display **Shared chat not found**; a shared empty session displays **No messages found**. Recovery is a distinct operation, not a fallback that fabricates content.

Shared human text, assistant text, images, tables and saved attachments have their own copy/preview/download controls. Scope the intended message. Shared file accessibility in this local mock is not a security audit of a production public-link system. [Backend chat](backend-chat.md) describes its concrete lookup behavior and limits.

## Copy and feedback

`[data-testid="AgentMessage/copy-button"]` copies an answer and shows native success state; a shared human message's copy control is separate. Real browser clipboard permissions still apply.

Like/dislike invokes `POST /api/chat/create-chat-message-feedback` for the selected assistant message; removing a vote uses `DELETE /api/chat/remove-chat-message-feedback?chat_message_id=<id>`. The positive dialog accepts optional empty text. The negative dialog requires non-whitespace feedback; spaces alone must not enable successful submission. There is no reason-chip picker in this pinned UI. Cancel closes without saving, and reopening starts a clean draft. Submitting the opposite vote replaces the prior vote; clicking the already active vote toggles it off through the removal operation.

Finite `feedback` and `remove` outcomes can be staged at `/api/mockshop/sharing-feedback/outcome`. A failed submission/removal must preserve the previously committed vote; submission failure retains the editable modal draft. These are local feedback-store changes, not model training or a ticket sent to an external service. Navigation/reload and `keep:true` retain them. A fresh reset restores seeded feedback and private/public flags, removes future generated turns, and restores the original conversation tree. To author a reset demonstration, dirty all three independently before resetting; a new chat alone proves none of them.
