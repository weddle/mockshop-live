# Chat, search, sources and streaming

[API map](../API-MAP.md) · [Runtime/reset](backend-runtime.md) · [User files/projects](backend-user.md) · [Craft SSE](backend-craft.md)

Owners: `handlers.mjs`, `chat.mjs`, `chat-files.mjs`, `handlers-user-search.mjs`, `handlers-sharing-feedback.mjs`, `handlers-browser-extension.mjs`. All behavior here is source-derived.

## Root chat operations

Root owns the sole normal-chat tree in `state.chatSessions[org + ":" + sessionId]`. A session has `id,org,persona_id,nodes,description,created,updated?,model?,temperature?,project_id?,owner_name?,fromFixture?,stop?`. A node has `id,type:user|assistant,parent,message? or script,llm?,partial?,feedback?,files?,time,latestChildId?`. Do not implement another tree for feedback, files, extension or projects.

| Native operation / exact route | Request | Mutation and response/readback |
|---|---|---|
| New chat: `POST /chat/create-chat-session` | `{persona_id?,description?,project_id?}` | Allocates `00000000-0000-4000-8000-<12-digit counter>`, empty tree, current default model, project membership. Returns `{chat_session_id}`. Does not stream. |
| Send/edit/regenerate: `POST /chat/send-chat-message` | `{chat_session_id?,chat_session_info?:{persona_id,description,project_id},message,parent_message_id?,llm_override?,file_descriptors?,internal_search_filters?,allowed_tool_ids?,forced_tool_id?,origin?,additional_context?}` | Existing explicit ID must resolve or 404. Without ID creates session; saves user/assistant nodes before streaming. NDJSON protocol below. Other product request fields are not a reasoning/retrieval engine. |
| Stop: `POST /chat/stop-chat-session/:id` | No body needed | Sets materialized session `stop=true`; always `{}`. Does not materialize unseen history. Generator observes it during answer chunks and stores streamed partial text. |
| Model picker: `PUT /chat/update-chat-session-model` | `{chat_session_id,new_alternate_model}` | Materializes history if necessary, updates session `model`; `null` response; missing/deleted 404. Existing assistant `llm` snapshots unchanged. |
| Temperature: `PUT /chat/update-chat-session-temperature` | `{chat_session_id,temperature_override}` | Saves value or null; `null`; missing/deleted 404. Only readback metadata, not generated answer computation. |
| Auto-name/rename: `ANY /chat/rename-chat-session` | `{chat_session_id,name}` | Truthy name updates live description and org-scoped edit overlay; null auto-name returns script title/current description or `"New Chat"`. `{new_name}`. No existence validation for a supplied rename. |
| Delete one: `DELETE /chat/delete-chat-session/:id` | — | Tombstone in `state.edits`, removes live tree, `{}`; blocks fixture rematerialization. |
| Delete all: `DELETE /chat/delete-all-chat-sessions` | — | Removes active-org live trees, sets `deletedAll[org]`; `{}`. Does not delete other orgs or fixture files. |
| Sidebar: `GET /chat/get-user-chat-sessions` | Fixture-backed read | Transform merges current-org live chats newest-creation-first plus fixture histories; applies rename/delete/sharing/project/model/updated time; excludes project-associated chats. `has_more` remains seed metadata. Explicit screen sidebar mask controls order/visibility. |
| Open/reopen/shared: `GET /chat/get-chat-session/:id` | `?is_shared=true` optionally | `sessionFromNodes()` DTO described below, decorated by projects/sharing/screen selections. Shared reads require public status; otherwise 404. Ordinary read is not an authorization boundary. |
| Search Chats: `GET /chat/search` | `?query=<substring>` | Searches sidebar names and `message` strings of already materialized nodes; not unopened history or assistant script answers. Returns `{groups:[{title,chats}],has_more:false,next_page:null}` with Today / Previous 7 Days / Previous 30 Days / Older based on demo time. |
| Select older sibling: `PUT /chat/set-message-as-latest` | `{message_id}` | Extension module delegates `markMessageLatest()` to root; updates ancestor `latestChildId` and `latestRootId` in current-org tree. `null`; unknown ID 404. Shared by main app and NRF. |
| Prepared status: `GET /mockshop/turn/:id` | — | `{status:"armed"|"streaming"|"complete"|"stopped",session}` or 404 if not armed in this org. Control-plane arm is detailed in runtime docs. |

