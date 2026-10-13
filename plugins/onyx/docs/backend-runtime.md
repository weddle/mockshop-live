# Backend runtime, worlds and reset

[API map](../API-MAP.md) · [Chat](backend-chat.md) · [User](backend-user.md) · [Admin](backend-admin.md) · [Craft](backend-craft.md) · [Auth](backend-auth.md) · [Fixtures](backend-fixtures.md)

Source-derived from `adapter.mjs`, `world.schema.json`, `handlers.mjs`, `plugin.yaml`, and `core/{server,fixtures,locale,stream}.mjs`. No runtime proof is implied.

## Request dispatch and response ownership

1. Native Next requests `/api/...`; SSR uses `INTERNAL_URL=http://127.0.0.1:<mock port>`. `OVERRIDE_API_PRODUCTION=true` enables the native proxy. Default web/mock ports are 3300/8800.
2. Core removes trailing slashes and `/api` before matching. Query strings are not part of fixture route keys. `ctx.query` is an object of string values (repeated keys collapse; root `/persona` explicitly reparses repeated `persona_ids`). JSON bodies are parsed once; other bodies become `{_raw:text}` unless a handler directly consumes multipart bytes.
3. `/__mockshop/*` control routes run first. Plugin handlers run in declaration order, **not** specificity order. A handler that sends and does not return `false` ends dispatch. `false` falls through.
4. Only after handlers decline does `FixtureTable.find()` choose a fixture: highest overlay first; within a directory more literal patterns precede parameter/wildcard patterns. `ANY` matches any method. Routes replace whole response values; fixture layering is not deep merge. The compiler's `readRoutes()` merges duplicate exact keys in sorted file order (later assignment wins); do not rely on ambiguous same-layer duplicate keys in hand-authored fixture directories.
5. For a fixture response, all matching transforms run in order; then locale projection; then `{__status,__body,__headers}` is interpreted. Otherwise status is 200. Strings are text/plain unless a header overrides; other values use JSON serialization. Dynamic handlers bypass this transform pipeline and must explicitly compose other owners.
6. Missing strict route: 501 `{detail:"Unmocked endpoint: METHOD /path?query"}`, appended to `strict_misses` and `logs/onyx/mock-misses.log`. Non-strict missing route: 200 `{}` for writes, and `[]` for GET endings matching `s$|list|history|all$|statuses$`, otherwise `{}`. This is an unsupported fallback, **not** a working control.
7. An uncaught handler error before headers produces 500 `{detail:"mockshop handler error: ..."}`. Once a stream has sent headers, this mechanism cannot turn it into an ordinary JSON error response.

`core.fixture(method,path)` reads/localizes/substitutes the raw fixture only. It does not read another handler's live state. `{{param:id}}` substitution occurs on matched fixture values. `{{now}}`, `{{ago:2h}}`, `{{in:3d}}` are resolved during YAML parsing against the demo anchor; `core.demoNow()` advances that anchor by real elapsed time.

### Root handler precedence

`authAnonymous → userConditional → exact admin banner dismiss → extras → adminPages → craft → userFiles → projects → sharing → root agent routes → mcp → documentSets → saveControls → groups → users → userSearch → browserExtension → root preference/chat routes`.

Transforms are composed root-first, then `mcp → documentSets → extras → saveControls → userFiles → users → groups → adminPages → craft`. Root specially owns final `/me`: extras identity decorations, saved preferences/personalization, explicit Craft flag, pins, group admin capability, then fictional auth identity. A 401 envelope is preserved.

Important collisions:

