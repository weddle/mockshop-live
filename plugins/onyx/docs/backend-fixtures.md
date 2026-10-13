# Fixture inventory, frontend patches and coverage boundaries

[API map](../API-MAP.md) · [Runtime/dispatch](backend-runtime.md) · [Chat](backend-chat.md) · [User](backend-user.md) · [Admin](backend-admin.md) · [Craft](backend-craft.md) · [Auth](backend-auth.md)

Source-derived from every route in `fixtures/base/00-core.yaml`, `fixtures/edition-enterprise/00-edition.yaml`, all handler modules, plugin manifest and all checked-in patches. Neutral fixtures are platform defaults, not a complete demonstration world. A static success response is not evidence an operation was implemented.

## How to author specialized fixture DTOs

Put exact native route values under `apps.onyx.fixtures` in the world. Adapter generates the ordinary fixture table; handlers read those values as seeds. This is **whole-response replacement**, not recursive API patching. Supply the collection/object fields the handler reads, even if empty. `core.fixture()` does not invoke another module's transforms, so keep relation IDs and snapshot names coherent or use the shared world's canonical entities.

Three different situations:

1. **Dynamic route with seed:** `GET /admin/llm/provider` is served by Save Controls after cloning the seed. Replacing that fixture with an error envelope does not bypass its code and may break expected fields.
2. **Transformed fixture:** `GET /settings` matches a fixture, then root/Auth/Extras/Admin Pages transforms project saved state. A fixture must exist for this pipeline to run.
3. **Fixture only:** `POST /auth/refresh` returns `{}` with no mutation. A native UI may treat it as success, but no refresh service runs.

For fixture-owned intentional errors use `{__status:<HTTP>,__body:<native error shape>,__headers?:{...}}`. Dynamic handlers need their own documented validation or stage control. For a JSON scalar string use an envelope with `__body: JSON-encoded string` and `content-type:application/json` (as custom analytics transform does); ordinary strings otherwise send text/plain. Fixture `{{param:name}}` replaces path captures; time tokens are explained in runtime docs. Arrays do not inherit omitted items from base.

## Neutral platform reads and static-only operations

These routes either stay fixture-only or have the noted small transform. Exact remaining dynamic/readback routes are indexed by owner below.