Backend `complete` means the NDJSON send finished, not that React has committed the completed answer. Compiled `send` polls up to 60 seconds at 100 ms intervals and requires both the exact prepared turn's `status:"complete"` and the **newest** `[id^="message-"]` wrapper containing `[data-testid="onyx-ai-message"]`. The native marker appears only when that answer is complete. Selecting the last completed marker alone can match the previous reply while the newest wrapper is still incomplete. New live wrappers use optimistic negative client IDs; backend IDs become wrapper IDs after restore, so the compiler does not target a live `#message-<backend id>`. The status API remains `{status,session}`; it has no message-ID field. A supplied `send.wait` runs afterward as an additional assertion, not instead of completion.

### Branching and model selection

- `parent_message_id:null` means first user message or edit of the first user message. An assistant parent means normal follow-up or edit after that answer. A **user** parent means regeneration: reuse that user node, add a sibling assistant, and use its saved files rather than the cleared composer request.
- `historyTo()` walks only the selected parent chain, returning previous `{message,script}` turns oldest first. Editing creates siblings; it never destroys old nodes. A missing parent ID is treated like a null parent, not explicitly rejected.
- Regeneration chooses `script.regenerate[(existing answer count - 1) % length]` when available. Otherwise it repeats the selected prepared answer. Same-model answers remain alternatives due to patch 0014; different model tags can form native multi-model panels. No backend multi-provider fan-out exists: each send creates one assistant node.
- `markMessageLatest()` runs after adding an assistant. Saved selections survive reopen through `latestRootId` and parent `latestChildId`, including first-user siblings.
- Model descriptor: `Provider display name__provider__model[__mc:<id>]`. `modelOverride()` uses first segment as provider identity, joins model segments from index 2 (so names containing `__` survive), and parses trailing `mc:` ID. `answerModel()` resolves configuration ID first, then provider name/type + canonical model name, then catalog `default_text`. Display label uses `custom_display_name || display_name || name`.
- Provider authority is Save Controls' live catalog plus Admin Pages defaults. Root session default precedence is explicit screen model, saved `/user/default-model`, then fixture `/me.preferences.default_model`. `llm_override` on a send wins over session descriptor. Assistant node freezes `model_provider,model_version,model_configuration_id,display_name`; later picker/default edits cannot relabel it.
- Persona provider route currently exposes the same public catalog for every ID; per-persona provider restriction is not implemented. Temperature/reasoning preferences do not compute text. Saved detail `current_reasoning_effort_override` is always null.

## Reply selection and provenance

`pickScript(dirs,message,parse,history,model)` scans active layers highest first and YAML filenames sorted within each layer:

1. Files with `turn` are ignored for manual browsing.
2. First case-insensitive `match` regex wins if `after` is absent or matches **any earlier** user message/script title.
3. Otherwise the first `follow_up_default:true` with nonempty history wins, then first `default:true`.
4. Without any fallback: `answer:"No prepared answer is available for this question.",documents:[]`.

`withContext()` shallow-merges `model_variants[canonical model_version]`, then substitutes only `title`, `answer` and each `regenerate` string for `{{prev.title}}`, `{{prev.message}}`, `{{first.title}}`, `{{first.message}}`. It does not recursively template reasoning/documents. Native variant overrides use `answer/documents/citations` fields: the adapter converts outer high-level `{text,cites}` but does not recursively compile a model variant's `text/cites` shorthand.

Normal send selection order: root match/model/context → User Search override → extension override → regeneration alternate → known-file override. Known-file response wins over ordinary search/extension content. Exact armed sends bypass regex selection, search/extension error/content hooks and file-answer override, but apply the same `withContext()` model-variant and saved-branch context projection before regeneration/storage. Exact question/session mismatch returns409 before consumption; successful match consumes the arm once. Missing prepared files throw rather than silently selecting a fallback. An arm consumed before a later missing-session failure is not restored.

A world reply may declare `turn:<key>` and `question:<exact submitted text>`. An adjacent `state:{turn:<key>,keep:true,resetChats:false}` arms it without typing, clicking or waiting; the following native click/Enter submits it. This preserves authored typed-question/stream/Stop stages. The reply belongs to the selected complete world. Search mode, known-file grounding and extension context/error demonstrations should retain handler-owned manual selection so exact arming does not bypass their demonstrated behavior.

History loading: `GET /chat/get-user-chat-sessions.sessions` supplies metadata; `history/<session id>.yaml` supplies `turns:[{message,script?,files?}]`. If no file exists, Sharing seed turns may supply it; otherwise one user question equal to the history name is answered by normal matching. Explicit history inline scripts use `withContext()`. Only materializing assigns real message IDs. Shared seed answers keep their prepared document inventory; ordinary file histories may be replaced by known-file grounding. Editing a fixture file later does not rewrite already materialized node snapshots.

