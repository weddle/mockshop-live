# User data and native controls

[API map](../API-MAP.md) · [Runtime/reset](backend-runtime.md) · [Chat](backend-chat.md) · [Admin](backend-admin.md)

Source-derived from root handlers and `handlers-user-{extras,files,projects}.mjs`. Normal success is HTTP200; explicit exceptions are listed. All writes are in-memory, not production accounts or storage.

## Agents and pins

Root `agentOrgs[org]={personas,deleted,pins,nextId}` is the record owner. `seedAgents()` takes IDs from fixture `GET /persona`; `fullAgent(id)` requires a matching list entry and detail `GET /persona/<id>`, then applies Extras `agent_defaults`. Merely adding `/persona/11` without a catalog entry does not create a reachable agent. A saved record overrides its fixture. `pins` is keyed by effective requesting user ID within org.

Selected Agent `document_sets[]` names (and existing descriptions) refresh from the sole live Document Sets owner without changing selected IDs or unrelated Agent fields. Group share/owner names similarly follow the sole Groups owner. Selected tools resolve the composed MCP/OpenAPI catalog and refresh current names/descriptions by stable ID. These are metadata projections, not retrieval, tool execution or permission propagation.

### Permission and relationship projection

`agentUser()` starts from transformed fixture user, joins accepted Users by ID/email for canonical identity, then applies Auth identity last without replacing fixture permission tokens. Group membership comes from **live** Groups list joined through Users. User owner is `agent.owner.id`; group owner is `owner_group.id` matching viewer's groups. Shares use `user_shares:[{user:{id,email},permission}]` and `group_shares:[{group_id,group_name,permission}]`.

| Projection | Rule |
|---|---|
| Admin | `effective_permissions` includes `admin` |
| Agent manager | admin or `manage:agents` |
| Editor | manager, owner, EDITOR user/group share, or public EDITOR |
| Can view | manager, `read:agents`, owner, listed+public, or listed+matching share. An editor share alone does not independently bypass unlisted view rule. |
| `user_permission` | OWNER if actual owner, else EDITOR if effective editor, else VIEWER |
| `permissions.edit/share` | effective editor |
| `view_stats` | owner or manager, plus admin/`read:agent_analytics` |
| `delete` | owner or manager, plus admin/`add:agents` |
| `publish` | owner or manager |
| `feature/list` | manager |
| `reorder` | admin |
| Owner email visibility | Empty string for viewers who are not owner/manager |

These fields gate native controls. **They are not a complete server authorization model:** root save/curation routes enforce their rules, while Extras share/transfer/delete only checks record existence. Group permissions saved in Groups do not recompute `/me.effective_permissions`. Use the required fixture user tokens to stage member/manager/admin screens; do not claim real security enforcement.

| Route / control | Request | Mutation and response |
|---|---|---|
| `GET /persona` | Optional repeated `?persona_ids=<number>` | Accessible minimal catalog sorted ascending `display_priority` then ID; full snapshots projected to selected fields. |
| `GET /persona/:id` | Numeric ID | Full projected snapshot; inaccessible/missing404. Nonnumeric segment returns false (labels has its own earlier route). |
| `GET /admin/persona` | — | Same accessible catalog, full snapshots; not a separate agent store. |
| `GET /admin/agents` | `?include_default=false&page_num=0&page_size=N` | `{items,total_items}`; optional builtin exclusion; minimum page0/size1. |
| Create/edit: `POST /persona`, `PATCH /persona/:id` | Complete native upsert fields below | Saves sole root record. Returns PersonaSnapshot with `permissions:{}`; omits `search_start_date,user_permission,admin_count,ownership_vacant,knowledge_sources`. Read detail/catalog afterward for computed permissions. |
| Feature/list: `PATCH /admin/persona/:id/featured`, `PATCH /admin/persona/:id/listed` | `{is_featured:boolean}` or `{is_listed:boolean}` | Manager required403; missing404; wrong type422; saves flag, null. Does not automatically pin. |
| Reorder: `PATCH /admin/agents/display-priorities` | `{display_priority_map:{"<id>":integer,...}}` | Admin403; validates **all** IDs/integers before mutation, 404/422; null. Patch0015 makes gallery honor priorities; native gallery tie-break remains descending ID vs backend ascending ID. |
| Pins: `GET /user/pinned-assistants` | — | Saved user pins or fixture route/preferences, filtered for existing accessible agents. Initial seed can include builtin0. |
| Save pins: `PATCH /user/pinned-assistants` | `{ordered_assistant_ids:[number,...]}` | Missing/list-type422; deduplicates, removes inaccessible/missing IDs **and builtin0**, preserves order; null. `/me.preferences.pinned_assistants` uses this reader. |

