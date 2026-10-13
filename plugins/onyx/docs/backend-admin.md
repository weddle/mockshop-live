# Admin backend controls

[API map](../API-MAP.md) · [Runtime/reset](backend-runtime.md) · [User agents](backend-user.md) · [Craft](backend-craft.md) · [Static fixtures](backend-fixtures.md)

This is the source-derived operating contract for our mock, not an upstream service description. Unless stated, success is HTTP200 and writes read JSON. `null`, `{}`, collection and row responses are intentional. Most admin handlers do **not** enforce authentication; native `/me` permissions/edition gates control presentation, while MCP explicitly checks its fixture-admin rule. No outbound provider/indexing/directory/billing operation occurs.

## Providers, connectors and credentials

Owner `handlers-save-controls.mjs`, `state.saveControls[org]`. Lazy `data()` clones the admin provider catalog, grouped indexing seed, explicitly identified pair details and credentials, linking pair credentials to the common credential array. Store: `catalog,indexing,pairs,credentials,seededPairs,connectors,uploads,indexingErrors,targetedJobs,nextTargetedJob,nextProvider,nextModel,nextConnector,nextPair,nextCredential,nextFile`. Org revisit with keep retains edits and queued requests; fresh reset clears every org store. Connector/pair/credential allocation starts above max(existing,999), provider/model allocation above seeded maxima; upload IDs are `mockshop-file-1000...`. `seededPairs` records identities, not an ID threshold or row order.

### LLM provider controls

Seed `GET /admin/llm/provider` is authority: `{providers:[{id,name,provider,api_key,api_base,api_version,custom_config,deployment_name,is_public,is_auto_mode,groups,personas,model_configurations,...}],default_text,default_vision,default_chat_naming,default_craft}`. A model row needs `id,name,display_name,is_visible` and native capability fields such as `max_input_tokens,supports_image_input,supports_reasoning,supported_reasoning_efforts,vendor,is_recommended_default`. Public `GET /llm/provider` seed contributes `provider_display_name` descriptors only; do not stage different mutable inventories there.

| Route / native button | Input | Mutation / response |
|---|---|---|
| `GET /admin/llm/provider` | — | Full live catalog + Admin Pages saved model defaults |
| `GET /admin/llm/provider/:id` | — | Full provider row;404 absent |
| `GET /llm/provider`, `GET /llm/persona/:id/providers` | — | Public projection `{providers:[{id,name,provider,provider_display_name,model_configurations,next_model_configuration_offset:null}],...defaults}`; same inventory for every persona |
| `GET /admin/llm/built-in/options/:provider` | — | Exact fixture if present; else `{name:provider,known_models:/mockshop/save-controls.provider_models,recommended_default_model:first}`. Empty exact fixture still wins over fallback. |
| Refresh available models: `POST /admin/llm/:provider/available-models` | Bedrock `{aws_region_name}`; others `{api_base}` | Supported URL names: `bedrock,ollama,openrouter,lm-studio,bifrost,openai-compatible,litellm,nebius-tokenfactory,vercel-ai-gateway,portkey`. Missing required400; unsupported404. Returns exact POST fixture or generic prepared model array; LiteLLM adds `model_name:name`. No discovery. |
| Test: `POST /admin/llm/test` | Provider DTO including optional existing `id` | Runs local required-field checks,400 `{detail}` or200 `{simulated:true,message:"Local fake configuration accepted; no connection tested."}`. No mutation. |
| Save/add/edit: `PUT /admin/llm/provider` | Provider DTO, `id?`, `model_configurations?` | Existing ID required if supplied404; same local validation400. Allocates provider/models, preserves existing model IDs only when belonging to that provider, stores row; returns provider. `api_key` truthy replaced with `mock-only-not-a-secret`; empty clears; omitted preserves. `custom_config` secret-looking keys replaced. |
| Delete: `DELETE /admin/llm/provider/:id` | Native confirmation; `?force=true` for the last configured provider | Removes provider/models from the sole catalog and clears defaults naming it. Unknown404; default text provider without force400. Native UI disables default deletion with multiple providers and warns for the last. Keep retains; fresh restores. No account deletion. |
| Set default text: `POST /admin/llm/default` | `{provider_id,model_name,...}` | Verifies provider contains model,400 otherwise; sets whole `default_text` object; null. Visibility is not checked by this handler. |

`providerError()` requires nonblank `provider` and either `model` or at least one visible named model. Key required for `openai,anthropic,azure,openrouter,litellm_proxy,portkey,vercel_ai_gateway,nebius_tokenfactory`; base URL required for `ollama_chat,lm_studio,openrouter,litellm_proxy,bifrost,openai_compatible,portkey,vercel_ai_gateway,nebius_tokenfactory`. Existing values satisfy edit/test checks. A `model` string alone can pass validation while saved model list remains empty; the UI normally supplies complete configurations.

Admin Pages additionally owns `POST/DELETE /admin/llm/default-chat-naming`, `POST/DELETE /admin/llm/default-craft`, and `POST /admin/llm/default-vision`: POST stores the entire descriptor body under respective `modelDefaults` field and echoes it; DELETE writes/returns null. These handlers do not validate membership. Root wraps public/admin/persona catalog reads so native picker/chat/Craft sees these changes. Text generation remains prepared content.

### Connector setup, credentials and inline files

Seed each indexed pair coherently: grouped `POST /manage/admin/connector/indexing-status` row `cc_pair_id`; `GET /manage/admin/cc-pair/<pairId>` with `connector:{id,source,name,connector_specific_config,credential_ids,...}`, `credential:{id,...}`, pair status/permissions; optional global credential list. `GET /manage/admin/connector/status` is the seeded selector DTO list projected over the same pair store by `connectorRows()`. Seed extra fields remain; current pair name/connector/credential/access/status overlay matching `cc_pair_id`; newly bound pairs append with `groups:[]` and `has_successful_run:false`. Untouched seeds read unchanged.