| Route | Actual winner/composition |
|---|---|
| `GET /chat/file/:id` | Known uploaded synthetic file first; root source-markdown viewer if it declines. Craft calls `serveFile()` directly for fixture bytes. |
| `GET /manage/connector` | Admin Pages' route composed with Save Controls' `connectorList()` (projected status connectors plus unbound saved connectors), ahead of Save Controls' own route. |
| `POST /admin/search` | First Admin Pages implementation searches its opt-in document store; the later empty-result route is unreachable after it sends. |
| `PATCH /admin/tool/status` | Admin Pages accepts all-OpenAPI IDs; otherwise MCP accepts configured MCP IDs; unsupported/mixed built-in batches fall through. |
| `PUT/DELETE /admin/token-rate-limits/rate-limit/:id` | Admin Pages handles global/user-owned IDs; Groups handles group-owned IDs after `false`. |
| `POST /manage/admin/user-group/:id/add-users`, `PATCH /manage/admin/user-group/:id` | Groups owns combined/member writes. Composed Users explicitly declines its standalone implementations. |
| `GET /notifications`, `GET /notifications/summary` | Extras dynamic reads wrapped by Admin Pages banner transform. Bulk dismiss updates both owners. Exact `/notifications/65065/dismiss` precedes generic Extras ID route. |
| `GET /enterprise-settings/logo` | Uploaded Admin logo bytes/type first; otherwise enabled Extras branding PNG, else Admin Pages'404. Reset clears the upload. |
| Provider reads | Save Controls' dynamic admin/public/persona responses explicitly receive Admin Pages model-default overrides. |

## Shared content → native seeds

Author shared data in a world and specialized native DTOs under `apps.onyx.fixtures`; never edit generated `fixtures/.built/<hash>/` output. Base fixtures are deliberately neutral platform defaults. The compiler materializes a complete `00-world.yaml`, `chat/*.yaml`, `history/*.yaml` and `sources/*.md`. Only edition-named overlays (`edition-*`) are accepted as authored compatibility layers; fictional organizations are world data.

| Shared/app input | Adapter projection and invariants |
|---|---|
| `company.name/description/domain` | `/settings.company_name/company_description`; enterprise application name if a real enterprise DTO exists; derived reserved-domain email/URLs. `apps.onyx.settings` wins over generated settings. |
| `people.<key>`, `apps.onyx.viewer`, `apps.onyx.people.<key>.id` | Viewer defaults to first person. `/me` ID/email/personalization; `/users`, accepted-users and `/manage/users` generated unless explicitly overridden. UUIDs derive from `onyx:people:<key>`, not names/order; duplicate IDs fail. Generated accepted users are STANDARD, active, password-configured; viewer's row is admin. This does not rewrite every `/me` permission field: use an explicit `/me` DTO for member/admin differences. |
| `teams.<key>.members`, `apps.onyx.teams.<key>.{id,managers}` | `/manage/admin/user-group`, minimal groups, and `/mockshop/admin-groups/seeds.groups`; members/managers resolve person keys. Existing same-ID resource seed fields are retained. |
| `sources.<key>`, `apps.onyx.sources.<key>` | Distinct stable pair `id`, `connector_id`, `credential_id`; pair detail, grouped indexing, credentials/similar-credentials, connector status and detail sublists. Numeric IDs are deterministic hash-derived values unless explicit, with kind-local collision checks. |
| `documents.<key>.{source,title,body,owners,author,url}` plus native document mapping | ID defaults `DOC-<hash>`; safe filename required. Generates source markdown and document DTO with title, vendor source, link, blurb, owners' emails. Auto-populates user-search documents unless that seed is explicitly overridden. |
| `apps.onyx.agents.<key>` | Inherits builtin `/persona/0`, then native fields; resolves owner person key and source keys; emits detail/catalog/admin/pins unless those lists explicitly supplied. Builtin is prepended if no agent maps to ID 0. `sources` becomes distinct vendor `knowledge_sources`. |
| `conversations.<key>.{title,messages}` and `apps.onyx.conversations.<key>` | Stable UUID unless explicit; default persona 0 or mapped `agent`; sidebar metadata and generated history. Only user/assistant roles; assistant must follow a user without an existing answer. Explicit native `turns` replaces generated turns. `/mockshop/conversation-catalog` remains complete even if initial sidebar fixture is empty. |
| `apps.onyx.replies.<key>` | Compiles `{text,cites:[document keys],queries?,...}` to `answer,documents,citations`. Citation `[n]` must index `cites`. Safe filename required. Other fields: `title,reasoning,chunk_delay_ms,match,after,default,follow_up_default,regenerate,model_variants,web_search,turn,question`. Exact `turn/question` files support a native submission without convenience retyping/completion waits and never enter manual regex selection. |
| `apps.onyx.models.<alias>.name` | Alias only; does not create a model. Selection must find a visible name in `GET /admin/llm/provider.providers[].model_configurations`. |
| `apps.onyx.history.<id>`, `apps.onyx.source_bodies.<id>` | Explicit native history/source text for specialized cases; safe IDs required. Source text must be string. |
| `apps.onyx.fixtures` | Ordinary exact `METHOD /path` DTOs, not a route-patch language or override of dynamic handlers. Shared source/document/person/agent identity fields in embedded snapshots are reprojected to avoid stale names/vendors. |