Upsert required keys (missing → FastAPI-like 422 `detail:[{type:"missing",loc:["body",key],msg:"Field required",input:body}]`): `name,description,system_prompt,task_prompt,document_set_ids,tool_ids,datetime_aware`. Create requires `add:agents` or admin; edit requires existing effective editor; builtin update400. Duplicate same name in manager-visible/own records400. Non-manager `is_featured:true`400.

Accepted persisted optional fields: `replace_base_system_prompt,starter_messages,default_model_configuration_id,search_start_date,icon_name,uploaded_image_id,remove_image,is_public,is_featured,display_priority,label_ids,user_file_ids,hierarchy_node_ids,document_ids,users,groups`. Root joins `tool_ids` against the composed MCP/OpenAPI catalog; nonempty IDs with zero matches400, partially invalid lists filter. Document Sets use their live owner; invalid set IDs silently drop. User files must be known Files records or fixture recent files; unknown400. Folder/document selections resolve existing attached snapshots plus the finite Knowledge catalog (`/mockshop/user-knowledge-hierarchy`, with default documents from the search seed); unknown IDs400, omitted selections preserve saved fields and explicit empty lists clear them. Users resolve live accepted Users excluding self; groups resolve live names. Existing share permissions preserve; newly added shares VIEWER. New owner is effective viewer; public permission defaults VIEWER; publication is owner/manager-controlled. `sharing_status` is PUBLIC, else SHARED if group-owner/shares, else PRIVATE. `knowledge_sources` derives from selected sets/hierarchy/docs/files.

Advanced controls save `default_model_configuration_id`, `search_start_date`, `replace_base_system_prompt` and `task_prompt` on the same persona record. Read detail after save for projected fields; a save response is not the full catalog/detail projection.

Root pins/configuration survive org revisit with keep; fresh reset clears all orgs. `empty_gallery`/`empty_sidebar` Extras seeds can suppress initial nonbuiltin entries/pins but do not delete live additions.

## Extras

`/mockshop/user-extras` merged with `/mockshop/user-extras-options` enables decorations only when `enabled:true`; otherwise only `avatar_png_base64,daily_stats` remain available. Other keys: `user_fields,personalization,settings,agent_defaults,empty_gallery,empty_sidebar,branding,notifications`. Own local stores: dismissed ID Set, added labels, next avatar upload number; root still owns agent records.

| Route / native control | Request → effect/response |
|---|---|
| `GET /persona/labels` | Fixture labels plus added labels. |
| `POST /persona/labels` | `{name}` trimmed, case-insensitive duplicate returns existing; otherwise next max ID+1; returns label. No explicit blank/type validation beyond string calls. |
| `PATCH /persona/:id/share` | `{user_shares:[{user_id,permission}]}` or legacy `{user_ids}`; corresponding `group_shares`/`group_ids`; optional `is_public,public_permission,label_ids`. Resolves live accepted Users (retaining unchanged same-ID `/users` DTOs) and Groups-projected minimal rows. Unknown/deleted IDs drop; updates sole root shares/users/groups/status; null. Missing Agent404. |
| `POST /persona/:id/transfer-ownership` | `{new_owner_user_id?,new_owner_group_id?}`; same live Users/Groups readers, rejects neither400; sets owner/group and clears vacancy; null. Fresh reset restores seeds. |
| `DELETE /persona/:id/share/me` | Removes effective viewer's explicit user share/root users entry only; public/group access can remain; null. |
| `DELETE /persona/:id` | Tombstones root record, deletes saved override; null. Does not cascade-delete projects/history or enforce root permission flags. |
| `POST /admin/persona/upload-image` | Submitted bytes not stored; `{file_id:"mock-user-extras-avatar-N"}`. Saving agent must separately reference ID. |
| `GET /persona/:id/avatar` | Existing agent then same seeded PNG bytes; image/png. Does not retrieve uploaded artwork. |
| `GET /enterprise-settings/logo`, `GET /enterprise-settings/logotype` | Enabled branding → seeded PNG; otherwise false. Root prioritizes an uploaded Admin logo over this seed; logotype remains separately owned. Branding also transforms enterprise settings. |
| `GET /analytics/assistant/:id/stats` | `?start&end`; seed `daily_stats[id]` rows `{date? or days_ago,total_messages,total_unique_users}` anchored UTC midnight of demo clock. Filters dates, returns `{daily_stats,total_messages,total_unique_users}` with sums, **not deduplicated** unique users across days. No chat-derived analytics. |
| `GET /notifications/summary` | `{total_items,undismissed_count}` including dismissed rows, then composed admin banner. |
| `GET /notifications` | `?min_severity=info|warning|error&page_num&page_size`; filters severity, pages with size1–50/default10; `{notifications,total_items,undismissed_count,page_num,page_size,has_more}` then admin banner wrapper. |
| `POST /notifications/:id/dismiss`, `POST /notifications/dismiss-all` | Mark IDs dismissed, null. Bulk also dismisses admin banner; exact banner65065 path handled by Admin Pages. Notification deletion is not performed. |