| Exact route(s) | Base shape and behavior |
|---|---|
| `GET /health` | `{success:true,message:"ok"}`; not a health check of real services. |
| `GET /version` | `{backend_version:"v3.4.0"}` display metadata. |
| `GET /auth/type` | Basic auth metadata: `auth_type:basic,multi_tenant:false,requires_verification:false,anonymous_user_enabled:false,password_min_length:8,password_max_length:64,password_require_uppercase/lowercase/digit/special_char:false,has_users:true,oauth_enabled:false,password_auth_enabled:true,sso_providers:[]`. Auth overrides only when enabled. |
| `POST /auth/refresh` | `{}`; **static no-op**, no token renewal. |
| `GET /tenants/anonymous-user` | `{}`; no mode mutation (enabled Auth owns POST instead). |
| `GET /chat/incognito-availability` | `{available:true}`. Root saved sessions still serialize `incognito:false`; no incognito retention engine. |
| `GET /chat/max-selected-document-tokens` | `{max_tokens:0}` neutral; set a positive authored capacity to stage selection UI. Not computed from actual files. |
| `GET /chat/available-context-tokens/:id` | `{available_tokens:0}` neutral; not consumed-token accounting. |
| `GET /temperature-default`, `GET /reasoning-effort-default` | null seeds. PATCH routes write `/me` preference overlays; these GET fixtures are not transformed to those saved values. |
| `GET /voice/status` | `{tts_enabled:false,stt_enabled:false}`; independent of admin provider saves. No audio generation/transcription endpoint. |
| `GET /admin/voice/voices` | [] prepared voice inventory; independent from live voice provider array. |
| `GET /admin/code-interpreter/health` | `{connected:false,error:""}`; code enabled save does not run interpreter/health check. |
| `GET /admin/security/pinned-fields` | [] names pinned by native form; no mutable pinned-fields handler. |
| `GET /admin/sso/provider-type` | [] provider descriptors; author native descriptor rows to populate Add SSO choices. No dynamic discovery. |
| `GET /admin/sso/domain` | `{domains:[]}`; independent of POST domain records/verify-dns live flags. |
| `GET /admin/llm/custom-provider-names` | [] native provider-name list; not updated by provider saves. |
| `GET /admin/llm/provider-contextual-cost` | [] prepared contextual-indexing cost rows; no cost computation. |
| `GET /search-settings/reindex-progress` | `{total:0,waiting:0,in_progress:0,completed:0,failed:0,paused:0}`; does not advance after search-config writes. |
| `GET /search-settings/reindex-errors` | [] prepared rows; no worker errors generated. |
| `GET /manage/admin/opensearch-health` | `{issues:[]}`; no cluster connection. |
| `POST /manage/admin/opensearch-health/popup` | `{}`; **static no-op** acknowledgement. |
| `POST /manage/admin/connector-checks/plan` | `{checks:[]}`; **static no-op** plan, not connector validation. |
| `POST /manage/admin/credential/:id/binding-check` | `{field_errors:{},rejection:null}`; **static no-op** accepts shape without credential verification. |
| `GET /manage/connector-group-restrictions` | `{enabled:false}`; seed only; group permission/resource edits do not set it. |
| `GET /manage/admin/cc-pair/:id/index-attempts`, `GET /manage/admin/cc-pair/:id/errors` | Neutral `{items:[],total_items:0}` seeds; adapter can author attempts/errors. Attempts remain fixture-only; Save Controls owns paginated live error reads, not an attempt worker. |
| `GET /manage/admin/cc-pair/:id/permission-sync-attempts`, `GET /manage/admin/cc-pair/:id/external-group-sync-attempts` | `{applicable:false,items:[],total_items:0}`; exact source mapping permission_sync/group_sync can override. No sync engine. |
| `GET /federated` | Neutral [] seed; Admin Pages owns the live create/list/update/delete collection and Document Set reader. Empty seeds do not fabricate a configured connector. |
| `GET /federated/sources/federated_slack/credentials/schema` | `{credentials:{bot_token:{type,description,required,secret}}}` neutral empty/false values; author actual native schema metadata. |
| `GET /federated/sources/federated_slack/configuration/schema` | `{configuration:{channel_names:{type,description,required,secret}}}`; no dynamic schema discovery. |
| `GET /build/admin/base-instructions` | `{content:""}`; no save route here. Craft settings/instructions must target their real owner, not assume this is writable. |
| `GET /build/admin/apps/built-in/options` | [] descriptors consumed by admin app creation: app_type,upstream_url_patterns,auth_template,actions. Not fetched from app vendors. |
| `GET /admin/hooks/specs` | [] specs, read by an explicit Admin Pages route before hook-ID matching; no execution. |
| `GET /analytics/admin/persona/messages`, `GET /analytics/admin/persona/unique-users` | [] fixture metrics; unlike query/user/onyxbot they have no date-filter transform. |
| `GET /admin/chat-session-history/6501` | One neutral exact-detail object `{id,user_email,name,assistant_id,assistant_name,time_created,flow_type,messages}`. Other IDs need explicit fixtures; list/filter writes do not create detail routes. |
| `GET /admin/oauth-test/claims` | Neutral no-snapshot `{found:false,email:"",captured_at:null,oauth_name:null,id_token_claims:null,userinfo:null,directory_profile:null,directory_source:null,resolved_profile:null,enrichment_enabled:false,token_meta:null}`. Admin Pages owns prepared readback and optional `/mockshop/admin-pages/oauth-claims-{rerun,empty}` DTOs; no JWT/IdP claim capture. |
| `GET /admin/billing/billing-information` | `{subscribed:false}`; separate from live transformed `/tenants/billing-information`. |
| `GET /admin/cost-overrides` | [] fixture cost rows; no save handler declared. |
| `GET /users` | Neutral [] sharing-directory; adapter generates people. Extras shares/transfers use current accepted Users, preserving unchanged same-ID seed DTOs, rather than a stale raw directory. |
| `GET /user/pats/scopes` | [] scope descriptions; PAT creation does not populate scope inventory. |
| `GET /user-oauth-token/status` | [] status metadata; not updated by personal connector/OAuth-grant writers. |