Supported source vendors: `confluence, notion, google_drive, github, slack, jira, zendesk, file, web, salesforce, zoom, sharepoint, gmail`. An unused unsupported vendor may remain shared background data; mapped/selected unsupported sources and cited unsupported documents fail. `url_vendor`, `config_vendor`, `config_by_vendor`, `credential_by_vendor` make explicit vendor-specific bindings. Absolute URLs must be HTTP(S); recognizable Notion/Slack/GitHub/Google Docs/wiki/Jira mismatches fail. Connector locator URLs `/admin/connector/<vendor>/<id>` and explicit incompatible vendor-label text in steps are rejected during compilation.

Default derived connector configuration by vendor: Confluence `{wiki_base,space:"KNOWLEDGE",is_cloud:true}`; Notion `{root_page_id}`; Drive `{shared_drive_urls,include_shared_drives:true}`; GitHub `{repo_owner,repositories}`; Slack `{workspace,channels}`; Jira `{jira_base_url,project_key}`; SharePoint `{site_url}`; others `{}`. Explicit `config` or matching `config_by_vendor` takes precedence. Default connector `input_type:"poll",refresh_freq:1800,prune_freq:86400,access_type:"public"`; native connector/detail/row/credential overrides customize other fields without changing canonical IDs/vendor/name.

**Template boundary:** the world resolver is strict and one-pass. To preserve runtime placeholders declare, for example, `vars.onyx_template_open: "{{"`, then author `"{{vars.onyx_template_open}}ago:2h}}"`. The same technique applies to `now`, `param`, `first/prev` and extension `tab` placeholders. Raw runtime placeholders inside shared content are not valid shared references; neutral fixture YAML is not passed through the world resolver.

## Screen selection and exact sends

| Author operation | Compiled/backend action | Persistence/effect |
|---|---|---|
| `state.sidebar: [conversation keys]` | Ordered session-ID mask in `state.screens[org].sidebar` | Selects from complete generated catalog. Empty list intentionally hides sidebar entries; does not delete chats or block direct detail replay. New live chats are hidden while an explicit mask omits them. |
| `state.connectors: [source keys]` | Ordered pair-ID mask | Filters grouped indexing rows and recomputes summaries. Initial `visible:false` hides source-only connectors without making the default catalog a permanent allow-list; explicit selection is an allow-list. |
| `state.agent: key` or `null` | Agent ID or builtin 0; refresh adds `agentId` query | Readback persona and current selected session updated; does not rewrite historical answer content. |
| `state.model: alias/name` or `null` | `Provider display name__provider__model[__mc:<id>]`, or null | Changes screen/default readback and selected session picker; old assistant nodes retain their frozen model attribution. Hidden/unknown models fail compile. |
| `send: {text,reply,wait?}` | Write exact-turn chat file; arm `{keep:true,resetChats:false,turn:<author step>}`; focus/type/send native controls; poll `/mockshop/turn/:id` until backend complete **and newest message wrapper is rendered complete**; then optional explicit `send.wait` | Exact arm is one-shot, org/session/question-bound. `turn` scripts never match manual regex fallback. A stopped exact answer fails compiled completion wait. |
| Native submission preceded by `state:{turn:<key>,keep:true,resetChats:false}` | Arm declared `apps.onyx.replies.<key>.turn`; retain the following native click/Enter and explicit waits | Same org/session/question guard and sole `withContext()` model/context projection; can retain stream/Stop stages without a mandatory completion wait. |
| `state.world: <relative path>` | Precompile whole target snapshot and switch overlays; defaults `keep:true,resetChats:false` | Not a partial world edit. Persists until another switch; screen controls must be a separate step. Identical return-to-primary content reuses original namespace. Author references still resolve against immutable primary content. |