| Route / native operation | Input | Mutation / response |
|---|---|---|
| `GET /connector/oauth/details/:source` | — | Exact fixture merged with `additional_kwargs:[]`, forced `supports_manual_credentials:true`; `oauth_enabled`/`mock_simulation` true only when source in `/mockshop/save-controls.oauth_sources`. |
| `GET /connector/oauth/authorize/:source` | `?desired_return_url` | `{redirect_url:"/api/mockshop/save-controls/oauth/<source>?return=..."}`; only `/admin/` relative paths without backslash accepted, else source connector page. No token. |
| `GET /mockshop/save-controls/oauth/:source` | `?return` | Read-only local HTML form explaining simulated account; prefetch does not mutate. |
| `POST /mockshop/save-controls/oauth/:source` | `?return` | Clones same-source credential metadata if any, allocates fake OAuth-interactive credential;303 safe `/admin/...` destination. This is the explicit “Stage local fake account” button. |
| `GET /manage/admin/credential` | — | Live credential array |
| `GET /manage/admin/similar-credentials/:source` | — | Live array filtered by source |
| `POST /manage/credential` | `{source,name,credential_json,admin_public,...}` | Allocates row/current fixture email/wall-clock timestamps; scrubs secret-looking keys in credential_json; row |
| `PUT /manage/admin/credential/:id` | Native credential fields | Shallow assigns body, merges scrubbed `credential_json`; row;404 absent |
| `POST /manage/credential/private-key` | Multipart scalar `name,source,credential_json,admin_public,field_key`; uploaded key content | Source required400. Extracts scalar fields from raw multipart; discards key bytes, inserts fake marker at `field_key`; creates row |
| `PUT /manage/admin/credential/private-key/:id` | Same multipart | Updates name if supplied, merges scrubbed credentials, timestamp; row;404 absent |
| `PUT /manage/admin/credential/swap` | `{connector_id,new_credential_id,access_type}` | Finds first pair by connector ID + credential;404 missing; replaces pair credential, connector credential_ids and access_type; null. No real authorization or all-pair cascade. |
| `GET /manage/admin/connector` | `?credential=<numeric ID>` optional | Live connectors; optional credential_ids membership filter |
| `GET /manage/connector` | — | **Admin Pages route wins**, reading the same `connectorRows()` projection plus saved connectors not yet bound to a pair (`connectorList()`). Renamed/new connectors appear. |
| `POST /manage/admin/connector` | `{name,source,connector_specific_config,...}` | Nonblank name/source/config required400; creates connector with no credential IDs; returns connector; not yet a pair/indexing row |
| `PATCH /manage/admin/connector/:id` | Native connector fields | Shallow assign, returns connector;404 absent |
| `PUT /manage/connector/:connector/credential/:credential` | Pair metadata `{name?,access_type?,...}` | Both IDs required404; special credential0 creates fake upload account if missing. `bind()` creates/replaces matching pair using `/mockshop/save-controls.pair` defaults and links credential. `{success:true,cc_pair_id}`. |
| `POST /manage/admin/connector-with-mock-credential` | Same connector create body | Creates connector, fake credential and pair in one operation; returns connector, not pair |
| `GET /manage/admin/cc-pair/:id` | Pair ID | Live pair;404 absent |
| Rename: `PUT /manage/admin/cc-pair/:id/name` | `?new_name` nonblank | Sets pair and connector names; null;400 blank/404 absent |
| Frequency: `PUT /manage/admin/cc-pair/:id/property` | `{name:"refresh_frequency"|"pruning_frequency",value}` | Maps to connector `refresh_freq`/`prune_freq`. Refresh ≥60 and divisible60; prune ≥0.083×3600. Invalid400; saves seconds; null. |
| Indexing list: `POST /manage/admin/connector/indexing-status` | `{source?,name_filter?}` | Reconciles live pairs into cloned seed groups, recomputes summaries; filters source/name; root applies screen visibility/order and recomputes summaries again when a screen mask is active. No pagination engine. |
| `GET /manage/connector-status` | Fixture + transform | Joins mutations by explicit `cc_pair_id`, appending only pairs not in `seededPairs` with `has_successful_run:false`. High-ID seeds are not duplicated. |
| Upload connector files: `POST /manage/admin/connector/file/upload` | Multipart filenames | Extracts basename only,400 none; stores metadata IDs/names/date; `{file_paths,file_names,zip_metadata_file_id:null}`; bytes discarded, no indexing. |
| `GET /manage/admin/connector/:id/files` | Connector ID | Config `file_locations/file_names` joined to upload metadata; `{files}`; unknown connector false/fall-through |
| Inline file update: `POST /manage/admin/connector/:id/files/update` | Multipart `file_ids_to_remove` JSON + filenames | Removes selected IDs, appends new metadata; updates config arrays; `{success:true,simulated:true}`; unknown false. Patch0007 preserves selected FileList before native input reset. |
| Run once: `POST /manage/admin/connector/run-once` | `{connector_id,credentialIds:[...],from_beginning:boolean}` | Nonempty credentials and boolean required400; missing selection404; any selected indexing or PAUSED/INVALID pair409. Stages every selected pair with `indexing:true`; seeded pairs use `last_index_attempt_status:"not_started"` and full/update checkpoint text, new pairs use `"in_progress"` and upload checkpoint text. `{success:true,simulated:true}`; no worker completes it. |
| Errors: `GET /manage/admin/cc-pair/:id/errors` | `?page_num=0&page_size=10&include_resolved=false` | Missing pair404; org-local cloned errors, optional unresolved filter, zero-based page slice and filtered `total_items`. |
| Targeted reindex: `POST /manage/admin/indexing/targeted-reindex` | `{error_ids:[...]}` | Requires 1–100 submitted IDs400; deduplicates known IDs, missing404; unsupported owning pair400. Queues unresolved selections, skips resolved rows; `{targeted_reindex_job_id,queued_count,skipped_count}`. |
| Targeted readback: `GET /manage/admin/indexing/targeted-reindex/:id` | Request ID | Same org's request or404; `status:"not_started",completed_at:null,resolved_count:0,still_failing_count:target_count,resolved_summary:[]`. No worker, completion or fabricated documents. |
| Pause/resume: `PUT /manage/admin/cc-pair/:id/status` | `{status:"ACTIVE"|"PAUSED"}` | Missing404; invalid status400; DELETING400. Changes status only; null. |
| Schedule deletion: `POST /manage/admin/deletion-attempt` | `{connector_id,credential_id}` | Missing pair404; only PAUSED/INVALID eligible400. Sets `status:"DELETING"` and `latest_deletion_attempt.status:"PENDING"`; null. No document deletion; status writes cannot undo pending deletion. |