Banner wrapper appends to already-paginated Extras results, recomputes counts for that result and sets `has_more:false`; do not infer globally accurate pagination once banner is active.

## User preferences, memories, tokens and connectors

Root `userSettings()` is keyed `org:fixture /me.id` and lazily seeds PATs, prompts, personal connectors, OAuth grants and next counters; `preferences`/`personalization` are overlays. User changes visible through `/me` survive same-org keep/world revisit; fresh reset clears. Auth can replace displayed user ID while this store remains keyed by fixture ID; changing fictional auth mode does not create a separate preferences database.

| Exact route | Request / saved field | Response and downstream effect |
|---|---|---|
| `PATCH /user/theme-preference` | `{theme_preference}` | null; `/me.preferences` readback |
| `PATCH /user/language` | `{language}` | null + locale cookie; changes `state.locale`; see runtime locale contract |
| `PATCH /user/chat-background` | `{chat_background}` | null; native preference only |
| `PATCH /user/default-app-mode` | `{default_app_mode}` | null; e.g. CHAT/SEARCH/Craft mode chosen by native UI |
| `PATCH /user/default-model` | `{default_model}` descriptor/null | null; influences later chat defaults, not prior assistant nodes |
| `PATCH /auto-scroll` | `{auto_scroll}` | null |
| `PATCH /temperature-default` | `{temperature_default}` | null; saved in `/me`; fixture `GET /temperature-default` itself is not transformed |
| `PATCH /reasoning-effort-default` | `{reasoning_effort_default}` | null; separate GET fixture likewise remains seed |
| `PATCH /temperature-override-enabled` | `?temperature_override_enabled=true` | Exact string true → true, everything else false; null |
| `PATCH /shortcut-enabled` | `?shortcut_enabled=true` | Same boolean query behavior; null |
| `PATCH /paste-as-tile` | `?paste_as_tile=true` | Same boolean query behavior; null |
| `PATCH /voice/settings` | Any of `{auto_send,auto_playback,playback_speed}` | Saves `voice_<field>` preference; null. Does not enable real speech service. |
| `PATCH /user/personalization` | Non-null `name,role,use_memories,enable_memory_tool,user_preferences`; `memories:[{id?,content}]` | Replaces supplied memories list, assigns monotonic IDs only for missing IDs; preserves supplied IDs; null. Omitting memories keeps them. Deleting memory means send reduced list. |
| `GET /user/pats` | — | Current PAT metadata array |
| `POST /user/pats` | `{name,expiration_days?,scopes?}` | Saves metadata `{id,name,token_display,created_at,expires_at,last_used_at:null,scopes}`; returns it **plus** `token:"mockshop-not-a-real-token-000N"`. Expiry at UTC end of computed day; null days → no expiry. No authentication rights. |
| `DELETE /user/pats/:id` | — | Removes numeric ID; null even absent |
| `GET /input_prompt` | — | Saved prompt shortcuts |
| `POST /input_prompt` | Native prompt DTO | Shallow copies body + next ID/fixture user ID; returns row |
| `PATCH /input_prompt/:id` | Native changed fields | `Object.assign`, returns row; missing404; no schema validation |
| `DELETE /input_prompt/:id` | — | Remove ID, null |
| `GET /oauth-provider/grants` | — | Saved grants seed |
| `DELETE /oauth-provider/grants/:id` | — | Remove decoded ID; null; no real OAuth revocation |
| `GET /federated/oauth-status` | — | Personal connector rows |
| `DELETE /federated/:id/oauth` | — | Sets `has_oauth_token:false,oauth_token_expires_at:null`; null; missing404 |
| `GET /mockshop/personal-connectors/:id/connect` | — | Read-only local HTML form. Never connects on Next Link prefetch. |
| `POST /mockshop/personal-connectors/:id/connect` | — | `has_oauth_token=true`;303 `/app/settings/connectors`; does not create expiry or real Gmail grant |
| `GET /user/usage` | `?start&end` ISO date text | Filters `per_day_by_model`, sums `window_cost_cents`; selected model price by third descriptor segment from saved/default model. Other budget fields remain seed; usage not incremented by chat. |