Screen updates compile to backend state plus same-URL browser reload, unload marker wait and body wait. They default to `keep:true,resetChats:false`, but honor explicit `keep:false` or `resetChats:true` (which clears conversations as described below). Keyed screen selections cannot be combined with raw `overlays`, `turn` or `screen` controls in the same state object. Reload does not promise that every frontend component is hydrated merely because `<body>` exists. Selection does not revert at scene boundaries.

## Control plane and reset matrix

`GET /__mockshop/health → {ok:true,plugin:"onyx"}`. `GET/POST /__mockshop/state → {plugin,locale,overlays,demo_anchor,strict,strict_misses}`. POST accepts `overlays,keep,resetChats,anchor,locale,strict` plus plugin fields `screen,turn,session,url,admin_documents_fixture,admin_oauth_claims_fixture`. Explicit `strict` resets miss history. With keep, locale/anchor/overlays stay unchanged unless provided; fresh returns to the declared edition + requested overlays and resets locale/anchor. Root's `org` key is the joined authored overlays array, not a person/team ID; implicit edition prefixes are normalized on state roundtrips rather than becoming an authored namespace.

| Store/owner | Same-world `keep:true,resetChats:false` | World/overlay change with keep | `keep:false` / fresh run |
|---|---|---|---|
| Root `chatSessions`, `edits`, `deletedAll`, counters, `armedTurn`, `turns` | Retained; explicit new arm replaces prior | Chats/edits remain keyed `org:session`; old arm cleared. Statuses remain org-keyed. | All cleared; next session 1/message 1001. `resetChats:true` also clears these globally even with keep. |
| Root `agentOrgs[org]` (`personas,deleted,pins,nextId`) | Retained | Old org records retained and new org lazily seeded | All orgs cleared |
| Root `userSettings[org:fixture-user-id]` (`preferences,personalization,pats,connectors,grants,prompts,counters`) | Retained | Old user/org edits retained | Cleared |
| Root `screens[org]` | Merged, not replaced, by `screen` fields | Per-org selection retained | All screens cleared |
| Save Controls `state.saveControls[org]`, including `seededPairs,indexingErrors,targetedJobs,nextTargetedJob` | Retained | Catalog/connectors/credentials/uploads/errors/submit-only requests and sequence retained for revisit | All orgs cleared; IDs allocate above seed maxima; targeted sequence returns to1 |
| Sharing `state.sharingFeedback` (org-keyed shares/feedback plus global fail-next operations) | Retained | Retained if chat-reset policy is false | Cleared; root nodes' feedback cleared. Any `resetChats` value other than false clears it. |
| MCP edits/created servers/tools; document-set records | Retained | **Reseeded**, even with keep | Cleared |
| Files records/session refs; Projects maps/memberships/file links | Retained | **Reseeded** | Cleared |
| Groups records/permission/limit edits + `adminGroupMembers`; Users accepted/invited/pending | Retained | **Reseeded** | Cleared |
| Extras dismissals/labels/avatar counter; extension context/failNext | Retained | **Reseeded** | Cleared |
| Auth `run`; Conditional receipts | Retained | **Reseeded** | Cleared |
| Admin Pages `data`, documents-loaded/OAuth-claims selector flags, `adminCraftEnabled`; Craft `data` | Retained | **Reseeded** | Cleared. Documents need `admin_documents_fixture:"loaded"`; `admin_oauth_claims_fixture:"empty"` selects an opt-in found-but-empty snapshot, not a login. |
| User Search | No mutable store; reads active seed each call | New fixtures immediately | No reset function |

The root passes a forced `keep:false` to non-org seed caches on namespace change. This prevents foreign-world row leakage but means revisiting a world restores its chat/provider/agent/preferences state while projects/files/groups/Craft/admin form edits restart from that world's seeds. Do not describe this as “keep everything.” A no-keep reset clears chats even if `resetChats:false` was supplied; the root condition is `!keep || resetChats === true`.

Backend state is process-wide, not concurrent-browser isolated. Use separate server instances/ports for simultaneous runs. Core fixture watching reloads YAML but does not clear already seeded live records. `/__mockshop/state` does not itself clear browser localStorage, sessionStorage, SWR caches, cookie jars or navigation. Auth and language endpoints explicitly change their cookies; script/runner browser setup owns browser lifecycle. Backend reset and page refresh are separate operations.

## UI-family seed dependencies