`indexingRows()` lite projection carries `cc_pair_id,name,source,access_type,cc_pair_status,in_progress,last_status,last_success,docs_indexed,is_editable:true,permissions,in_repeated_error_state:false,latest_index_attempt_docs_indexed:0`. Pair defaults and body are not upstream validation. Timestamps in Save Controls create paths use wall clock (`new Date()`), unlike demo-clock chat/admin records. Credential scrub is key-name-based (`token|password|secret|api_key|private_key|access_key|credentials|service_account`) and not a complete arbitrary-content sanitizer.

Read-only attempts/sync, health, checks-plan and binding-check seeds are inventoried in [fixtures](backend-fixtures.md). Full/update requests leave document counts, attempt history and unresolved errors unchanged. Targeted requests require the pair's existing capability; unsupported pairs use the native full-reindex path. Native confirmation Cancel queues nothing. Supported local status/deletion/reindex requests are the dynamic routes above, not production jobs.

## Document sets

Owner `handlers-document-sets.mjs`: lazy Map seeded by `GET /manage/document-set`; next max ID+1. Same-world keep retains; world change/fresh reset reseeds. `list()` is shared with root agent save and Groups, so those consumers see live set edits.

| Route | Request / result |
|---|---|
| `GET /manage/document-set` | Transform returns all live set rows. |
| `POST /manage/admin/document-set` | `{name,description?,cc_pair_ids?,federated_connectors?,is_public,users?,groups?}`; allocates ID, row response. |
| `PATCH /manage/admin/document-set` | Same complete native form plus `id`;404 missing; replaces selected associations/fields, row. |
| `DELETE /manage/admin/document-set/:id` | Deletes Map record;200 `{success:true}` or404 detail. |

Name must be nonblank, every pair ID must exist in the current `connectorRows()` projection of `/manage/admin/connector/status`, and at least one pair or federated config must be supplied;400 otherwise. Native `federated_connectors:[{federated_connector_id,entities}]` resolves names/sources through Admin Pages' sole live `federatedRows()` reader, including created IDs; nonexistent federated IDs are not rejected explicitly. Result includes `{id,name,description,cc_pair_summaries:[{id,name,source,access_type}],federated_connector_summaries,is_public,users,groups,is_up_to_date:true,permissions:{edit,manage_access,delete,publish:true}}`; summaries use current pair names at save time. Public clears groups but not users. Agent Knowledge and Group readers refresh saved set names by stable ID; this is not ingestion, permissions propagation or a cascade delete of Agent associations.

## Users and groups

Users owner caches `accepted,invited,pending` from `/manage/users/accepted/all`, `/manage/users/invited`, `/tenants/users/pending`. Groups owns local `records,permissionEdits,limitEdits`; both use `core.state.adminGroupMembers` and Users' `getUser()` for live canonical identity. Admin Pages Craft toggles use `state.adminCraftEnabled[email]`, reconciled on accepted-users read. Same-world keep preserves; world/fresh reset clears these caches.

### Users

| Route / control | Request → effect/response |
|---|---|
| `GET /manage/users/accepted/all` | Accepted rows decorated with live `{id,name}` group membership |
| `GET /manage/users` | If seed is array, same accepted rows; otherwise seed envelope with live accepted/invited and accepted_pages/invited_pages 0 or1. No real pagination/filtering. `slack_users` stays fixture metadata. |
| `GET /manage/users/invited`, `GET /tenants/users/pending` | Current local arrays |
| `GET /manage/users/counts` | Counts accepted `account_type`, active/inactive; not pending/invited |
| Invite: `PUT /manage/admin/users` | `{emails:[]}`; adds absent email to invited (skips accepted/already invited); returns `/manage/users/mock-feedback` metadata plus `invited:[new emails]`; no email delivery |
| Cancel invitation: `PATCH /manage/admin/remove-invited-user` | `{user_email}`; removes invite, `{}` |
| Approve pending: `POST /tenants/users/invite/approve` | `{email}`; removes pending and adds invited if absent; returns mock-feedback metadata. Does not create accepted account. |
| `PATCH /manage/admin/deactivate-user`, `PATCH /manage/admin/activate-user` | `{user_email}`; sets `is_active`, `{}`; unknown404 |
| `PATCH /manage/admin/users/admin-access` | `{user_email,is_admin}`; updates row only, `{}`; does not rewrite `/me` permission tokens |
| `DELETE /manage/admin/delete-user` | `{user_email}`; removes accepted row and all current group memberships by ID/email; `{}`. No remote deletion or chat/agent ownership cascade. |
| Reset password: `POST /password/reset_password` | `{user_email}`; known only; `{user_id,new_password:mock-feedback.reset_password,simulated:true}`. No password store mutation. |
| Download: `GET /manage/users/download` | text/csv with header `email,account_type,is_admin,is_active`; unescaped comma-joined accepted rows; fictional data only |
| Craft enable: `PATCH /manage/admin/users/craft-enabled` | Admin Pages `{user_emails:[],craft_enabled}`; stores flags by email; `{simulated:true,updated_count}`; accepted-list and matching `/me.craft_enabled` readback |

### Groups and shared resource selection

Seed `/manage/admin/user-group` native rows plus `/mockshop/admin-groups/seeds`:
`{groups:[{id,name,manager_ids,cc_pair_ids,document_set_ids,agent_ids,enabled_permissions,token_limits}],resource_permissions,create_defaults}`. Original group needs `manager_ids` (or matching config), users and native status fields. Resources read live Save Controls `connectorRows()`, Document Sets `list()` and root `adminAgentRows()`. The latter overlays seed admin rows with stored personas, removes deleted Agents and includes created Agents without recursively reading Group access. Each GET rehydrates saved `cc_pairs`/`document_sets`/`personas` from stable selected IDs and current names/metadata; unchanged selection, permissions, limits and membership remain intact.