Preference writes are intentionally permissive; they are not upstream validation implementations. The backend does not promise that every native component listens to every saved setting without its usual cache refresh/navigation.

## Files

Owner `handlers-user-files.mjs`: lazy `records:Map<userFileId,{key,created,accessed,readyAt,projectId,tempId,deleted?,deleting?}>`, `sessionRefs:Map<sessionId,Set<userFileId>>`. Seed `/mockshop/user-files` must provide `catalog,seed_ids,upload_delay_ms,processing_delay_ms,delete_delay_ms,preview_delay_ms,rejection_reason,answer_title,answer_intro`.

Catalog entry fields: `key,id,name,file_id,file_type,chat_file_type,token_count,chunk_count,final_status?,reject?,preview_error?,preview?,preview_base64?,parsed_preview?,answer,assistant_names?`. `id` is user-file record ID; `file_id` is backing bytes/preview ID; `seed_ids` contains **keys**, not IDs. Only catalog entries become files; uploaded content does not define previews/answers.

| Native operation / route | Input | State transition / output |
|---|---|---|
| Recent files: `GET /user/files/recent` | — | Transform prepends owned records reverse insertion order, removes duplicate seed IDs; retains unrelated fixture records. |
| Upload: `POST /user/projects/file/upload` | Multipart `files` (multiple), `project_id?`, `temp_id_map?` JSON keyed `"<size>|<first 50 filename chars>"` | Matches **exact filename** against catalog; unknown/reject entries return `{file_name,reason}`. Accepted records reset with ready time now+upload+processing delays; optional project association; waits upload delay then `{user_files,rejected_files}`. Caller bytes discarded. |
| Status poll: `POST /user/projects/file/statuses` | `{file_ids:[userFileId,...]}` | Known nondeleted snapshots only. Status DELETING while delete wait, PROCESSING before readyAt, otherwise `final_status || COMPLETED`; token/chunk counts only on COMPLETED. |
| Session files: `GET /user/projects/session/:id/files` | — | Merges exact/parameter fixture session files, live project files, attached-file refs by ID (later wins). |
| Delete: `DELETE /user/projects/file/:id` | — | Missing404; checks project names and seeded `assistant_names`. If associated, no deletion. Else marks DELETING, waits, tombstones, clears session refs/project links. Returns `{has_associations,project_names,assistant_names}` either way. |
| Preview/download: `GET /chat/file/:id` | Backing file ID; optional `?parsed=true` | Only catalog entries with records; returns raw fixture bytes/text, inline filename and `file_type`. Parsed preview returns application/json when present. `preview_error` intentionally404. Unknown returns false to root source viewer. |

Snapshot fields: `id,name,file_id,project_id,user_id,created_at,last_accessed_at,status,file_type,chat_file_type,token_count,chunk_count,temp_id`. `user_id` comes from raw fixture `/me`, not simulated Auth identity. Uploaded project ID is recorded even if companion refuses unknown project. Reupload of same catalog filename overwrites that record rather than allocating another ID.

`attachMessage(sessionId,descriptors)` accepts `{user_file_id}` or backing `id`, resolves **COMPLETED** records only, deduplicates, updates accessed timestamp, and saves `{id:file_id,type:chat_file_type,name,user_file_id}` on user node. Unknown/nonready files silently drop. `scriptForFiles()` creates finite bullet answer from each known file's `answer`, cites `project_file__<file_id>` as `user_file`, and uses seeded answer title/intro. It neither reads upload bytes nor applies project instructions. Regeneration reuses saved descriptors; stop/replay uses root tree.

Tombstoned preview bytes remain available for historic citations because preview lookup tests record presence, not deletion. Craft `serveFile()` directly uses catalog even without upload record; this is intentional shared byte ownership. Association blocking for agents is seeded `assistant_names`, not recomputed from live agent `user_file_ids`; document this when demonstrating delete-after-agent-edit.

## Projects

Owner lazy `data={projects:Map,memberships:Map<chatId,projectId|null>,files:Map<projectId,Set<userFileId>>,nextId}`. Seed `GET /user/projects` rows contain native project fields plus `chat_session_ids?`, `chat_sessions?`, `file_ids?`. Association-only fields are removed from project metadata; snapshots join authoritative current sidebar sessions and live Files records. Seed chat IDs must be reachable from root sidebar/history to appear in project detail.