### Complete dynamic seed/readback family index

Every other base fixture route belongs to one of these explicit owner contracts; repeated aliases are listed because seed vs runtime owner differs.

| Exact seed/readback routes | Owner and operational details |
|---|---|
| `GET /me`, `GET /settings` | Root composition, [runtime](backend-runtime.md). Base admin identity/preferences/settings fields below. |
| `GET /enterprise-settings`, `GET /license` | Community explicit404; enterprise overlay + [Admin Pages](backend-admin.md#branding-banners-reports-and-analytics) transforms. |
| `GET /persona`, `GET /persona/0`, `GET /admin/persona`, `GET /admin/agents`, `GET /user/pinned-assistants` | [Root agents](backend-user.md#agents-and-pins). Base only builtin Assistant0. Catalog/detail/flags are complete native DTOs, not names alone. |
| `GET /persona/labels` | Extras fixture+added labels; [user](backend-user.md#extras). |
| `GET /tool`, `GET /tool/openapi` | Base builtins plus MCP then saved OpenAPI composition; Agent save/readback uses that same live catalog. [Admin](backend-admin.md#mcp). |
| `GET /mcp/servers`, `GET /mcp/servers/persona/11`, `GET /mcp/servers/persona/:id`, `GET /admin/mcp/servers`, `GET /admin/mcp/server/1/tools/snapshots`, `GET /admin/mcp/mock-creation` | MCP inventories and creation defaults. Literal persona11 includes assistant_id in neutral DTO; parameter route only mcp_servers. Dynamic admin tools route wins over exact tools fixture and derives tools from `/tool`. |
| `GET /manage/admin/user-group`, `GET /manage/user-groups/minimal`, `GET /mockshop/admin-groups/seeds`, `GET /manage/admin/permissions/registry` | [Groups](backend-admin.md#users-and-groups). Registry static IDs/tokens below; actual stores/mutations in Groups. |
| `GET /manage/users`, `GET /manage/users/accepted/all`, `GET /manage/users/invited`, `GET /tenants/users/pending`, `GET /manage/users/counts`, `GET /manage/users/mock-feedback` | [Users](backend-admin.md#users-and-groups). Neutral empty users/counts; mock-feedback `{simulated:false,invite_message:"",reset_password:""}` must be authored for meaningful fake invite/reset messages. |
| `GET /manage/document-set`, `GET /manage/admin/connector/status` | Document Set seed and connector selector rows; Save Controls projects current pair metadata and Groups decorates selections. [Admin](backend-admin.md#document-sets). |
| `POST /manage/admin/connector/indexing-status`, `GET /manage/connector-status`, `GET /manage/admin/credential`, `GET /mockshop/save-controls` | Org-keyed connector/provider writer seeds; [Save Controls](backend-admin.md#providers-connectors-and-credentials). |
| `GET /manage/admin/similar-credentials/google_drive`, `/slack`, `/zoom`, `/jira`, `/confluence` (all GET) | Neutral exact empty arrays; Save Controls dynamic similar-credentials derives actual live credential rows for any source. |
| `GET /connector/oauth/details/google_drive`, `/slack`, `/zoom`, `/jira`, `/confluence` (all GET) | Neutral `{oauth_enabled:false,additional_kwargs:[]}`; dynamic handler overrides flags using mock save-controls.oauth_sources. |
| `GET /llm/provider`, `GET /llm/persona/:id/providers`, `GET /admin/llm/provider` | Neutral OpenAI prepared catalog; mutable authority is admin catalog, not the repeated public list. |
| `GET /admin/llm/built-in/options/ollama_chat`, `/openai`, `/anthropic` (all GET), `POST /admin/llm/ollama/available-models` | Exact options/available-model fixtures are intentionally blank; dynamic handler uses them before generic fallback. Author these for dropdown/discovery demos. |
| `GET /user/projects`, `GET /user/files/recent`, `GET /user/projects/session/:id/files`, `GET /mockshop/user-files` | [Files/projects](backend-user.md#files). Empty neutral catalogs; exact filename upload match and backing byte IDs required. |
| `GET /chat/get-user-chat-sessions`, `GET /query/valid-tags`, `GET /mockshop/user-search-seed` | [Chat/search](backend-chat.md). Empty history; search regexes `(?!)` disable intentional match/empty/error branches; generated shared docs populate search. |
| `GET /input_prompt`, `GET /user/pats`, `GET /oauth-provider/grants`, `GET /federated/oauth-status`, `GET /user/usage` | [User settings](backend-user.md#user-preferences-memories-tokens-and-connectors). Usage has per_day_by_model, cost/budget/reset/pricing fields; only date filtering and selected model pricing are computed. |
| `GET /notifications`, `GET /notifications/summary`, `GET /mockshop/user-extras`, `GET /mockshop/user-extras-options` | Extras notifications/identity/branding/agent defaults; dynamic response differs from neutral summary `{unread_count:0,max_severity:null}` because Extras returns total_items/undismissed_count. |
| `GET /mockshop/sharing-feedback/seeds`, `GET /mockshop/browser-extension/seed` | [Sharing/extension](backend-chat.md#sharing-and-feedback). Empty disabled fictional inventories; share failure strings/tab matching must be explicit. |
| `GET /mockshop/auth-anonymous/content`, `GET /mockshop/auth-anonymous/staging`, `GET /mockshop/user-conditional/content`, `GET /mockshop/user-conditional/staging` | [Auth/conditional](backend-auth.md). Enabled flags false. Never enable blank status0 callback cases. |
| `GET /mockshop/user-craft`, `GET /skills` | [Craft](backend-craft.md). Dynamic /skills reads mockshop seed, not standalone empty /skills DTO. |
| `GET /admin/web-search/search-providers`, `GET /admin/web-search/content-providers`, `GET /admin/image-generation/config`, `GET /admin/voice/providers`, `GET /admin/tracing/providers` | Admin Pages mutable provider arrays, [Admin](backend-admin.md#remaining-admin-pages). |
| `GET /admin/code-interpreter`, `GET /admin/default-assistant/configuration`, `GET /admin/security`, `GET /admin/sso/provider`, `GET /admin/api-key`, `GET /admin/enterprise-settings/scim/token` | Admin Pages mutable configuration/identity-integration metadata, not real service controls. |
| `GET /search-settings/get-current-search-settings`, `GET /search-settings/get-secondary-search-settings`, `GET /admin/embedding/embedding-provider`, `GET /search-settings/unstructured-api-key-set` | Admin Pages mutable search/configuration objects. |
| `GET /manage/admin/slack-app/bots`, `GET /manage/admin/slack-app/channel`, `GET /manage/admin/discord-bot/config`, `GET /manage/admin/discord-bot/guilds`, `GET /manage/admin/discord-bot/guilds/6501/channels` | Admin Pages bot/guild/channel seeds; only guild6501 channels preseeded by state initializer. |
| `GET /admin/hooks`, `GET /manage/admin/standard-answer/category`, `GET /manage/admin/standard-answer`, `GET /build/admin/apps`, `GET /federated/6501` | Mutable Admin Pages rows; apps reconciled with Craft skills. |
| `GET /admin/token-rate-limits/global`, `GET /admin/token-rate-limits/users` | Admin Pages arrays; group limits have separate owner. |
| `GET /admin/usage-report`, `GET /admin/query-history/list`, `GET /admin/banner`, `GET /manage/admin/doc-boosts` | Mutable report/export/banner/document feedback projections; neutral []/null; documents require opt-in load. |
| `GET /analytics/admin/query`, `GET /analytics/admin/user`, `GET /analytics/admin/onyxbot`, `GET /admin/usage/export`, `GET /admin/usage/system`, `GET /admin/chat-session-history` | Admin Pages fixture-only analytics with date/filter/pagination transforms; no live chat aggregation. |
| `GET /mockshop/admin-pages/documents`, `GET /mockshop/admin-pages/defaults`, `GET /mockshop/admin-pages/billing-case`, `GET /mockshop/admin-pages/billing-snapshots`, `GET /tenants/billing-information` | Specialized admin staging/defaults; selected billing case transform, [Admin](backend-admin.md#license-and-billing). |

Adapter also emits `GET /mockshop/world-screen:{hidden_connectors}` and `GET /mockshop/conversation-catalog:{sessions}`, generated exact pair/detail/sublist/similar-credential routes, agent details and source files. These are not private sample dependencies. Root dynamically emits runtime-only routes (such as `/mockshop/turn/:id`) listed in the other references; absence from neutral YAML is expected.

## Platform identity, settings, tools and permissions

Neutral `/me` is an active verified STANDARD admin: generic viewer UUID/email/name, `is_superuser:true,is_admin:true,role:admin,effective_permissions:[admin,basic],admin_capabilities:[admin]`; craft disabled; group-manager/anonymous/cloud-superuser false. `personalization:{name,role:"",memories:[],use_memories:true,enable_memory_tool:true,user_preferences:""}`. Preferences: `chosen_assistants:null,visible_assistants:[],hidden_assistants:[],pinned_assistants:[0],default_model:null,recent_assistants:[0],auto_scroll:false,shortcut_enabled:false,temperature_override_enabled:false,temperature_default:null,reasoning_effort_default:null,theme_preference:light,language:en,chat_background:null,default_app_mode:CHAT,paste_as_tile:true,voice_auto_send:false,voice_auto_playback:false,voice_playback_speed:1`. These are complete DTO defaults; world viewer projection changes names/IDs, not all role flags.

`GET /settings` keys (seed values are not enforcement):

| Concern | Exact fields |
|---|---|
| Identity/deployment | `company_name,company_description,application_status,tenant_id,tier,version,is_containerized,gpu_enabled,ee_features_enabled,hide_onyx_branding` |
| Chat/model/search presentation | `maximum_chat_retention_days,deep_research_enabled,multi_model_chat_enabled,search_ui_enabled,auto_detect_search_filters,temperature_override_enabled,reasoning_override_enabled,hide_provider_grouping,auto_scroll,disable_default_assistant,query_history_type,hide_query_history_from_admin_panel,llm_gateway_enabled` |
| Auth/Cloud/Craft gates | `anonymous_user_enabled,invite_only_enabled,oauth_provider_enabled,craft_default_enabled,craft_instructions,onyx_craft_enabled,onyx_craft_available,opencode_debugging_enabled,seat_count,used_seats` |
| Files/indexing | `image_extraction_and_analysis_enabled,image_analysis_max_size_mb,user_knowledge_enabled,user_file_max_upload_size_mb,file_token_count_threshold_k,show_extra_connectors,opensearch_indexing_enabled,vector_db_enabled,needs_reindexing,max_allowed_upload_size_mb,default_pruning_freq,default_user_file_max_upload_size_mb,default_file_token_count_threshold_k` |
| Other | `notifications,hooks_enabled,posthog_key,posthog_host` |

Setting a flag only changes native configuration reads; it does not add absent routes or real engines. Base has search/deep research/multi-model/knowledge enabled, community tier, Craft/hooks/OAuth disabled, no PostHog key/host. Enterprise overlay repeats the whole object with `ee_features_enabled:true,tier:enterprise` and neutral company metadata. Avoid silently overwriting enterprise settings with partial DTOs.

Neutral builtin tools duplicated in Assistant's tools and `/tool`: 1 `internal_search`/SearchTool; 2 `web_search`/WebSearchTool; 3 `image_generation`/ImageGenerationTool; 4 `python`/PythonTool. All enabled/chat_selectable/agent_creation_selectable true; search/web default_enabled true, image/python false. Tool flags do not mean real search/image/Python execution is available; normal chat only displays prepared packets. IDs referenced in native agent forms must match actual seeds.

Static `/manage/admin/permissions/registry` identifiers → token arrays:

| Registry ID | Native token |
|---|---|
| manage_llms | manage:llms |
| manage_connectors_and_document_sets | manage:connectors, manage:document_sets |
| manage_actions | manage:actions |
| manage_groups | manage:user_groups |
| manage_service_accounts | manage:service_account_api_keys |
| manage_bots | manage:bots |
| create_agents | add:agents |
| manage_agents | manage:agents |
| view_agent_analytics | read:agent_analytics |
| view_query_history | read:query_history |
| create_user_access_token | create:user_api_keys |

Groups stores selected permission arrays, but no propagation engine updates user effective permissions. Role demonstrations must seed user tokens deliberately. MCP uses role/admin_capabilities instead, and root agent read also recognizes `read:agents` although it is not a separate neutral registry row.

Enterprise-only seed additions: `GET /enterprise-settings` with `application_name,use_custom_logo,use_custom_logotype,logo_display_style,custom_nav_items,custom_lower_disclaimer_content,custom_header_content,two_lines_for_chat_header,custom_popup_header,custom_popup_content,enable_consent_screen,consent_screen_prompt,show_first_visit_notice,custom_greeting_message`; neutral null/false/empty except greeting `How can I help?`. `GET /enterprise-settings/custom-analytics-script:null`. `GET /license` active/enterprise/local manual_upload, seats500,used_seats212,expires_at in180d. These are local display metadata, not a real license/subscription.

The native new-chat greeting is deterministic. Community uses localized `greeting.helpText` (English "How can I help?") without fetching Enterprise settings or spoofing paid flags. Enterprise's truthy authored/saved `custom_greeting_message` wins; empty/null falls back to the same help text. Fresh reset restores the seed. The matching patched frontend build is required for this fallback behavior.

## Frontend patches

Manifest applies all `.patch` files in name order with `patch -p1` after exporting pinned upstream. These are part of the operating contract: without them a native click may not reach the intended route even when backend is correct. No other implicit upstream changes should be assumed.

| File | Exact upstream surface / reason / backend implication |
|---|---|
| `0001-next-config-react-compiler-off.patch` | `next.config.js`: React Compiler only when ENABLE_REACT_COMPILER=1, reducing build memory. No API behavior change. |
| `0002-memory-counter-stable-layout.patch` | `MemoriesModal.tsx`: invisible counter retains space, avoiding pointer-down/up delete-target shift when blur occurs. Memory writes remain full-list `/user/personalization`. |
| `0003-native-table-download-url.patch` | `ExpandableContentWrapper.tsx`: download href changed from relative `api/chat/file/<id>` to absolute `/api/chat/file/<id>`, so nested routes hit byte owner. |
| `0004-auth-local-register.patch` | Account Not Found create-account page: remote REGISTRATION_URL/register replaced `/api/register`; enabled Auth redirects to native signup. No real registration service. |
| `0005-groups-route-boundary.patch` | `proxy.ts`: only `/admin/groups` exact/path-segment matches EE rewrite; prevents `/admin/groups2` rewriting to nonexistent EE path; retains normal enterprise/auth/license gates. |
| `0006-nrf-message-selection.patch` | `NRFPage.tsx`: uses real `useChatSessionController().onMessageSelection` instead of no-op callback, reaching shared root branch selection. |
| `0007-inline-file-selection-snapshot.patch` | `InlineFileManagement.tsx`: snapshots `Array.from(event.target.files)` before clearing input. Otherwise selected FileList can empty before pending state saves; backend upload bytes still discarded. |
| `0008-groups-create-refresh.patch` | `CreateGroupPage.tsx`: awaits native `refreshGroupLists(mutate)` after creating/member/resource/limit saves, before routing to groups. No backend record duplication. |
| `0009-custom-analytics-client-boundary.patch` | EE custom analytics page wraps icon in tiny client Header to avoid server→client function prop boundary; same translations/gate/form retained. |
| `0012-custom-analytics-script-readback.patch` | EE form syncs initial async script unless edited; trims submission; mutates SWR customAnalyticsScript cache after success. Submission remains `PUT /api/admin/enterprise-settings/custom-analytics-script` with `{script,secret_key}`. Mock saves script, ignores secret. |
| `0013-nrf-no-provider-footer-clearance.patch` | NRF configure-provider CTA adds shrink-0/footer-height margin to remain reachable. Native action navigates LLM admin route, no new backend API. |
| `0014-single-model-regeneration-classification.patch` | `multiModel.ts`: >=2 model-tagged siblings only count as parallel models if model names differ; same-model regenerated siblings stay alternatives. Includes upstream unit-test patch; no test execution claimed here. |
| `0015-agent-gallery-curation.patch` | Gallery sorts display_priority before descending-ID tie-break and hides is_listed:false from All while retaining owned entries in Your. Backend root still computes access and priorities. |
| `0016-deterministic-native-greeting.patch` | `WelcomeMessage.tsx`: fallback always uses `greeting.helpText`, replacing random helpText/startText selection; truthy Enterprise custom greeting still wins. |
| `0017-slack-answer-type-readback.patch` | Optional typed `ChannelConfig.response_type` initializes the native channel editor from saved configuration; falls back to `citations` only when absent. No additional backend store. |

`ONYX-ENTERPRISE-LICENSE.txt` governs EE patch excerpts (0009 and0012), not Mockshop's MIT grant. Pinned enterprise source remains subject to its upstream terms; documentation of local fake license metadata grants no production rights. Generated runtime/upstream assets are not a new product or permission bypass.

## Error staging index

| Desired state | Supported mechanism | What it does not do |
|---|---|---|
| Unknown API | Core strict501/miss log | Does not mean expected native validation error |
| Fixture HTTP failure | `__status/__body/__headers` on a **fixture-owned** route | Cannot override a dynamic route that already sends |
| Chat prepared mismatch | Exact arm wrong question/session →409 | Does not consume valid arm on mismatch or choose another fallback |
| Sharing/feedback rollback | `/mockshop/sharing-feedback/outcome` one-shot operation flag →400 | Does not change share/vote before failing |
| Search failed-result card | user-search seed error regex →200 with error | Does not pretend a network failure or suppress strict console errors |
| Extension send retry | `/mockshop/browser-extension/outcome` →one StreamingError NDJSON packet200 | Does not create a partial session/node before matching failure |
| Craft empty/error/loading/rate-limit | `/mockshop/user-craft/stage` pattern/state/delay | Does not run actual quotas or delete underlying records |
| Auth email/SSO/mode variants | `/mockshop/auth-anonymous/stage` and content | Does not send email or authenticate remotely |
| Callback/consent validation/retry | explicit conditional cases/requests/status/delay flags | Does not create OAuth grants or update independent credential stores |
| File reject/process/fail/preview404/delete warning | known file catalog reject/final_status/preview_error/delays/associations | Does not derive outcome from uploaded bytes |
| Billing checkout failure | Empty stripe_checkout_url after recorded local POST | Does not contact Stripe or create payment/session |
| Admin form validation | Exact local validation paths described in admin tables | Many Test buttons are unconditional simulated receipts, not real validation |

Intentional failures need matching script assertions/expected-error policy. Avoid blanket error suppression. Backend view/receipt state can be asserted through native reads after the button, but source-derived documentation is not a record of an exercised browser acceptance test.

## Known boundaries and evidence gaps

- Every current handler module and every base/edition fixture family is indexed. This is **mock implementation coverage**, not exhaustive coverage of every upstream API or every possible UI path.
- All routes here were read from source; no builds, tests, formatting, browser smokes or network calls were performed to verify behavior for this documentation work. Native UI gating/hydration/error presentation still requires integrated verification after implementation changes.
- Image source-provider choice, Slack Agent/Document Sets, Group resources, Agent Knowledge/tools/sharing and Project featured flags use explicit sole-owner live projections. Other fixture-only snapshots still do not inherit arbitrary live changes; see each owner contract.
- Root chat persistence is stronger than most feature caches on world revisit; read the reset matrix before demonstrating cross-world continuity. Cookies/localStorage/cache are browser-owned and separate.
- Some neutral skeletons are intentionally inert (blank Craft defaults, status0 conditional cases, empty built-in provider choices, zero context-token budgets). Enabled gates plus empty skeletons are not a prepared walkthrough.
- Admin logos and empty log-export ZIPs use raw binary responses rather than generic JSON serialization. Correct source ownership is not browser/download acceptance: inspect actual response/download bytes, decoding and the visible consumer when verifying these paths.
- Authorization is partial UI simulation; root agents and MCP enforce specific checks, but many admin/Extras/Craft writes only validate row existence/content. No production security assurance should be inferred.
- Dates, counts, prices, metrics, generated titles, search rankings, scheduled runs, tools and responses are prepared/finite unless the table explicitly describes computation. A control's successful local readback is not execution against a real service.