| Route | Input → mutation/response |
|---|---|
| `GET /manage/admin/user-group` | Current group rows with joined accepted users `{id,email,is_active}`, normalized manager IDs, selected resource snapshots |
| `POST /manage/admin/user-group` | `{name,user_ids?,cc_pair_ids?}`; max ID+1, create_defaults/resource_permissions; selects existing users/pairs, returns group; no explicit name validation |
| `PATCH /manage/admin/user-group/rename` | `{id,name}`;404 absent; saved rename, `{}` |
| `POST /manage/admin/user-group/:id/add-users` | `{user_ids:[]}`; deduplicated live Users join; unknown users drop; `{}` |
| `PATCH /manage/admin/user-group/:id` | `{user_ids?,cc_pair_ids?}`; owns membership-only or combined replace. Neither field → false. Known group404 otherwise; `{}`. |
| `PUT /manage/admin/user-group/:id/manager` | `{user_id,is_manager}`; adds/removes canonical ID; unresolved ID can be retained; `{}` |
| `PATCH /manage/admin/user-group/:id/incognito` | `{enabled}` saves `incognito_enabled`; `{}`; does not implement incognito retention |
| `GET /manage/admin/user-group/:id/permissions` | Saved or seeded enabled-permission array |
| `PUT /manage/admin/user-group/:id/permissions` | `{permissions}` stores whole array; `{}`; no effective-permission engine |
| `PATCH /manage/admin/user-group/:id/agents` | `{added_agent_ids?,removed_agent_ids?}`; union/remove then select current live agents; `{}` |
| `PATCH /manage/admin/user-group/:id/document-sets` | `{added_document_set_ids?,removed_document_set_ids?}`; union/remove/select live sets; `{}` |
| `DELETE /manage/admin/user-group/:id` | Tombstones record, empties shared membership; `{}` |
| `GET /manage/user-groups/minimal` | Transform applies names/deletions/additions to `{id,name}` catalog |
| `GET /manage/admin/connector/status` | Chained after Save Controls' live projection; Groups decorates seeded and new rows with current groups selecting them. Group resource joins read the same projection. |
| `GET /me` group decoration | Adds literal `manage:user_groups` token when `admin` present, because native New Group checks that exact token; does not grant saved group's permission list |

Users also defines standalone add-users/member-only PATCH fallbacks, but root passes `ownsGroupWrites:true`; Groups above is the only composed writer. Deleting accepted user removes membership; group list filters nonexisting users. Agent access membership join sees these actual live groups. Group association with an agent is not the same field as root agent `group_shares`, so it does not automatically grant agent access.

### Token limits

| Route / owner | Contract |
|---|---|
| `GET /admin/token-rate-limits/user-groups` / Groups | Object keyed **group name** to current limit arrays. Duplicate names collide in object projection. |
| `GET/POST /admin/token-rate-limits/user-group/:id` / Groups | GET array; POST body retained + allocated `token_id` > max(existing,600), returns row. |
| `PUT/DELETE /admin/token-rate-limits/user-group/:id/rate-limit/:tokenId` / Groups | PUT replaces matching row with body + numeric token_id, returns supplied row even if token wasn't present; DELETE filters; `{}`. Group itself must exist. |
| `GET/POST /admin/token-rate-limits/global`, `GET/POST /admin/token-rate-limits/users` / Admin Pages | GET seeded/saved array; POST stores `{token_id,enabled,token_budget:null default,period_hours,cost_budget_cents:null default}` using max(global/user IDs,6500)+1; returns row. |
| `PUT/DELETE /admin/token-rate-limits/rate-limit/:id` / composed | Admin Pages tries global/user rows, then Groups tries group rows. PUT merges body and returns row; DELETE removes and `{}`; unknown IDs fall through. |

These are UI records only: no actual request budget enforcement, metering, reset timer or account limit engine. Craft's staged429 is separate.

## MCP

Owner `handlers-mcp.mjs`: `serverEdits,toolEdits,createdServers,createdTools`; seed `GET /admin/mcp/servers.mcp_servers`, `GET /tool`, `/admin/mcp/mock-creation:{server,tools,fake_credential,auth_feedback}`. Reset on fresh/world switch; same-world keep retains. MCP admin check is raw `/me.role === "admin"` **and** `admin_capabilities` contains `admin`; effective_permissions alone insufficient.

| Route / native action | Input → behavior/response |
|---|---|
| `GET /admin/mcp/servers` | Admin required403; current seed+created rows minus deletions; `{...seed,mcp_servers}` |
| `GET /admin/mcp/servers/:id` | Plural auth detail; admin + existing row,404 missing; row |
| `GET /admin/mcp/server/:id/tools/snapshots` | Singular path; admin + known. `?source=mcp` simulates refresh: status CONNECTED, created tool_count set, last_refreshed_at demo time. Returns tools merged with enabled edits; no discovery. |
| `PATCH /admin/tool/status` | `{tool_ids:[],enabled:boolean}`; non-MCP batch false. Every selected ID must be configured live MCP tool with `permissions.toggle`, else400; saves tool flags; `{updated_count,tool_ids}`. |
| `PATCH /admin/mcp/server/:id` | Any of `name,description,server_url,is_public,groups,users,available_in_craft,tool_policies`; public clears group/user lists; row |
| `PATCH /admin/mcp/server/:id/status` | `?status=CREATED|AWAITING_AUTH|CONNECTED|DISCONNECTED|FETCHING_TOOLS`; invalid400; saves status, `{}` |
| `DELETE /admin/mcp/server/:id` | Tombstone, `{}`; transformed tool lists remove its tools |
| `POST /admin/mcp/server` | `{name,description?,server_url,is_public?,groups?,users?}` | 
| `POST /admin/mcp/servers/create` | Above plus auth fields or `existing_server_id`; creates if needed then `saveAuth()`; returns row. Missing existing404. |
| `POST /admin/mcp/oauth/connect` | `{server_id}`; marks CONNECTED with simulated auth receipt; `{status:"completed",redirect_url:"/admin/mcp-actions/?server_id=<id>&trigger_fetch=true",simulated:true,message}`; no IdP |
| `GET /mcp/servers`, `GET /mcp/servers/persona/:id` | Fixture transforms append created servers/apply edits/delete; retain respective fixture metadata. Does not enforce persona-specific access. |
| `GET /tool` | Transform appends created tools only after server.tool_count>0, applies flags, removes deleted server tools; then Admin Pages merges OpenAPI tools |

