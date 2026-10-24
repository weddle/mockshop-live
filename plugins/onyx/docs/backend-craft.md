# Craft backend operating contract

[API map](../API-MAP.md) · [Runtime/reset](backend-runtime.md) · [Admin apps/MCP/providers](backend-admin.md) · [Shared file bytes](backend-user.md#files)

Owner: `handlers-user-craft.mjs`, with explicit callbacks into Admin Pages (apps), MCP (servers), Save Controls/Admin Pages (providers), Users/Groups (sharing candidates), Files (bytes) and root (web origin). This is source-derived behavior of a finite fictional UI backend, **not** a sandbox, scheduler, external-app execution or provider engine.

## Required seeds and state ownership

`GET /mockshop/user-craft` is the single Craft seed object. Lazy local state:
`{skills,tasks,runs,sessions,library,credentials,turns:{},approvals,sequence:0,views:{},connections:{},appAssociations:{}}`.
`reset({keep:false})` clears it. Same-world keep retains; root forces reset on a whole-world/overlay namespace change even with keep. IDs allocated by any operation share one sequence: `craft-<kind>-N` (skill/task/session/run/message/turn/approval/connect-request/library).

| Seed field | Shape / consumers |
|---|---|
| `skills` | `{builtins:[skill],customs:[skill]}`. Row: `id,name,description,instructions_markdown,source,is_available,unavailable_reason,is_valid,enabled,can_toggle,author_user_id,author_email,owner:{id,email},ownership_vacant,created_at,updated_at,user_shares,group_shares,public_permission,user_permission,files:[{path,size}],external_app?`. |
| `skill_defaults` | Complete native default fields above, used for new custom/imported skills. Neutral base's flags are false/blank, so set valid/available/toggle/permission metadata deliberately for a create demo. |
| `upload_bundle` | `{name,description,instructions_markdown,files}` canned result for inspecting/importing a nonempty `SKILL.md`/ZIP upload. File bytes never parsed/executed. |
| `github` | `{repository,revision,subpath,skills:[{path,name,description,unavailable_reason?...}]}`. Only exact repository allowed offline. |
| `credentials` | Map by Admin Pages app ID: `{authenticated,values,supports_oauth?}`. Seed supports_oauth determines native button even after live credential changes. |
| `session_defaults`, `sessions` | Defaults and seeded rows: `name,status,nextjs_port,sandbox:{id,status,container_id,created_at,last_heartbeat},sharing_scope,origin,agent_provider,agent_model,skills_stale,artifacts`; seeded sessions also `id,user_id,created_at,last_activity_at,messages?,files?,scheduled_run_context?`. |
| `tasks`, `runs` | Native task rows and map task ID→run array. Task fields in scheduling section. Runs: `id,status,trigger_source,started_at,finished_at,session_id,summary,skip_reason,error_class`. |
| `approvals` | `{approval_id,session_id,actions:[{action_type,display_name,description,policy}],app_name,payload,display_payload,created_at,decision,decided_at,is_live}`. Packet approval IDs reference these templates. |
| `turn_packets`, `answer`, `packet_delay_ms` | Finite raw SSE packet inventory, final saved assistant answer, per-packet real-time wait. Packet kinds below. |
| `output_artifacts` | `{id,type,path,name,preview_url?}`; session/timestamps added at completion/run-now. |
| `output_files` | `{path,size,mime_type,content? ,shared_file_id? ,fixture_bytes?}`. Raw text, backing Files catalog ID, or seed field containing base64. |
| `webapp_info`, `preview_html` | `{has_webapp,webapp_url,status,ready}` + local HTML; not deployment. Relative URL becomes web origin after artifacts exist. |
| `downloads` | `{docx_file_id,pdf_file_id,image_file_id}` backing IDs in Files catalog; XLSX upload uses literal `demo-xlsx`. |
| `presentation_base64`, `archive_base64`, `pptx_preview` | Real preauthored bytes; `{slide_count,slide_paths,cached}` describes separate preauthored slide images. Not converted from uploaded file. |
| `library`, `library_zip_entries` | Flat native library metadata rows; ZIP upload appends canned entries, not archive extraction. |
| `fake_credential,next_run_at,oauth_delay_ms,generated_name,task_output,upload_text` | Fictional secret replacement, fixed next occurrence(s), local delays, generated title/output/upload placeholder text. |

Visibility also depends on raw `/me.craft_enabled` and `/settings.onyx_craft_enabled,onyx_craft_available` plus built native UI gates. Model picker uses live provider catalog; apps use actual Admin Pages catalog and its built-in options, not a copied Craft app list. No provider selected → prompt400.

## Skills

`listSkills()` reconciles current Admin Pages app associations, then projects `external_app` from associated app and readiness; `is_personal` derives from no public/user/group sharing. `stale()` marks **all** current Craft sessions `skills_stale:true` after skill/app/credential writes.

| Native control / route | Input → mutation and response |
|---|---|
| `GET /skills` | `{builtins,customs}` projected current skills. Static `/skills` fixture itself is not the source; `/mockshop/user-craft.skills` is. |
| `GET /skills/:id/preview` | Any known skill view;404 unknown. |
| `GET /skills/custom/:id/edit` | Custom only;404 unknown. |
| Inspect bundle: `POST /skills/custom/bundle/inspect` | Multipart `upload` nonempty file; returns canned upload_bundle. Other filename than ZIP or exact case-insensitive SKILL.md changes files list to `{path:filename,size}`;400 no nonempty file. |
| Create: `POST /skills/custom/editor` | Multipart `name,description,instructions_markdown,upload?,external_app_id?,auto_enable?`. Name `^[a-z0-9]+(?:-[a-z0-9]+)*$`, nonblank description/instructions or400. App must exist404. Duplicate enabled name (unless auto_enable exactly "false") or same-name app-associated skill →400 `error_code:SKILL_NAME_CONFLICT`. Creates custom skill owned/authored by raw fixture user; external app sets public_permission VIEWER and adds association. Returns view. |
| Enable/replace: `PUT /skills/:id/enabled` | `{enabled,replace_conflict?}`. Enabling duplicate name without replacement400 conflict; replacement disables all same-name skills first; saves enabled, stale, returns view. Does not enforce can_toggle/is_available server-side. |
| Save edit: `PATCH /skills/custom/:id` | `{description,instructions_markdown}` both nonblank or400; trims, updated_at, stale; returns view. Name immutable on this route. |
| Add/replace file: `POST /skills/custom/:id/files` | Multipart nonempty `upload`. ZIP/SKILL.md applies canned bundle only if name matches current skill (400 otherwise); other file replaces same path metadata. Saves updated_at/stale; view. |
| Remove file: `DELETE /skills/custom/:id/files` | `?path`; filters exact supporting-file path, stale; view. |
| Share: `PATCH /skills/custom/:id/share` | `user_shares:[{user_id,permission}]`, `group_shares:[{group_id,permission}]`, optional public_permission. Users use live accepted-users callback and unknown users drop; groups use live minimal Groups, unresolved name falls back `Group <id>`. Saves shares, stale; view. |
| Transfer: `POST /skills/custom/:id/transfer-ownership` | `{new_owner_user_id}` live accepted user,400 absent; sets owner,user_permission:EDITOR,vacancy:false; retains previous viewer as explicit EDITOR share if different; stale; view. |
| Delete: `DELETE /skills/custom/:id` | Custom required404; removes skill, reconciles app summaries, stale; null. |
| GitHub preview: `POST /skills/github/preview` | `{repository}` must equal seed.github.repository,400 otherwise; returns entire prepared github descriptor. No GitHub request. |
| GitHub import: `POST /skills/github/import` | `{repository,paths:[]}` exact repo required; each available prepared path makes new custom skill, instructions from upload_bundle; duplicate enabled name imports **disabled**. Returns `{imported:[{skill,disabled_reason}],not_imported:[{path,name,reason}]}`; stale. |

All missing skill IDs404. UI flags/ownership/share permissions are metadata, not full backend authorization. `newSkill()` overlays defaults and chosen fields; author/viewer comes from raw `/me`, not Auth's simulated identity. New `is_valid` comes from skill_defaults, so empty neutral base is not enough to show a valid created skill.

## Apps, dependencies and MCP cards

| Route / action | Input → actual effect |
|---|---|
| `GET /build/apps` | Enabled Admin Pages apps only, projected `{id,name,app_type,credential_keys,credential_values,authenticated,supports_oauth}`. Missing keys are auth-template placeholders not already supplied by organization_credentials. |
| `POST /build/apps/:id/credentials` | `{user_credentials:{key:value}}`; requires each missing key nonblank400; stores `{authenticated:true,values:{key:seed.fake_credential}}`, stale; null. Does not contact app. |
| `DELETE /build/apps/:id/credentials` | Known admin app required404; sets authenticated:false,values:{}, stale; null. |
| `GET /build/apps/:id/oauth/start` | Known app404; `{authorize_url:"/craft/v1/apps/oauth/callback?code=mockshop-craft-only&state=<app id>"}`. Same-origin native callback only. |
| `POST /build/apps/oauth/callback` | `{state:<app id>,code:"mockshop-craft-only"}`;400 mismatch; waits seeded OAuth delay; sets authenticated/supports_oauth true, values:{}; stale; `{success:true,external_app_id}`. |
| `GET /mcp/servers/craft` | `{mcp_servers}` from live MCP owner filtered available_in_craft. `craft_connected` uses MCP status/auth rule, not Craft credential state. |
| `POST /build/apps/connect/:id/decision` | Request ID, not app ID. `{decision:"connected"|"declined"}`; invalid400; saves connections[requestId]. Walks stored message_metadata.streamItems, removes matching connect_app_request items and empty request-only rows; null. Does not itself authenticate app or unblock an execution engine. |

`reconcileApps()` rebuilds associated_skills from actual skill IDs, recomputes sorted credential_placeholder_keys by scanning auth_template values for `{identifier}`, remembers appAssociations. Deleting an app disables formerly associated skills, deletes user credentials, marks sessions stale. Admin writes with `associated_skill_ids` preserve associated builtins and choose current custom skills; chosen custom skills gain VIEWER public_permission. `skillView.external_app={external_app_id,name,enabled,ready}` uses app enabled plus explicit user authenticated state or every organization credential key present. Stale is a UI refresh indicator, not sandbox syncing.

## Scheduled tasks

`tasks` and `runs` are separate from root chat; no timers execute tasks. `schedule()` derives a cron **string**, not a cron scheduler:

| `editor_mode` | `editor_payload` | Rule |
|---|---|---|
| `interval` | `{every,unit:"minutes"|"hours"}` | Integer1–59 minutes → `*/N * * * *`;1–23 hours → `0 */N * * *`; other invalid |
| `daily_weekly` | `{time_of_day:"HH:MM",weekdays?:[]}` | Two digits each, hour≤23/minute≤59; sorted weekday values or `*`; weekday range not validated |
| `advanced` | `{cron}` | Trimmed string with exactly five whitespace-separated fields; semantic cron validity not checked |

| Route / button | Input → behavior |
|---|---|
| `GET /build/scheduled-tasks` | `{items:tasks}` |
| `POST /build/scheduled-tasks` | `{name,prompt,editor_mode,editor_payload,status?,run_immediately?,pre_approved_app_ids?,pre_approved_mcp_server_ids?,...}`; valid cron/nonblank name/prompt or400. Stores full body + ID,status default ACTIVE,cron_expression,human_readable_schedule (same cron), fixed seed next_run_at/next_runs,last_run:null,timestamps; optionally runTask immediately; row. |
| `GET /build/scheduled-tasks/:id` | Task or404. |
| `PATCH /build/scheduled-tasks/:id` | Partial body; recompute cron only when editor_payload supplied; name/prompt if supplied must nonblank. Merge body/update time; PAUSED clears next_run_at/next_runs, otherwise seeded fixed date. Returns row. `human_readable_schedule` is not automatically recomputed here unless supplied. |
| `DELETE /build/scheduled-tasks/:id` | Known required404; removes task only; null. Existing run/session records remain. |
| Run now: `POST /build/scheduled-tasks/:id/run-now` | Known task → immediate successful finite `runTask`; `{run_id,status:"SUCCEEDED"}`. No status/preapproval/provider scheduling validation. |
| `GET /build/scheduled-tasks/:id/runs` | `?cursor=<numeric offset>&limit=20`; `{items,next_cursor:string|null}`. Known task without runs→empty; unknown task without run entry404; retained run map can still read after task delete. |

`runTask()` creates session origin SCHEDULED, run `trigger_source:"MANUAL_RUN_NOW"`, start/finish same demo time, summary `task_output`, skip_reason/error_class null, saves one assistant message and copied output artifacts/files; adds scheduled_run_context; unshifts run and sets task.last_run. `run_immediately` uses this same MANUAL_RUN_NOW source. Preapproval arrays are persisted/displayed but do not enforce tool execution. Prepared failure/skipped run cards must be seeded explicitly; Run Now does not synthesize them.

## Sessions and finite SSE turns

| Route / native action | Contract |
|---|---|
| `GET /build/sessions` | `{sessions}` excludes empty sessions named exactly "Fresh Craft"; returns all other rows in stored order with session_loaded_in_sandbox:boolean (`sandbox.status === "running"`). |
| `POST /build/sessions` | `{name?}` creates from session_defaults + id/user/times, origin INTERACTIVE, empty artifacts/files; default name Fresh Craft; session view. |
| `GET /build/sessions/:id` | Session view404 unknown. |
| `POST /build/sessions/:id/restore` | Sets skills_stale:false, sandbox.status:running; session view. No real sandbox. |
| `POST /build/sessions/:id/skills/reload` | Same mutation; `{skills_stale:false}`. |
| `GET /build/sessions/:id/sandbox-status` | `{status:session.sandbox.status}`;404 absent. |
| `GET /build/sessions/:id/pre-provisioned-check` | `{valid,session_id}`; valid iff known and zero messages. Unknown returns valid:false/null, not404. |
| `GET /build/sessions/:id/messages` | `{messages}` native saved rows;404 absent. |
| `POST /build/sessions/:id/generate-name` | Sets seed.generated_name; `{name}`; ignores prompt semantics. |
| `PUT /build/sessions/:id/name` | `{name}` trimmed nonblank400; saves; null. |
| `PATCH /build/sessions/:id/public` | `{sharing_scope}` stores unvalidated value; `{session_id,sharing_scope}`. No publication service. |
| `DELETE /build/sessions/:id` | Removes session + turns[sessionId]; null. Does not cascade approvals/task-run metadata/library. |
| `POST /build/sessions/:id/send-message` | `{content,provider_id?,model?,attachments?}` nonblank400; resolves live catalog provider by explicit ID, default_craft, then default_text; missing provider400. Stores agent_provider/provider type and model (explicit/default_craft/default_text), user message and copied packet turn. Returns `{turn_id,session_id,turn_index,status:"RUNNING",packets}`. This POST does **not** itself stream. |
| `GET /build/sessions/:id/turns/active` | Current RUNNING turn or null. Only one current turn per session; later send replaces it. |
| `POST /build/sessions/:id/interrupt` | Current turn.status=CANCELLED if present; null even absent. |
| `GET /build/sessions/:id/turns/:turn/events` | Must match current session+turn IDs404 otherwise; SSE sequence below. |
| `GET /build/sessions/:id/scheduled-run-context` | Stored context or null, even unknown session. |
| `GET /build/sessions/:id/scheduled-run-events` | Fixed SSE `event: message\ndata: {"type":"prompt_response"}\n\n`, no session validation. |

Provider fallback can choose a valid default when an explicit provider ID is unknown; model membership/capability is not validated. Attachments are retained as provided in user message metadata; separate upload route creates file metadata. Saved user message:
`{id,session_id,turn_index,type:"user",content,created_at,message_metadata:{type:"user_message",content:{type:"text",text:content},attachments}}`.

### SSE protocol and replay

Events GET sends 200 `content-type:text/event-stream,cache-control:no-cache`. Each authored packet is emitted as `event: message\ndata: <JSON>\n\n`, then waits `packet_delay_ms`. There is no NDJSON placement wrapper. Before sending, the POST:

- Copies `turn_packets` and rewrites `parent_session_id:"$session"` / `_meta.parentSessionId:"$session"` to current session ID.
- For `approval_requested`, clones matching approval template to new live approval ID, session, null decision/time; packet receives new ID and session_id. If template missing, packet's referenced ID remains but cannot be resolved by approval API.
- Gives every `connect_app_request` a fresh request_id. It does not change external_app_id.

Events loop exits if reset replaced `data`, turn no longer RUNNING or response destroyed. A completed `tool_call_progress` with `kind:"edit"` publishes matching seeded output file at `raw_input.filePath` **before** packet emission, so native file auto-open can fetch it immediately. Other tool events do not execute anything.

All packet kinds except `agent_message_chunk`, `context_usage`, `artifact_created` are saved as assistant message rows with full `message_metadata:packet` and `content:packet.content?.text || ""`. If data still current and status RUNNING after loop, it marks SUCCEEDED, adds final assistant `seed.answer`, replaces artifacts with seeded output + session/times, replaces output files while retaining `user_uploaded_files/` entries, emits terminal `{type:"prompt_response"}` and ends. Approved/rejected actions do not gate packet progress. Interrupted turns retain prior saved packet rows but do not append final answer/artifacts. Source caveat: a destroyed response can break the loop while status stays RUNNING; completion condition then still permits success mutation. Do not claim disconnect cancellation semantics without observation. Reopening reads stored messages; this is not persistent event replay with cursors.

### Prepared packet vocabulary

The handler forwards arbitrary authored packets; these native shapes appear in the source seeds and must be kept coherent with outputs/approvals. There is no validator proving every possible packet is supported by pinned frontend.

| Packet `type` | Fields / intended native rendering |
|---|---|
| `agent_thought_chunk` | `content:{type:"text",text}` reasoning/thought text |
| `tool_call_start` | `tool_call_id,tool_name,title,kind,raw_input,content`; edit content `[{type:"diff",path,oldText,newText}]` |
| `tool_call_progress` | `tool_call_id,tool_name,status,kind,raw_input,raw_output,content?`; edit `raw_input.filePath`; todowrite `raw_input.todos:[{content,status,priority}]`; task `description,subagent_type,prompt` and `_meta.subagentSessionId` |
| `subagent_started` | `subagent_session_id,parent_session_id` (supports `$session` marker) |
| `agent_message_chunk` | `content:{type:"text",text}`; optional `_meta:{sessionId,parentSessionId}` for nested presentation |
| `connect_app_request` | `request_id,external_app_id,reason`; request ID rewritten at send |
| `approval_requested` | `approval_id`; references prepared template, rewritten to unique live row |
| `compaction` | `summary`; finite presentation, no context compression engine |
| `artifact_created` | `artifact:{id,type,name,path}`, `timestamp`; align with output_artifacts and output_files |
| `context_usage` | `used_tokens`; supplied number, not counted tokens |
| `prompt_response` | Terminal marker added by handler; no final payload required |

## Approvals

| Route | Input → mutation |
|---|---|
| `GET /build/approvals/sessions/:id/live` | `{items}` filters session_id and is_live. |
| `POST /build/approvals/:id/decision` | `{decision}` stored without enum validation; if existing decision409; otherwise decision/time/is_live:false; returns approval. |
| `POST /build/approvals/:id/session-grant` | Sets decision APPROVED regardless body; same time/is_live/409 handling; returns approval. |

Missing approval404. “Approve for session” changes this row only; no actual broad permission grant or future auto-approval engine is present. User/API ownership checks are not implemented.

## Artifacts, previews, attachments and library

| Route / button | Input / response / boundary |
|---|---|
| `GET /build/mockshop-preview` | Seed preview_html as text/html, no session/visibility validation. |
| `GET /build/sessions/:id/artifacts` | Current artifacts array;404 session. |
| `GET /build/sessions/:id/webapp-info` | With artifacts: seeded webapp_info, URL resolved against parent-provided web origin, current sharing_scope. No artifacts: `{has_webapp:false,webapp_url:null,status:"none",ready:false,sharing_scope}`. Not a running deployed service. |
| `GET /build/sessions/:id/files` | `?path` directory path, default root; builds immediate child map from flat output files; `{path,entries:[{name,path,is_directory,size,mime_type}]}`. Directory size/mime null. |
| `GET /build/sessions/:id/artifacts/*` | Decoded suffix exact file path;404 absent. `shared_file_id` delegates Files. `fixture_bytes` decodes matching seed base64 field with raw res.end; otherwise sends content/mime. |
| `GET /build/sessions/:id/pptx-preview/*` | Known session only, returns same seeded `{slide_count,slide_paths,cached}` regardless suffix. Slides require output file routes; no PowerPoint rendering. |
| `GET /build/sessions/:id/download-directory/*`, `GET /build/sessions/:id/webapp-download` | Known session, same seeded archive_base64 raw ZIP attachment `fictional-craft-output.zip`; ignores requested directory subset. |
| `GET /build/sessions/:id/export-docx/*` | Known session, delegates Files to downloads.docx_file_id; ignores document content/suffix. No conversion. |
| `POST /build/sessions/:id/upload` | Multipart `file`;400 absent/string. Stores path `user_uploaded_files/<filename>`, size, MIME, seed.upload_text instead of bytes. Images/PDF/DOCX map to downloads IDs; XLSX→literal demo-xlsx; PPTX→presentation_base64; returns `{filename,path,size_bytes}`. No arbitrary filesystem write. |
| `DELETE /build/sessions/:id/files/*` | Decoded suffix filters exact output file path; null even absent; does not remove directories recursively or rewrite artifact cards. |
| `GET /build/user-library/tree` | Full flat library array. |
| `POST /build/user-library/directories` | `{name,parent_path}`; trimmed nonempty name without `/`, globally unique among directory names (not just same parent) or400. `/` parent→user_library/name; else parent_path/name. Row `{id,name,path,is_directory:true,file_size:null,mime_type:null,sync_enabled:true,created_at}`. |
| `POST /build/user-library/upload` | Multipart `files` plus `path?`; metadata only;400 none. Root `/`→user_library, other paths normalized; one row per filename/size/type with generated ID/sync_enabled/time. `{entries,total_uploaded,total_size_bytes}`. |
| `POST /build/user-library/upload-zip` | Multipart `file` plus `path?`; same response but each submitted file expands **canned** library_zip_entries; archive bytes never inspected. |
| `DELETE /build/user-library/files/:id` | Known library row404; removes row and descendants sharing path prefix `row.path/`; null. |

`outputFiles(session)` seeds output_files only when session.files is undefined; new sessions explicitly start `[]`, so output appears on completed-write events or final completion, not immediately. File size fields are authored metadata, not recomputed byte lengths. The Files module supplies real prepared binary bytes; declared MIME with empty/wrong bytes does not make a valid preview. For XLSX use `parsed_preview:{sheets:[{name,csv}]}` in shared Files catalog when native parsed preview is requested. PPTX's slide paths must point at real authored SVG/image content. User library is not automatically mounted/synced into session output files.

## Explicit failure/loading/empty staging

`POST /mockshop/user-craft/stage` body `{path:<route pattern>,state,delay_ms?}` modifies only `state.views`;200 `{staged:path,state}`; invalid pattern/state400. Use **pattern** including `:id`/`*`, not concrete instance path. Staging does not overwrite source records. Stage `loaded` to restore reader access; existing delay_ms is still honored on GET when supplied.

| Surface | Supported states and return |
|---|---|
| `/build/sessions/:id/send-message` | loaded / error500 `{detail}` / limited429 `{error_code:"RATE_LIMITED",detail,scope:"user",reset_at:seed.next_run_at,retry_after_seconds:60}`. No actual budget counter. |
| `/build/apps/:id/credentials`, `/build/apps/connect/:id/decision`, `/skills/custom/:id`, `/build/user-library/directories`, `/build/user-library/upload`, `/build/user-library/upload-zip` | loaded / error. Every matching non-GET method gets500 before state mutation. |
| `/skills` | loaded / empty→`{builtins:[],customs:[]}` / error500; GET delay |
| `/build/apps`, `/build/user-library/tree`, `/build/sessions/:id/artifacts` | loaded / empty→[] / error500; GET delay |
| `/build/scheduled-tasks` | empty→`{items:[]}`; loaded/error/delay |
| `/build/scheduled-tasks/:id/runs` | empty→`{items:[],next_cursor:null}`; loaded/error/delay |
| `/build/sessions/:id/files` | empty→`{path:"",entries:[]}`; loaded/error/delay |
| `/build/sessions/:id/webapp-info` | empty→no webapp; starting→seed info with ready:false,status:starting,sharing_scope:private; loaded/error/delay |
| `/build/sessions/:id/artifacts/*` | empty→empty string; loaded/error/delay |
| `/build/sessions` | empty→`{sessions:[]}`; loaded/error/delay |
| `/build/sessions/:id/pptx-preview/*` | empty→`{slide_count:0,slide_paths:[],cached:true}`; loaded/error/delay |
| `/mcp/servers/craft` | empty→`{mcp_servers:[]}`; loaded/error/delay |

Errors before read handler can mask missing session IDs. Intentional500/429 requests still need appropriate script expected-error assertions; the staging endpoint does not suppress strict runner network/console reporting.

## Reusable recipes

1. **Skill→app→session stale:** seed complete skill defaults and one enabled app with auth_template placeholders; create/edit skill, associate via admin app PATCH, supply fake user credentials, then read skill external_app.ready and session.skills_stale. Native Reload calls skills/reload and clears stale. No separate app catalog should be seeded inside Craft.
2. **Finite file-producing turn:** provide provider catalog, session_defaults with sandbox object, turn_packets edit start/progress pointing at an output_files path, final answer and matching artifacts. POST send, then native SSE GET; file must be published before completed-edit packet for auto-open. Populate actual shared preview bytes and separate slideshow previews where needed.
3. **Scheduled result:** create task using validated editor_mode/payload with run_immediately or Run Now; open returned run.session_id. It is instantly SUCCEEDED with task_output and prepared artifacts. To show queued/failed/skipped history, seed runs explicitly; no worker will produce those states.
4. **Approve/connect UI:** reference existing approval templates/app IDs in turn_packets; action buttons write local decision/credential records. Stream does not wait for approval; shape pacing is packet_delay_ms, not execution latency. Reopen assertion should inspect message readback/decision state, not infer a real external action.
5. **Error then recovery:** stage exact pattern error/limited, exercise native control and expected error, stage loaded, retry. A view reset does not clear underlying rows; whole-world switch does. No public deployment or persistent artifact storage is created by sharing/download buttons.