Supply complete native DTOs for specialized families; empty neutral arrays are intentionally not a demonstration dataset.

| UI family | Minimum related seeds/readers to keep coherent |
|---|---|
| Main app/home | `/me`, `/settings`, `/auth/type`, provider catalog, `/persona` + each `/persona/:id`, `/tool`, sidebar sessions; profile locale/cookies. |
| Agent editor/gallery | Above + `/manage/document-set`, known user files, `/users`, group/minimal groups, `/persona/labels`; `/mockshop/user-extras{,-options}` for ownership/branding/empty states; each catalog ID needs detail. Optional `/mockshop/user-knowledge-hierarchy` supplies finite folder/document choices. Shares/transfers use live accepted Users and Groups; shared team IDs must be coherent because teams supersede raw group fixtures. |
| Admin providers/model picker | **Admin** provider catalog is mutable authority; public catalog supplies display descriptors. Built-in options/available-model fixtures stage selectable models; keep IDs/default provider/model references coherent. |
| Connectors/detail | Shared sources generate indexing rows, pair detail, connector + credential; supplementary attempts/errors/permission-sync/group-sync DTOs; `/mockshop/save-controls.pair` for create. |
| Groups/users | Accepted-users identity list + admin groups + group seeds + connector status + document sets + admin agents; invite/pending lists and mock-feedback metadata separately. |
| Files/projects | `/mockshop/user-files.catalog,seed_ids` + `/user/projects` links + recent/session file fixtures where needed; filename, user-file ID and backing file ID are distinct. |
| Search/citations | `/mockshop/user-search-seed` document/tag/filter data; source bodies/history/reply documents for local viewers; search settings only gate UI, not indexing. |
| Auth/conditional | Auth staging enabled + complete content/auth profiles; conditional staging enabled + callback/consent cases; settings/build flags expose native pages. |
| Craft | `/mockshop/user-craft`, Admin Pages `/build/admin/apps`, native app options, MCP catalog, live providers and known binary file catalog; `/me.craft_enabled`, `/settings.onyx_craft_enabled/onyx_craft_available` for visibility. |
| Remaining admin | Exact GET collection/object consumed by each form + `/mockshop/admin-pages/defaults`; specialized document/billing seed selectors are opt-in. See admin tables. |

## Edition, locale and outbound gates

Pinned upstream commit: `f858083d6cbe37c4146834d379e39511260a9879`. Runtime edition descriptor takes precedence over requested manifest edition. Community builds set paid EE/cloud false; Enterprise sets paid EE true/cloud false and layers `edition-enterprise`; Enterprise Cloud sets both true, same fixture overlay, plus `CUSTOM_ANALYTICS_SECRET_KEY=mockshop-admin-pages-demo`. All three enable the native Forgot Password build flag. A fixture flag cannot manufacture code gated out by the built edition.

Manifest native EE aliases: `/admin/groups`, `/admin/performance/{usage,analytics,query-history,custom-analytics}`, `/admin/theme`, `/admin/standard-answer`, `/admin/export-logs`, `/agents/stats` → `/ee` + the same path. Metadata installs no route; native middleware/layout/license checks remain authoritative. `/admin/groups2` is protected from accidental prefix rewriting by patch 0005. Enterprise fixtures replace the complete settings object, add enterprise branding defaults and an active local license; Community `/enterprise-settings` and `/license` are explicit 404 fixtures.

Locales: `en, es, pt, fr, de, ja, zh, ko, ar`; default `en`; cookie `NEXT_LOCALE`; projected `/me.preferences.language`. `resolveLocale()` accepts supported regional fallbacks and rejects unsupported languages. `PATCH /user/language` stores the preference, sets backend `state.locale`, and sends `NEXT_LOCALE=<value>; Path=/; SameSite=Lax; HttpOnly`; subsequent locale resolution validates it. Locale changes native translated UI, not authored fictional text automatically.

Runner defaults: 1440×900, America/New_York, anchor `2026-10-09T10:00:00-04:00`, synthetic `fastapiusersauth=mockshop`. This is a frontend cookie-presence bypass, not real auth. Only declared external hosts are allowed by default: Google Fonts hosts and Google favicon path. Source citations point at local viewers unless `external:true`; explicitly external links may therefore be blocked. No fixture should contain live credentials or depend on a remote service.