The bare `POST /admin/mcp/server` returns `createServer()` row; defaults from mock-creation, server/tool IDs max+1, owner raw fixture email, public default true. Created tools are prepared inventory, not discovered remotely. Auth persisted fields: `transport,auth_type,auth_performer,auth_template,oauth_provider_mode,oauth_authorization_endpoint,oauth_token_endpoint,oauth_scopes_override,oauth_additional_auth_params`; supplied `admin_credentials` values become fake markers. `api_token`/`oauth_client_id`/`oauth_client_secret` use corresponding `_changed` or truthy input to set/clear fake `api_key/client_id/client_secret`. Auth saves status AWAITING_AUTH only for `auth_type:"OAUTH"`, otherwise FETCHING_TOOLS.

Craft reads same MCP metadata through `craftServers()`: `craft_connected` requires status CONNECTED, auth_type not PT_OAUTH, and auth NONE or `user_can_authenticate:true`; `/mcp/servers/craft` further filters `available_in_craft`. `tool_policies` and connection labels are metadata, not execution/header-resolution machinery.

## Remaining admin pages

Owner `handlers-admin-pages.mjs` has one lazy `data` object. `state()` clones the exact GET seeds named below; saves never write YAML. Root forces reseed on world change; same-world keep retains. `defaults()` reads `/mockshop/admin-pages/defaults` with `fake_secret,settings,billing_tiers,api_key_display,hook_creator,export_csv,checkout_feedback_delay_ms`. Generic missing row is404 `{detail:"Fictional admin row not found."}`; generic `nextId` is max(existing,6500)+1. `scrub()` replaces secret/token/api_key/private_key/x509_cert/credential fields, recurses config/custom_config, replaces custom header values; do not treat arbitrary free text as sanitized.

### Workspace, security, assistant and documents

| Write route | Request → mutation/output | Readback seed/route |
|---|---|---|
| `PATCH /admin/settings` | Arbitrary settings DTO merged into `settings`; returns fixture settings + defaults.settings + saved | `GET /settings` same precedence plus billing-case tier when no explicitly saved tier |
| `PATCH /admin/default-assistant` | Merge native configuration (`tool_ids,system_prompt,...`), returns config | `GET /admin/default-assistant/configuration` |
| `PUT /admin/security` | Only keys already present in seed accepted; body null resets key to original seed; returns security | `GET /admin/security`; pinned fields separate static fixture |
| `PUT /admin/code-interpreter` | `{enabled}`; returns `{enabled,...seed}` | `GET /admin/code-interpreter`; health remains separate fixture, no interpreter starts |
| `POST /admin/search` | `{query}` case-insensitive substring of semantic_identifier/blurb; `{documents}` without private feedback_bucket | Local `documents`, only loaded after reset `{admin_documents_fixture:"loaded"}` from `/mockshop/admin-pages/documents` |
| `GET /manage/admin/doc-boosts` | `?ascending=true` selects `feedback_bucket:"disliked"`, else liked; array `{document_id,semantic_id,link,boost,hidden}` | Same local documents |
| `POST /manage/admin/doc-boosts`, `POST /manage/admin/doc-hidden` | `{document_id,boost}` or `{document_id,hidden}`; updates found row; `{simulated:true}`; unknown false | Same store, not User Search/chat or real index |

Security seed keys: `user_directory_admin_only,incognito_availability,incognito_record_mode,allow_connector_group_restrictions,track_external_idp_expiry,allow_same_provider_subject_relink,ssrf_protection_level,mask_credential_prefix,llm_custom_config_env_injection,valid_email_domains,password_min_length,password_max_length,password_require_uppercase,password_require_lowercase,password_require_digit,password_require_special_char,password_auth_enabled,jwt_public_key_url,jwt_expected_audience,jwt_expected_issuer`. Saving does not modify real auth, network policy or actual SSRF behavior.

### Search/content, voice, tracing, image providers

| Exact routes | Contract |
|---|---|
| `GET /admin/web-search/search-providers`, `GET /admin/web-search/content-providers` | Respective `webSearch`/`webContent` arrays. |
| `POST /admin/web-search/search-providers/test`, `POST /admin/web-search/content-providers/test` | Unconditional `{simulated:true,message:"Local fictional configuration accepted; no provider was contacted."}`; no mutation/validation. |
| `POST /admin/web-search/search-providers`, `POST /admin/web-search/content-providers` | `{id?,name,provider_type,config?,api_key?,activate?}` creates/replaces row `{id,name,provider_type,config,masked_api_key,is_active}`. Active clears others in same category. Omitted key preserves. Returns row. |
| `POST /admin/web-search/search-providers/:id/activate`, `/deactivate`; `POST /admin/web-search/content-providers/:id/activate`, `/deactivate` | Known row; activation clears peers; return row. |
| `POST /admin/web-search/content-providers/reset-default` | Sets active only for provider_type `onyx_web_crawler`; returns array. No delete handler for these categories. |
| `GET /admin/voice/providers`, `POST /admin/voice/providers` | POST full provider DTO/id?, scrubbed `api_key/api_secret`, `target_uri`, `activate_stt/activate_tts` mapped to default flags; clears peer defaults per mode; row. |
| `POST /admin/voice/providers/test` | Unconditional simulated test receipt; no speech/provider call. |
| `POST /admin/voice/providers/:id/activate-stt`, `/deactivate-stt`, `/activate-tts`, `/deactivate-tts` | Set chosen flag; activation clears peers; optional `?tts_model` saved even on mode route; row. |
| `DELETE /admin/voice/providers/:id` | Filters ID; `{}`; static `/voice/status` is not recomputed. |
| `GET /admin/tracing/providers`, `POST /admin/tracing/providers` | POST finds seeded `provider_type` only,404 absent; `{config,enabled,api_key_changed?,api_key?}` updates config, `masked_api_key`, connected enabled&&hasKey, source db/none; row. Does not create new provider_type. |
| `POST /admin/tracing/providers/test` | Unconditional simulated receipt. |
| `GET /admin/image-generation/config`, `POST /admin/image-generation/config`, `PUT /admin/image-generation/config/:id` | Save `{image_provider_id (POST),model_name,source_llm_provider_id?,is_default?,api_base?,api_version?,deployment_name?,custom_config?}`; row `{image_provider_id,model_name,model_configuration_id,llm_provider_id,llm_provider_name,is_default}`. Source provider lookup reads the sole live `saveControls.providerRows()` catalog; unknown ID falls back to ID6501/name. Saved source name/id remains a snapshot until next save. Separate imageCredentials map uses fake keys. |
| `GET /admin/image-generation/config/:id/credentials` | Saved credentials only; seeded config alone does not seed credentials;404 absent. |
| `POST /admin/image-generation/test` | Unconditional simulated receipt; no image generation. |
| `POST /admin/image-generation/config/:id/default`, `DELETE /admin/image-generation/config/:id/default` | Set/unset default; activation clears others; row. Strict ID comparison uses string path, so author string image_provider_id values. |
| `DELETE /admin/image-generation/config/:id` | Removes config and credential record; `{}`. |