| Route | Input → mutation/response |
|---|---|
| `GET /user/projects` | Full array with computed `chat_sessions` |
| `POST /user/projects/create` | `?name` required trimmed;400 blank; creates `{id,name,description:null,created_at,user_id,instructions:null}`; returns snapshot |
| `GET /user/projects/:id` | Snapshot; unknown404 |
| `PATCH /user/projects/:id` | `{name}` nonblank400; trimmed rename; snapshot |
| `DELETE /user/projects/:id` | Dissociates known chats, removes project/file-link maps; `{}`; **does not delete chat trees or Files records** |
| `GET /user/projects/:id/details` | `{project,files,persona_id_to_is_featured}`; live accessible non-deleted Agent catalog supplies current saved featured flags |
| `GET /user/projects/:id/instructions` | `{instructions}` |
| `POST /user/projects/:id/instructions` | `{instructions:string}`;400 nonstring; trim/empty→null; `{instructions}`. Stored metadata, not actual prompt injection/reasoning. |
| `GET /user/projects/:id/token-count` | `{total_tokens}` sums linked live file token_count or0. Unknown/deleted project returns0 rather than404 to tolerate native deletion transition. |
| `GET /user/projects/files/:id` | Current linked Files snapshots with this `project_id`; unknown project404 |
| `POST /user/projects/:id/files/:fileId` | Existing project + known file; adds Set link; `{}`; unknown file404 |
| `DELETE /user/projects/:id/files/:fileId` | Removes association only; `{}`; unknown link404 |
| `POST /user/projects/:id/move_chat_session` | `{chat_session_id}` must exist in root sessions; sets membership, `{}`; missing404 |
| `POST /user/projects/remove_chat_session` | `{chat_session_id}` known; membership null, `{}`; missing404 |

`projectIdForSession()` uses explicit live membership if present, else original session project_id, but only if project still exists. Chat create calls `onSessionCreated()` once; moving a chat never allocates a second chat. Sidebar transform hides project chats; project detail and chat detail read same membership. A screen sidebar mask also constrains the session supplier used by Projects, so a masked-out chat can be absent from project lists even while direct detail exists. Files may be associated with multiple projects; project snapshots override `project_id` per view rather than asserting single ownership.

Files/Projects keep across same-world `keep:true,resetChats:false`; both reseed on world change even when chat trees are kept. Full reset clears their lazy stores. This is not durable storage.

## Concrete seed recipes

### One known-file upload and project

Place these DTOs under `apps.onyx.fixtures` (other neutral defaults remain supplied by platform):

```yaml
GET /mockshop/user-files:
  seed_ids: []
  upload_delay_ms: 200
  processing_delay_ms: 500
  delete_delay_ms: 200
  preview_delay_ms: 0
  rejection_reason: Only the prepared fictional file is available.
  answer_title: File review
  answer_intro: Prepared file summary.
  catalog:
    - key: brief
      id: user-file-brief
      file_id: file-brief
      name: brief.txt
      file_type: text/plain
      chat_file_type: plain_text
      token_count: 80
      chunk_count: 1
      preview: Fictional project brief.
      answer: The brief describes a local demonstration.
GET /user/projects:
  - id: 1
    name: Review
    description: null
    instructions: null
    user_id: fictional-viewer-id
    created_at: '2026-10-09T14:00:00Z'
    file_ids: []
    chat_session_ids: []
```

Existing source seeds use `chat_file_type: plain_text` for text/Markdown/code/JSON, `image` for image previews, `tabular` for CSV/XLSX, and `document` for PDF/DOCX/download-only files. This recipe is source-derived, not exercised UI proof. Choose a filename-matched upload, wait for COMPLETED, attach through native composer, then send. For a preseeded file put `brief` in `seed_ids`; association needs `user-file-brief` in project `file_ids`. Deletion while linked returns association warning, not success removal.

### Agent ownership/curation

Define `apps.onyx.agents` using explicit owner person key; keep accepted Users and Groups identities coherent; native upsert required fields must all exist. For a private member-owned agent set `is_public:false,is_listed:true`, owner and shares. Curation toggles should be demonstrated with manager/admin permission tokens; member share/delete UI is staged by projected flags, not assumed server enforcement. For empty state explicitly set gallery/pins fixtures or Extras options, rather than deleting neutral builtin platform metadata.