## NDJSON wire protocol

`core.streamNdjson()` sends status 200, `content-type:text/plain; charset=utf-8`, `cache-control:no-cache`; one JSON object plus `\n` per packet. **This is not SSE.** `buildChatStream()` emits:

| Sequence | Packet and timing |
|---|---|
| IDs | `{user_message_id,reserved_assistant_message_id}`; root adds `user_files` when saved user descriptors exist. No created-session ID is added by this generator despite unused `sessionId/isNew` options; native flow normally creates session first. |
| Optional reasoning | At placement `{turn_index:0,tab_index:0}`, `obj:{type:"reasoning_start"}` after 150 ms; chunks of 40 characters as `reasoning_delta` with `reasoning`; then `reasoning_done`. Advances turn. |
| Optional search | If documents exist **or `queries` is truthy**, `search_tool_start{is_internet_search:web_search===true}`, `search_tool_queries_delta{queries}`, optional `search_tool_documents_delta{documents}`, `section_end`. First delay 200 ms, each later packet 250 ms. Advances turn. Empty array is truthy and can still stage this section. |
| Optional web search | Compiled `web_search:{queries,documents}` (object, not the `true` flag): `search_tool_start{is_internet_search:true}`, `search_tool_queries_delta`, `search_tool_documents_delta` (internet SearchDocs `WEB_SEARCH_DOC_<url>`, `source_type:"web"`, `is_internet:true`, link = URL, score `1/(rank+1)`), `section_end`. Advances turn. |
| Optional open URL | Compiled `open_url:{urls,documents}`: `open_url_start`, `open_url_urls{urls}`, `open_url_documents{documents}` (crawled pages: `is_internet:false`, blurb = title), `section_end`. Advances turn. |
| Optional code | Compiled `code:{source,stdout,stderr,files:[{id,name}]}`: live `tool_call_argument_delta{tool_type:"run_python",argument_deltas:{code}}` in 48-character chunks, `python_tool_start{code}`, `python_tool_delta{stdout}`, optional `python_tool_delta{stderr}`, optional `python_tool_delta{file_ids}`, `section_end`. Replay (create_python_tool_packets) is start, one delta with stdout/stderr/file_ids, `section_end`. Advances turn. |
| Answer start | Placement at next turn; `message_start{final_documents:all docs (internal, web, opened; unique by id) or null,pre_answer_processing_seconds:2.4}` after 200 ms. |
| Answer chunks | `message_delta{content}` in 24-character chunks. Delay `script.chunk_delay_ms ?? 12`. Root tracks emitted text via `onText`. |
| Citations | `citation_info{citation_number,document_id}` once per citation number actually found in answer. |
| Complete | Placed `stop{stop_reason:"finished"}`, then unplaced `{message_id,citations,files:[],overridden_model,model_display_name}`. |
| Stop during answer | Placed `stop{stop_reason:"user_cancelled"}`, then unplaced metadata with empty citations; root saves `agent.partial=sofar`. Stop checks are inside answer chunk loop, not reasoning/search delays. |

A response disconnect is checked by core before writes and by root's generator stop callback. Source caveat: `agent.partial`/prepared status depend on the generator reaching its stopped callback; a disconnect during an earlier delay need not be classified identically to pressing Stop. No runtime proof of every disconnect phase is claimed.

### Search-document/citation shape

`toSearchDoc()` maps authored `{id,title,source,link?,blurb?,metadata?,score?,highlights?,updated?,owners?,is_internet?,external?}` to:

`{document_id,chunk_ind:0,semantic_identifier,link,blurb,source_type,boost:0,hidden:false,metadata,score,is_relevant:null,relevance_explanation:null,match_highlights,updated_at,primary_owners,secondary_owners:null,is_internet,file_id:null,db_doc_id:9000+index}`.

Default score is `0.92 - index*0.04`; default highlights `[blurb]`. `[1]` and `[1, 2]` in answer become native `[[1]](url)` links (already Markdown links are excluded). Explicit `citations:{1:documentId}` overrides positional document lookup; only cited numbers are returned. Adapter validates high-level citation bounds, but raw native script fixtures can have missing IDs/empty citation URLs; do not assume runtime validation.

`sourceLink()` returns null for `file` or `user_file`, original `link` for `external:true`, otherwise `/api/mockshop/source/<encoded id>`.

### Saved chat DTO