### Service accounts, SSO, SCIM, search configuration

| Routes | Request → actual effect |
|---|---|
| `GET /admin/api-key`, `POST /admin/api-key` | POST `{name?,group_ids?}` stores a fictional Service Account with `user_id:"fake-service-ID"` joined to sole live Groups memberships. GET projects current names/memberships; seeded account memberships join once per fresh state. Returns fake `api_key` once; stored rows keep `api_key:null`. |
| `PATCH /admin/api-key/:id` | `{name?,group_ids?}`; replaces sole Groups memberships (omitted IDs clears); returns current row. Native Group add/remove-user writes read back from the same memberships. |
| `POST /admin/api-key/:id/regenerate` | Changes display suffix `-regenerated`, returns row+fake key. No real key validity. |
| `DELETE /admin/api-key/:id` | Removes account, sole-store Group memberships and seed-join marker; `{}`. No real account/key operations. |
| `GET /admin/enterprise-settings/scim/token`, `POST /admin/enterprise-settings/scim/token` | POST `{name}` replaces single metadata record with incremented ID, display/is_active/created_at/last_used_at/idp_domain; returns plus `raw_token:fake`. No SCIM sync. |
| `GET /admin/sso/provider`, `POST /admin/sso/provider` | POST scrubbed provider DTO; new id, enabled:true, `redirect_uri:"/mockshop/fake-sso/<name>"`; row. The URI is metadata, not an implemented SSO endpoint. |
| `PATCH /admin/sso/provider/:id` | Merge scrubbed DTO; row. |
| `POST /admin/sso/provider/:id/enabled` | `{enabled}` saves, row; no identity provider connection. |
| `POST /admin/sso/domain/records` | `{domains:[]}` → `{domains:[{domain,verified,claimed,record_host:"_onyx-demo.<domain>",record_value:"mock-only-no-dns-verification"}]}`; claimed derived from providers.allowed_email_domains. |
| `POST /admin/sso/domain/verify-dns` | `{domain}` sets in-memory verified flag; same records + simulated:true; **no DNS lookup**. Static `GET /admin/sso/domain` is not the live writer's store. |
| `GET /admin/embedding/embedding-provider`, `PUT /admin/embedding/embedding-provider` | Scrubbed DTO upsert by provider_type; returns submitted scrubbed DTO. |
| `DELETE /admin/embedding/embedding-provider/:id` | Removes by provider_type string; `{}`. |
| `POST /admin/embedding/test-embedding` | Unconditional local test receipt. |
| `POST /search-settings/set-new-search-settings` | Merge scrubbed body into `search`, force `use_port_flow:true`, clear secondary; returns search. No actual reindex staging. |
| `POST /search-settings/update-inference-settings` | Merge scrubbed body into search; returns search. |
| `POST /search-settings/cancel-new-embedding` | Clears secondary; `{}`. |
| `GET /search-settings/get-current-search-settings`, `GET /search-settings/get-secondary-search-settings` | Current objects from above store. |
| `PUT /search-settings/upsert-unstructured-api-key` | `{unstructured_api_key}` → store/return boolean truthiness only. |
| `DELETE /search-settings/delete-unstructured-api-key` | Store/return false. |
| `GET /search-settings/unstructured-api-key-set` | That boolean; no retained key. |

Search DTO includes `model_name,model_dim,normalize,query_prefix,passage_prefix,provider_type,api_key,api_url,index_name,multipass_indexing,enable_contextual_rag,contextual_rag_model_configuration_id,multilingual_expansion,disable_rerank_for_streaming,num_rerank,reduced_dimension,vector_quantization,rerank_model_name,rerank_provider_type,rerank_api_key,rerank_api_url,use_port_flow`. Progress/errors/cost estimates remain independent fixtures.

### Slack, Discord, hooks and standard answers

| Exact routes | Payload / mutation / response |
|---|---|
| `GET /manage/admin/slack-app/bots` | Bot array with computed configs_count/slack_channel_configs from current channels. |
| `GET /manage/admin/slack-app/bots/:id`, `GET /manage/admin/slack-app/bots/:id/config` | Detail404 or current channel array filtered slack_bot_id; channels pass through `channelView`. |
| `POST /manage/admin/slack-app/bots`, `PATCH /manage/admin/slack-app/bots/:id` | Scrubbed native bot DTO; allocate/merge; row. No Slack call. |
| `DELETE /manage/admin/slack-app/bots/:id` | Removes bot and its channels; `{}`. |
| `GET /manage/admin/slack-app/channel` | `channelView` resolves selected `persona_id` from the sole current root Agent (unknown ID retains saved snapshot). Without an Agent, selected Document Sets refresh by ID from their live owner; All Public has `persona:null`. |
| `POST /manage/admin/slack-app/channel`, `PATCH /manage/admin/slack-app/channel/:id` | Form `slack_bot_id,persona_id?,document_sets?,enable_auto_filters,channel_name,respond_tag_only,respond_to_bots,is_ephemeral,show_continue_in_web_ui,respond_member_group_list,answer_filters,follow_up_tags,disabled,standard_answer_categories,response_type?`. Builds current Agent persona, a `__slack_bot_persona__fictional` persona with selected live sets, or null for All Public. Stores channel_config; `is_default:!channel_name`; current category IDs; returns `channelView` with stable selected IDs. Saved `response_type` initializes native Answer Type; absent value falls back to `citations`. No Slack call. |
| `DELETE /manage/admin/slack-app/channel/:id` | Remove, `{}`. |
| `GET /manage/admin/discord-bot/config`, `POST /manage/admin/discord-bot/config`, `DELETE /manage/admin/discord-bot/config` | POST discards body and sets configured:true/created_at; DELETE false/null; return config or `{}`. |
| `GET /manage/admin/discord-bot/guilds`, `POST /manage/admin/discord-bot/guilds` | POST creates unregistered enabled row with null guild fields/default_persona_id, empty channels; `{id,registration_key:fake}`. No guild registration. |
| `GET/PATCH/DELETE /manage/admin/discord-bot/guilds/:id` | GET row; PATCH arbitrary fields; DELETE row/channel map and `{}`. |
| `GET /manage/admin/discord-bot/guilds/:id/channels`, `PATCH /manage/admin/discord-bot/guilds/:id/channels/:channel` | List or merge existing channel; missing channel404. Initial channel seed is hardcoded guild6501 only. |
| `GET /admin/hooks/specs`, `GET /admin/hooks` | Static specs (registered before :id) and current hooks. |
| `POST /admin/hooks`, `GET/PATCH/DELETE /admin/hooks/:id` | POST scrubbed DTO, fake api_key_masked, active/reachable true, creator/default and timestamps; GET row; PATCH merge/update timestamp/key mask; DELETE also logs; row or `{}`. |
| `POST /admin/hooks/:id/activate`, `/deactivate` | Set is_active; row. |
| `POST /admin/hooks/:id/validate` | Existing hook → append log `{error_message:null,status_code:200,duration_ms:0,created_at}`; `{status:"passed",error_message:null,simulated:true}`. **No HTTP hook execution.** |
| `GET /admin/hooks/:id/execution-logs` | Local validation logs or[]; not system hook execution history. |
| `GET/POST /manage/admin/standard-answer`, `PATCH/DELETE /manage/admin/standard-answer/:id` | POST/PATCH body retained with ID and categories resolved from ID array; row; DELETE removes, `{}`. No chat matcher uses these answers automatically. |
| `GET/POST /manage/admin/standard-answer/category`, `PATCH /manage/admin/standard-answer/category/:id` | Create/merge native category DTO; PATCH propagates category snapshot into existing answer.categories; row. No category-delete handler. |

### Craft app administration, tools, federated configuration

| Exact routes | Contract |
|---|---|
| `GET /build/admin/apps` | Current sole app catalog, reconciled by Craft skills owner. |
| `POST /build/admin/apps/built-in`, `POST /build/admin/apps/custom` | Scrubbed native DTO, descriptor by app_type from `/build/admin/apps/built-in/options`; derives upstream_url_patterns/auth_template/default actions, enabled:true, id, credential_placeholder_keys, associated_skills:[], is_onyx_managed:false. `action_policies` maps action_id to state. Returns app; no external installation. |
| `PATCH /build/admin/apps/:id` | Shallow assign scrubbed body; action_policies update existing actions; `associated_skill_ids` reconciles live custom skills; row. |
| `DELETE /build/admin/apps/:id` | Reconcile before/after removal so Craft disables former associated skills, removes user credential state, marks sessions stale; `{}`. |
| `GET /tool/openapi` | Current OpenAPI tool rows. |
| `POST /admin/tool/custom/validate` | `{definition:{paths:{path:{method:operation}}}}` → `{methods:[{name:operationId or method_path,summary:summary or path,path,method,spec,custom_headers:[]}]}` for get/post/put/patch/delete/head/options. No operation →400. Does not validate entire OpenAPI spec or contact API. |
| `POST /admin/tool/custom`, `PUT /admin/tool/custom/:id` | Scrubbed tool DTO; create sets id/display_name/name, enabled/chat_selectable/agent_creation_selectable true, default_enabled:false,mcp_server_id:null,in_code_tool_id:null, permissions edit/toggle/delete true. PUT merges and updates display_name; row. |
| `DELETE /admin/tool/custom/:id` | Remove, `{}`. |
| `PATCH /admin/tool/status` | All IDs must belong to current OpenAPI rows, else false to MCP; sets enabled; `{updated_count,tool_ids}`. |
| `GET /tool` | Merges current OpenAPI rows, replacing matching IDs after MCP transform. Not an execution backend. |
| `POST /admin/oauth-config/create` | Scrubbed native DTO + id, has_client_credentials:true,tool_count:0,created_at/updated_at; row. |
| `GET/PUT /admin/oauth-config/:id` | Current row or scrubbed merge/update timestamp;404 unknown. `oauthConfigs` starts empty; no list/delete route declared. |
| `GET/POST /federated`, `GET/PUT/DELETE /federated/:id` | Sole run-local collection seeded from the world list and defined detail. POST allocates a non-reused numeric ID and source-defined name/config/scrubbed credentials. Numeric reads/writes404 if missing; nonnumeric literals fall through to existing owners. PUT preserves omitted config/credentials; DELETE removes only that row. Catalog and Document Sets read the same owner. Keep retains; fresh reseeds. Personal OAuth status is unchanged. |
| `POST /federated/sources/federated_slack/credentials/validate` | Unconditional simulated receipt. Config/credential schema reads are static. |

### Branding, banners, reports and analytics