`sessionFromNodes()` emits all real messages in creation order, plus system message ID **-3** with `latest_child_message` for root selection. Each message includes `chat_session_id,message_id,parent_message,latest_child_message,time_sent,files,error:null,current_feedback,preferred_response_id:null`. User messages have text and null context/citations/model. Assistant messages include rendered text, reasoning, context docs/citations, `processing_duration_seconds:6.2`, frozen model fields. Session includes `chat_session_id,description,persona_id,persona_name:null,personal_icon_name:null,messages,time_created,shared_status,current_alternate_model,current_temperature_override,current_reasoning_effort_override:null,deleted:false,owner_name,packets,current_stream:null,incognito:false`.

`packets` is one replay packet array per assistant, not per message. Replay uses whole reasoning/answer strings with `section_end` boundaries; partial answers have empty citations and `user_cancelled`. Therefore replay packet sequence differs from the live chunk sequence by design. File/project/sharing decorators add their existing owner data, not parallel saved responses.

## Sources and previews

| Route | Lookup and response |
|---|---|
| `GET /mockshop/source/:id` | Extension document → Search seed → all chat/history scripts and their model variants. First matching document wins. Returns escaped local HTML title/vendor/owners/date/blurb and source body. 404 HTML if absent. |
| `GET /chat/file/:id` | Known uploaded synthetic file owner first. Root then serves a generated code-step file from `chat-files/<id>` (+ `<id>.json` name and headers) of the active layers, with the backend's `resolve_inline_disposition` policy: PNG/JPEG/GIF/WebP/PDF/plain text inline with their type, anything else (including `.xlsx`/`.docx`) `application/octet-stream` attachment; `?parsed=true` on a file with an authored `parsed_preview` returns that JSON (`application/json`), otherwise the bytes; `nosniff` and `sandbox` CSP. Then it checks `sources/<id>.md` and `sources/FILE__<id>.md`; absent falls through. Markdown with inline filename (title or `<id>.md`). |

Source body lookup: extension → Search → source directories highest layer first. Root filename accepts `^[\w.-]+$` but additionally rejects any ID containing `..`; the adapter's safe-ID check only rejects literal `.`/`..`, so avoid embedded double dots too. Viewer Markdown supports headings 1–3 rendered as h2–h4, unordered/numbered lists, bold and paragraphs; it is not a general Markdown renderer. It does not fetch original URLs. File citation IDs such as `FILE__<name>` or user-file `project_file__<backing file id>` trigger native preview behavior.

## Search

Owner reads `/mockshop/user-search-seed` on every call: `documents,tags,chat_query_match,auto_search_match,empty_query_match,error_query_match,error_text,search_delay_ms,chat_title,answer_intro,empty_answer`. Document requires `id,title,source,blurb,tags,owners,updated,content` and optionally `score,metadata,document_sets,link`.

| Route | Request → behavior/response |
|---|---|
| `GET /query/valid-tags` | `?match_pattern` case-insensitive substring of `tag_key + tag_value`; `{tags:[...]}`. |
| `POST /search/search-flow-classification` | `{user_query}` → regex `auto_search_match`; `{is_search_flow:boolean}`. Patch-independent local classification, no model. |
| `POST /search/send-search-message` | `{search_query,filters?,num_hits?,include_content?}`; waits seeded delay, tests error regex, filters documents then `.slice(0,num_hits ?? 30)`; `{all_executed_queries:[query],search_docs,doc_selection_reasoning:null,llm_selected_doc_ids:[first doc ID] or [],error}`. Intentional search error is **HTTP 200 with error text**, not a suppressed 500. |

Filters: `source_type` requires membership (even explicit empty array rejects all); `document_set` is OR of named document-set membership; inclusive `updated_at_range.start/end`; `tags` is OR of exact `tag_key/tag_value` pairs. Query text itself does **not** rank or match documents except the configured empty/error regexes. No server pagination/search-session state exists.

`selectChatScript()` activates when any internal filter is supplied, forced SearchTool ID is selected, or chat regex matches. SearchTool ID comes from fixture `/tool.in_code_tool_id:"SearchTool"` or fallback 1. Explicit `allowed_tool_ids` excluding it disables documents/queries. Otherwise answer cites first three filtered docs, while full document set enters stream. Search response DTO differs slightly from chat: `is_relevant:true`, `secondary_owners:[]`, optional content, metadata tags derived from tag values. UI result counts are fixture filtering, not retrieval evidence.

## Sharing and feedback