| Exact routes | Contract |
|---|---|
| `PUT /admin/enterprise-settings` | Merge body into enterprise overrides; returns seed+saved; `GET /enterprise-settings` applies after Extras branding. No compile-time edition change. |
| `PUT /admin/enterprise-settings/custom-analytics-script` | `{script? or custom_analytics_script?}` saves chosen value or null; `{simulated:true}`. Submitted `secret_key` is ignored by mock. |
| `GET /enterprise-settings/custom-analytics-script` | Saved-or-seed string encoded as a **JSON string** with application/json (native reader calls response.json), otherwise value. Patch0012 refreshes form/SWR readback; no analytics collector is implemented. Authored JavaScript may be consumed by native frontend: use harmless demo text, not real tracking. |
| `PUT /admin/enterprise-settings/logo` | Multipart first image part; validates boundary/content-type image/*,400 otherwise; **retains image bytes in memory** and use_custom_logo:true; `{simulated:true}`. |
| `GET /enterprise-settings/logo` | Uploaded image bytes/type served raw (`res.writeHead`/`res.end`, `cache-control:no-store`), ahead of Extras' seeded branding PNG. Without upload falls through to enabled branding, else404. Fresh reset clears upload and restores the seed. |
| `GET/PUT/POST/DELETE /admin/banner` | PUT/POST store full body + updated_at and reset dismissal, return banner; DELETE null. `title,content,show_as_popup` feed notification65065. |
| `POST /notifications/65065/dismiss` | bannerDismissed:true, `{}`. Composed GET notifications/summary add announcement; no deleted banner row remains after DELETE. |
| `GET/POST /admin/usage-report` | POST `{report_id,period_from,period_to}` appends `{report_name:"fictional-usage-ID.csv",requestor:defaults.hook_creator,time_created,period_from,period_to}`; row. |
| `GET /admin/usage-report/:id` | Any ID returns same defaults.export_csv as attachment fictional-usage.csv; not generated from current users/date window. |
| `POST /admin/query-history/start-export` | Body/query `start,end` (query wins), defaults demo now; immediate SUCCESS metadata task/request ID fake-query-N; returns `{request_id}`. |
| `GET /admin/query-history/list`, `GET /admin/query-history/export-status`, `GET /admin/query-history/download` | List current exports; status always `{status:"SUCCESS"}`; download same canned CSV. No asynchronous export. |
| `POST /admin/log-export` | Creates 32-char hex export ID, ready state, fictional-worker `no_logs_found` receipt, no pending workers; `{export_id}`. |
| `GET /admin/log-export/:id`, `GET /admin/log-export/:id/download` | Known metadata or raw 22-byte empty ZIP attachment (`application/zip`, `filename=fictional-no-logs.zip`);404 unknown. Native page reads Content-Disposition and a blob. Reset clears the single `logs` state; no log collection. |
| `GET /admin/chat-session-history` | Fixture transform filters `feedback_type` (all ignores), start_time/end_time; slices page_num/page_size; `{items,total_items}`. No live normal-chat feed. |
| `GET /admin/usage/export`, `GET /admin/usage/system` | Fixture transforms filter each `users`/`categories` row.records by day start/end; recompute each totals field by sum; drop rows with no remaining records; replace start/end. |
| `GET /analytics/admin/query`, `GET /analytics/admin/user`, `GET /analytics/admin/onyxbot` | Fixture arrays filtered by date start/end only; no live aggregation. Persona analytics/individual history details remain static fixtures. |

### License and billing

| Route / native button | Request → behavior |
|---|---|
| `POST /license/upload` | Consumes/discards selected/pasted fake bytes; local license extends seed, sets has_license:true,issued_at,status:active,source:manual_upload,expiry_warning_stage:none; removes status-envelope keys; `{success:true,message}`. No signature validation. |
| `POST /license/refresh` | Adds last_refreshed_at to local license; success receipt; no server call. |
| `GET /license` | Keeps Community error envelope while no override; otherwise default license metadata + fixture + local override. Refresh alone does not necessarily remove existing error-envelope fields; upload explicitly does. |
| `GET /tenants/billing-information` | Uses snapshot selected by `/mockshop/admin-pages/billing-case` from `/mockshop/admin-pages/billing-snapshots`; null selector keeps baseline fixture. |
| `POST /tenants/seats/update` | `{new_seat_count}` only if selected billing exists and has no `subscribed` key, else false. Updates displayed seats, used_seats counted from live accepted and fixture slack users' is_active. `{success,current_seats,used_seats,message}`. No minimum/card/pricing validation. |
| `POST /admin/billing/end-trial` | Only current status trialing, else false; ignores body, sets active/trial_end:null; `{success:true,stripe_subscription_id:"mock-only-display-65",status}`. |
| Checkout: `POST /tenants/create-checkout-session` | `{billing_period,seats}` recorded only as choices; waits defaults.checkout_feedback_delay_ms; returns `{stripe_checkout_url:""}` deliberately to trigger native invalid-response feedback. No fake external Stripe URL. |
| Manage Plan: `POST /tenants/create-customer-portal-session` | `{return_url,...}`; records request key names and parsed return path, not account text; `{stripe_customer_portal_url:"/api/mockshop/admin-pages/billing-portal"}`. |
| `GET /mockshop/admin-pages/billing-handoffs` | `{checkout,portal}` receipts with `provider_contacted:false`. |
| `GET /mockshop/admin-pages/billing-portal` | Read-only same-origin HTML explaining local fake handoff, link back to native Billing. No account/subscription mutation. |

Edition Cloud/native route gates are independent of billing snapshot fields. A successful seat or trial UI transition is not evidence of real billing authorization or charging.

## Operating recipes and unsupported boundaries

1. **Provider edit and chat label:** seed complete admin provider/model IDs; open native edit, save via PUT, read full/public catalog; set default or session model; send prepared reply and assert assistant's frozen model. Test button only checks required fields; never report a live connection.
2. **Connector creation:** POST connector → POST credential (or local simulated landing POST) → PUT connector/credential binding. Without binding there is no pair row. Bound pairs and renames appear in Document Set selection/validation, `GET /manage/connector` and Group resources through the sole live projection.
3. **Group lifecycle:** seed accepted users + group create_defaults/resource_permissions/registry; native create can call member/agent/set/limit writes sequentially. Patch0008 refreshes list caches before navigation. User deletion joins actual membership; resource names refresh by stable IDs, not duplicate stores.
4. **MCP authentication/refresh:** provide mock-creation server/tools/fake marker; create/save auth → optional local OAuth connect → GET snapshots?source=mcp to expose prepared tools → toggle enabled. This changes metadata only; Craft visibility additionally needs available_in_craft and craft_connected rule.
5. **Admin document feedback:** reset with `admin_documents_fixture:"loaded"` while selecting the correct compiled world (raw control-plane POST; not a new keyed-screen field), then search/boost/hide. A keep reset does not change the already loaded documents flag.
6. **Permission/error/empty demos:** author fixture flags and rows consumed by the exact page, or explicit error DTO at a fixture-owned route. A dynamic route wins over an identically named `__status` fixture, so use its documented validation/staging path. No implicit server authorization should be invented.
7. **OAuth Test claims:** supply prepared `/admin/oauth-test/claims` and optional `/mockshop/admin-pages/oauth-claims-rerun`/`oauth-claims-empty` DTOs. Native diagnostic rerun redirects locally and replaces only the snapshot; it does not authenticate a user. Fresh `admin_oauth_claims_fixture:"empty"` selects a found-but-empty capture, distinct from the neutral no-snapshot state; keep retains its selector. Actor/provider/other Admin records remain unchanged.

There are no handlers for many upstream operations (for example arbitrary SSO deletion, actual connector workers, real API-tool execution). Absence is an intentional compatibility boundary, not permission to rely on non-strict empty success. See the fixture inventory for successful static no-op endpoints and use strict miss evidence to classify anything else.