`state.sharingFeedback={shares,feedback,failNext}`; share/feedback keys include org. Session seeds come from `/mockshop/sharing-feedback/seeds.sessions` with ordinary sidebar metadata plus `turns,owner_name`; errors keyed `share,private,feedback,remove`. Root owns the actual nodes and read serialization.

| Button/API | Payload | Mutation/response |
|---|---|---|
| Share / make private: `PATCH /chat/chat-session/:id` | `{sharing_status:"public"|"private"}` | Requires existing resolvable session; sets share override; `null`. Invalid status 400; missing 404. Sidebar/detail immediately reflect status; `?is_shared=true` only permits public. No internet publishing/access token created. |
| Like/dislike: `POST /chat/create-chat-message-feedback` | `{chat_message_id,is_positive,feedback_text?,predefined_feedback?}` | Finds materialized current-org assistant; node feedback `"like"` or `"dislike"`, supplemental text in shared store; `null`, missing404. Admin analytics fixtures are not recomputed. |
| Remove vote: `DELETE /chat/remove-chat-message-feedback` | `?chat_message_id` | Sets node feedback null, deletes supplemental record; `null`, missing404. |
| Stage rollback/toast: `POST /mockshop/sharing-feedback/outcome` | `{operation:"share"|"private"|"feedback"|"remove",fail:true|false}` | Sets one fail-next flag; next matching valid operation consumes it and returns 400 seeded detail **before mutation**; staging returns null. Invalid operation400. |

Keep semantics are in runtime matrix. `resetChats:true` or non-keep clears shares/votes and node feedback; world keep retains org-keyed state. Fail-next flags themselves are operation-keyed rather than org-keyed.

## Browser extension

Seed `/mockshop/browser-extension/seed` has `active_tab,tabs:{key:{title,url,content}},script:{match,title,chunk_delay_ms,answer,disabled_answer,regenerate,error}`. Own state is lazy copied tabs + `failNext`; fresh/world-change reset clears it. No extension installation, browser navigation, or MessageEvent authentication happens on the backend.

| Route/function | Exact behavior |
|---|---|
| `GET /mockshop/browser-extension/context` | Returns mutable `{active_tab,tabs}`. |
| `PATCH /mockshop/browser-extension/context` | Accepts valid existing `active_tab`; updates string `title,url,content` for existing tab keys only; returns full context. Does not add tabs or navigate browser. |
| `POST /mockshop/browser-extension/outcome` | `{fail:true}` arms next matching request; `{fail:false}` clears; returns null. |
| `takeSendError(body)` | Match requires `origin:"chrome_extension"` and message regex. Returns seeded `{error,stack_trace,error_code,is_retryable}` as one HTTP200 NDJSON packet before session/node mutation; one-shot. |
| `selectChatScript(script,body)` | Same match; compares `additional_context` exactly to `The user is currently viewing: <url>. Use the open_url tool to read this page and use its content as additional context for your response.` against **any** known tab. Selected `active_tab` alone is not the match criterion. |

A matching context supplies one fictional `NRF-TAB-<key>` web document, substitutes `{{tab.title|url|content}}` in answer, and allows local viewer body. Missing/disabled/waiting/unrecognized context uses `disabled_answer` and no docs. The backend cannot establish that context originated from a trusted parent window; native NRF origin/source guards remain intact. Patch 0006 wires its real message selection callback; patch 0013 keeps provider-configuration CTA clear of footer.

## Minimal operating recipes

1. **Deterministic cited answer:** define shared source/document (including body); `send.reply:{text:"Finding [1]",cites:[document-key],queries:["search phrase"]}`. Generated source viewer needs no external host. For manual browsing, define a reply `match` or `default`; exact send never becomes that fallback.
2. **Branch demo:** create/send first turn; capture actual message IDs from engine readback or native UI; regenerate by user parent; follow up by selected assistant parent; use native previous/next selection (`set-message-as-latest`) before reopen. Do not assume fixed message IDs after histories have materialized.
3. **Stable model comparison:** seed both visible model configurations in admin catalog; submit model-specific `llm_override`/picker action; normal fallback scripts use canonical model names in `model_variants`. For exact sends author exact text per step. Assert saved answer model, not current composer label.
4. **Search empty/error/filter:** configure nonmatching regexes with `(?!)` until needed, and complete tag/document rows. Use dedicated HTTP200 error field for SearchUI's failure card; use strict expected-error policy separately for intentional failing HTTP routes.
5. **Shared review:** seed/materialize history, PATCH public, open native shared URL, vote on its real assistant ID. Make private and shared detail becomes 404, while ordinary owner detail remains readable. These are local UI semantics, not access-control proof.
