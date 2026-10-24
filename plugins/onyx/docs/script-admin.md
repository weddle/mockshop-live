# Admin authoring and operating knowledge

Admin scripts must stage an eligible viewer, a physically compatible frontend edition, and coherent native seed DTOs. A button appearing is not authorization proof: most local admin handlers do not enforce the product's complete server permission model. All services and secrets here are fictional. [Backend admin](backend-admin.md) specifies every request body, state owner, validation, readback and no-op boundary; [backend fixtures](backend-fixtures.md) distinguishes read-only receipts from implemented writes. This guide explains how the native controls use them.

## Routes, aliases and locator context

The sidebar and direct routes include `/admin/language-models`, `/admin/agents`, connector catalog/indexing/detail pages, `/admin/documents/sets`, users/groups, MCP/OpenAPI actions, search/index settings, security/SSO, analytics, billing and Craft configuration. Legacy `/ee/admin/...` and newer `/admin/...` aliases coexist for some screens; group aliases include `/admin/groups` and `/admin/groups2`. Use the canonical native navigation for a fresh script and the route-alias table in [backend runtime](backend-runtime.md) for supported older entries. A route smoke visit covers reachability, not the Save/Delete behavior of every control on that page.

Scope menus/dialogs to their entity. **Edit**, **Save**, **Update**, **Connect**, **Delete**, **Search** and model names repeat across rows and portals. Find the row by a world-authored name, open its own menu, then target the active `[role="dialog"]`. Native toggles often attach their click handler to a Formik label rather than a hidden checkbox. Sliders need real keyboard/pointer input; writing their DOM value does not commit React form state. Blank/invalid inputs should remain native validation cases, not direct backend substitutions.

## Provider setup and existing-provider edits

At `/admin/language-models`, **Add** chooses a provider-specific native form. The corpus opens fourteen provider families; OpenAI/Anthropic require their fictional key/model fields, compatible providers need their native base/name/key combination, Azure parses **Target URI** and supports a deployment plus **Add Model**, Vertex and Bedrock have dedicated credential branches. The form's visible required fields and native defaults differ: do not implement all providers with a generic modal recipe. Some existing-provider names are disabled by design.

An existing card's `aria-label="Edit <provider-name>"` opens edit mode. **Test** calls `POST /api/admin/llm/test`, which checks finite required fields and returns a simulated receipt; it does not contact a model. **Update**/save calls `PUT /api/admin/llm/provider` with the existing ID, retaining its model identities/configuration. Saving without that ID creates a different provider. Credentials are replaced with fake/redacted markers. Cancel leaves the full catalog/default/access configuration unchanged.

The native **Set default** operation posts `/api/admin/llm/default`; selection must refer to a saved catalog member. Naming, vision and Craft defaults use separate endpoints. Public chat/Agent catalogs project the same inventory, so check renamed/hidden/default models there after Save. Native **Delete** uses the numeric-ID catalog route and confirmation; default deletion is disabled with multiple providers, and deleting the last requires the force warning. This deletes fictional local configuration, not an account.

Available-model refresh reads the documented builtin/options or provider available-model endpoint. These return prepared arrays, not remote discovery. Opening a populated list or a successful Test is not proof that a real key works. Use [model branches](script-chat.md#composer-models-answer-models-and-branches) to demonstrate the saved catalog's actual native consumer.

## Conditional provider forms

**Portkey:** chat-completions/responses/messages modes have their native default base URL behavior. Switching mode rewrites a recognized default but preserves a custom `.invalid` URL; **Restore default** restores the selected mode's default. Key/base requirements remain native. This pin does not expose the imagined gateway-config/virtual-key controls that earlier notes might suggest. Save/reopen must retain mode/base; switching tabs alone is a draft.

**Bedrock:** Environment/IAM, Access Key and Long-term API Key are different auth modes. Switching clears inactive credential fields. Region selection uses a native toggle-style option: clicking an already selected region can clear it, unlike a defaultOption picker. The form's Update validation requires region, not every credential field; available-model refetch is hidden until the active credential prerequisites are complete. Reopened saved credentials are fake markers, not the originally entered secret. No AWS request occurs.

**Vertex:** the auth-method selector requires the staged `hooks_enabled` capability. Service Account uses a real single-file input/FileReader: supply JSON contents, not merely a filename. Workload Identity requires project/location. Switching modes clears inactive fields. A saved Service Account does not repopulate the browser file input filename, even though its fake credential marker persists. Native selector visibility and credential state must be asserted separately.

## Model visibility, naming and capability settings

Model rows have visibility checkboxes/keyboard Space and bulk select/deselect. Zero visible choices disables Update because the form derives its test/default candidate from a visible model. Portkey hides Auto Update. Saving visibility changes public pickers; cancel must leave them untouched. Public access/group/agent selection is metadata, not a real provider authorization system.

The model row's rename affordance (legacy right-side button index 0/title editor) edits `custom_display_name`. Trimmed Enter/blur commits the draft; Escape cancels; empty clears it so display falls back to the native display/name. It only reaches the public picker after the enclosing provider Update. Keep the raw model ID unchanged; label equality is not identity.

The adjacent settings affordance (legacy right-side index 1) opens a dialog/popover with capability controls. Reasoning Low/Medium/High map to the finite effort range; lowering maximum clamps default, keyboard Home/End selects the allowed ends, and an unset maximum uses the highest supported value. The seeded default may be bounded at Medium. A reasoning model fixes/disables temperature at 1; ordinary chat temperature ranges 0–2 in 0.1 steps and a null slider can park at zero without meaning an explicitly saved zero. Context-window display is read-only; unknown shows an em dash/tooltip. Popover changes remain provider-form drafts until Update; canceling the enclosing form discards them.

### Saved defaults, manual models and Auto Update

A model row's **Set as Default** immediately writes `/api/admin/llm/default`, rather than a provider-form draft. Reopen the dialog and inspect the Default Model badge and actual public picker. Canceling an unrelated reopened form does not undo that submitted default. Keep retains it; dirty → fresh restores the original seed.

Azure's **Enter model name** trims input; whitespace/duplicate names disable **Add Model**. Enter and the button are distinct commit paths. Added models remain drafts until provider **Update**, then appear with stable allocated IDs in admin/public catalogs. **More Models**/Cancel must not leak drafts. This manual form has no Auto Update.

OpenAI's Auto Update changes draft `is_auto_mode` and finite prepared discovery/model inventory. Inspect native disabled choice/bulk controls, visibility and custom names before Update, then read the actual picker. Toggle/Cancel preserves saved state. No remote model discovery occurs.

Community model access uses native **All Users & Agents** / **Named Groups & Agents**, Agent chips and Save/Cancel. A Community Group card can show zero members without fetching Enterprise group management. Author coherent catalog/group IDs and test dirty keep/fresh; do not import paid overlays to populate Community controls. Access remains local metadata, not a production ACL.


## Admin agent curation

`/admin/agents` supports search, Created By/Actions filters, Name sort and a table footer. The source unit uses four nonbuiltin rows on one page. This pin has no table label-column filter or native row Start Chat/detail link; those actions belong to the user gallery/viewer. `data-testid="edit-agent-<id>"` opens the ordinary `/app/agents/edit/<id>?admin=true` editor; New Agent uses the same form and role-gated extra controls.

Create with sharing is ordered: stage the share dialog's draft, create the persona, then persist its sharing on the returned ID. Featured/listed flags are not a second persona DTO. Feature/Unfeature confirmation and `PATCH /api/admin/persona/<id>/featured` update the featured section; Cancel preserves it. List/Unlist uses `/listed`: unlisting hides All Agents discovery but preserves owned Your Agents, pins and direct access where the native UI permits. It is not a server access revocation.

Dragging native reorder handles writes `PATCH /api/admin/agents/display-priorities` as an ID→integer priority map. The admin list and gallery featured order should agree. A JS DOM reorder proves nothing. The curation reset script dirties title, ordering, visibility, feature flags and pins, then asserts seed restoration; the underscore original is historical duplicate provenance, not an additional independent acceptance result.

## Connector creation, credentials and binding

The catalog's **Add <source>** opens its native source form. A Confluence example requires wiki/configuration fields, name and a selected existing account/credential; **Create Connector** stays disabled without the required account. The backend sequence is connector creation (`POST /api/manage/admin/connector`), credential selection/creation, then `PUT /api/manage/connector/<connector-id>/credential/<credential-id>`. The **connector ID**, **credential ID** and **connector-credential pair ID** differ. The detail/indexing row uses the pair ID; creating only a connector does not create that row.

An existing pair's name editor saves `PUT /api/manage/admin/cc-pair/<pair-id>/name?new_name=...`. **Update Credentials** can contain an inner **Edit credential** dialog (`PUT /api/manage/admin/credential/<id>`); saving the inner form does not close the outer modal, so use its Close before the next page action. The visible username/configuration updates; secret-looking fields become mock markers.

Frequency **Update** controls write `/property` with refresh/pruning names and **seconds**. The UI presents refresh minutes and pruning hours; refresh must be at least one minute/integer minutes and prune at least 0.083 hours. Zero/invalid input is a native disabled/error branch. Save/reopen confirms both units and values, not only text entry.

Google Drive **New Account** → **Connect** navigates to a local read-only fake-account landing returned by `/api/connector/oauth/authorize/<source>`. Only its explicit **Stage local fake account** POST creates the credential and redirects. A GET/prefetch must not mutate; there is no real Google consent or token exchange.

Admin Pages owns `GET /api/manage/connector` ahead of Save Controls, but explicitly reads its sole live `connectorList()`. Group and Document Set selectors/validation use the same live pair projection. Binding is still required: a connector without a pair is not an indexed resource. Preserve coherent connector, credential and pair IDs, and check the actual selected-resource consumer after rename/save.

## File and website connectors

Native file connector upload uses the actual multipart input and `/api/manage/admin/connector/file/upload`; it keeps filenames/IDs, not document bytes or embeddings. The resulting connector must still be bound before appearing as a pair. Existing file connector **Edit** → **Add Files** stages a new-file badge; **Save Changes** → **Confirm & Save** posts `/files/update` and can invoke local run-once. Patch0007 preserves the native FileList before input reset; a build without it cannot be repaired by a direct state write. Existing-file removal checkboxes and confirm update metadata arrays.

Run-once accepts native `{connector_id,credentialIds:[...],from_beginning:boolean}` for seeded and created pairs. Seeded requests remain `not_started`; new upload pairs use `in_progress`. Explicit `seededPairs` membership, not ID size, decides this. No worker completes indexing; document counts/attempt history/errors remain unchanged.

Website/Sites form requires a base URL or uploaded archive path according to mode, and name validation. Its archive input is multiple files, not a promise to crawl/unpack any arbitrary ZIP. Native created-row labeling can prefer the base URL over the display name. These operations retain configuration/metadata only; they never crawl the network.

## Indexing details and permission sync

The indexing table groups sources and supports search/expand-all. Native pair details show finite indexing attempts, timestamps, statuses, errors and configuration. **Advanced** separates **Indexing**, **Document Permission Sync**, and **Group Membership Sync** tabs. Their applicability is source-specific: Salesforce's inline ACL model can show both sync tabs not applicable; Drive has both applicable with empty staged history; Slack has document but not group sync; Zoom has neither; Confluence has both; a Jira failure can expose **View Details**/**View Full Trace**.

Those histories are seed data, not a sync engine. Scope errors/trace to the intended attempt. **Run Update**/**Re-index** stages the guarded run-once request; confirmation Cancel queues nothing. **Resolve All** uses targeted `error_ids` only when the pair already supports it; otherwise it uses full reindex. Paginated unresolved errors and targeted readback remain uncompleted (`not_started`), with no job-list/worker/completion panel. Author capability/error DTOs coherently, rather than turning an unsupported source into a targeted one.

**Pause**/**Resume** changes pair status. **Delete** schedules only PAUSED/INVALID pairs as DELETING/PENDING and retains documents; pending deletion cannot be resumed by a status write. Keep/reload and dirty → fresh are separate checks. See [exact route guards](backend-admin.md#connector-setup-credentials-and-inline-files); local pending state is not production deletion.

### Authored indexing states (v5.0.0-beta.2 status page and connector page)

`apps.onyx.cc_pairs.<source>` and `apps.onyx.index_runs.<source>` (newest first) give a pair its state and runs; [index-runs.mjs](../adapter/index-runs.mjs) applies the pinned backend's rules and [handlers-index-monitoring.mjs](../handlers-index-monitoring.mjs) applies each feed's query (status groups, kinds, since/until, errors, superseded, resolved, paging; the connector list's status filter, name search and status/source/name order) and computes the throughput charts and the overview from the runs at request time. Times are durations before the demo clock.

```yaml
apps:
  onyx:
    cc_pairs:
      wiki: {status: INITIAL_INDEXING, created: 50m}   # first full index: "Initial Indexing" row and pair tag, total documents only, no chart
      chat: {docs_indexed: 6420}                       # ACTIVE by default
      drive: {docs_indexed: 2310}
    index_runs:
      wiki:
        - {status: in_progress, created: 45m, started: 40m, updated: 1m, new_docs: 1840, batches: 46,
           stages: {CONNECTOR_FETCH: 9.0, DOC_DB_PREPARE: 0.6, CHUNKING: 2.4, EMBEDDING: 18.0, VECTOR_DB_WRITE: 3.2}}
      chat:
        - {status: success, started: 50m, finished: 38m, new_docs: 64, total_docs: 210, batches: 6,
           stages: {CONNECTOR_FETCH: {avg: 95, min: 60, max: 140, sd: 24}, CHUNKING: 1.1, EMBEDDING: 7.5}}
      drive:
        - {status: not_started, created: 5m}           # queued: "Scheduled", "1st in queue"
        - {status: success, started: 6h20m, finished: 6h12m, new_docs: 12, total_docs: 35, from_beginning: false}
```

- Row bucket (`_connector_status`): PAUSED → paused; DELETING/INVALID → failed; a running latest attempt → indexing (tagged **Initial Indexing** while the pair is INITIAL_INDEXING); repeated errors without a running attempt → failed; no attempt, or a queued/canceled/interrupted latest → scheduled (queue place counts every pair's queued attempts by age); failed → failed; else indexed.
- The pair's documents default to the running first attempt's new documents, else the world's documents of the source; its overall speed is documents per minute since `created` (default 120d), as `CCPairFullInfo` computes it.
- Stage timings are seconds per batch (`event_count` = `batches`; attempt-level stages count once). Unset `min`/`max`/`sd` default to 0.6×, 1.8× and 0.25× the average. `BATCH_TOTAL` is the sum of the docprocessing stages and `BATCH_UNACCOUNTED` is zero. The compile fails when the fetch stages or the docprocessing stages add up to more than the run's span, so authored timings stay consistent with the run. A run without `stages` shows the popover's empty state; an unknown attempt id answers 404 as the backend does.
- A source with neither section keeps the neutral summary (indexed an hour ago, no runs). Nothing here starts, cancels or resolves a run.
- A connector created in the UI (a pair that is not one of the seeds) is listed as a **Scheduled** row with no run, `queue_position: null` and 0 documents, and counts toward the overview's active connectors; nothing indexes it.

## Document sets

List/new/detail routes consume `GET /api/manage/document-set`; editable selectors can use `get_editable`. The native public/private toggle is a label-driven control, not necessarily the hidden checkbox. Name and at least one connector/federated source are required. Private group and connector search create selection chips. Save uses `POST /api/manage/admin/document-set` for creation and PATCH with the existing ID for edits; Cancel discards the draft.

Delete is immediate in this native table, not an invented confirmation. It removes the live set row used by Agent/Group readers. Missing IDs show native missing-detail behavior. Public clears selected groups, without permissions propagation or cascade deletion. Connector selectors/validation read current live pairs; federated selection reads the sole live collection. Saved Agent Knowledge and Group resource names refresh by selected set ID.

## Users, invitations, roles and Craft access

The users table reads accepted, invited and pending collections separately. Native search, account-status/group filters, sort and paging can be client views over those finite arrays. Counts are not interchangeable: accepted account-type/active counts do not include pending/invited. Stage sufficient varied rows before asserting filters.

**Invite Users** parses email tags, rejects invalid/incomplete input and allows Cancel with no mutation. `PUT /api/manage/admin/users` adds only absent addresses to invited; case-insensitive/native duplicate handling and submitted toast counts are distinct from creating accepted accounts. Remove/revoke invitation patches `/remove-invited-user`. Genuine Cloud **Pending** → Approve requires compiled `NEXT_PUBLIC_CLOUD_ENABLED` and posts `/api/tenants/users/invite/approve`; it moves pending→invited, not pending→accepted, and sends no email.

A row's role action patches `/users/admin-access`; activate/deactivate use their named PATCH endpoints; Delete confirmation DELETEs `/delete-user`. These mutate accepted rows/memberships but do not replace `/me` permission tokens or cascade real ownership. **Reset Password** posts `/api/password/reset_password` and reveals/copies a fictional generated string; no real password is changed. CSV download contains current accepted rows; it is not a production export service.

Per-user Craft access is managed on `/admin/craft/access`, not an imagined user-row menu. `PATCH /api/manage/admin/users/craft-enabled` stores explicit true/false/null flags by email; null follows workspace default. Workspace enable/default uses `/api/admin/settings`; **Enable all** has a native confirmation. Cross-check accepted-users and matching viewer readback. No real account entitlements are provisioned.

## Groups, memberships, resources and limits

Groups list/create/detail aliases use the same group store. The native Name field and Add members search/checkbox/Done/Save Changes flow can issue sequential creation/membership/resource writes. A combined PATCH must preserve selected connector IDs when removing members; a member-only update must not erase connectors. Manager toggles use `/manager`, permissions use `/permissions`, incognito uses `/incognito`, and agent/document-set selection has separate association endpoints.

Selected users join live accepted Users; deletion removes memberships. Group connector, Document Set and Agent resources use their sole live owners, including new/renamed records, and rehydrate saved selection by stable IDs. Group Agent association is still distinct from persona `group_shares` and grants no automatic share. Permissions/incognito remain display metadata, not a complete authorization/retention engine.

Delete requires confirmation; missing detail and an empty list after deleting all seeded groups are separate native states. Group token-limit CRUD shares its owner with group detail/Usage views. Workspace/user limits have their own controls: name/scope, token/cost budget and period fields write finite limit rows. Enable/edit/delete/readback are supported metadata, but no requests are actually throttled and no timer resets spending. Craft's staged usage-limit banner is an independent response, not this budget engine.

## MCP and OpenAPI actions

MCP admin requires both native admin role and capability metadata. **View tools** shows prepared tools; individual and bulk enable/disable PATCH `/api/admin/tool/status` with tool IDs. **Refresh** reads `/api/admin/mcp/server/<id>/tools/snapshots?source=mcp`, marks local refresh/status metadata and exposes prepared tools; it does not discover a remote server.

**Manage** edits name/description/server URL/public/users/groups through the singular `/admin/mcp/server/<id>` route. Disconnect/status uses its status endpoint, while Delete confirms then removes the server/tools from projected catalogs. Add creates server metadata, then configures None/API Key/OAuth, shared versus per-user credentials, transport and auth fields. OAuth Auto Discovery/Known Provider has endpoint/scopes/extra-JSON fields; saving can enter Awaiting Auth, and local `/api/admin/mcp/oauth/connect` returns a finite native redirect. Every secret is fake; no tool or IdP is contacted. Craft availability is a separate flag and connection predicate.

OpenAPI **Add definition** accepts JSON with paths/operations, then **Add Action** reviews parsed methods. `/api/admin/tool/custom/validate` extracts finite method metadata; it is not a complete OpenAPI validator or an API call. Native OAuth configuration fields and **Connect** save local config/tool records; custom headers are scrubbed. The tool appears in native selectable catalogs but has no execution backend. Do not send real credentials or claim the displayed operation ran.

Agent Save resolves this composed MCP/OpenAPI catalog, including locally created actions. Saved Agent action readback refreshes current names/descriptions by stable ID; native Rename requires `permissions.edit` on custom actions. Check the gallery/viewer after save/rename, not only the picker. This does not add tool execution or another OAuth store.

## Chat preferences and gateway

Admin Chat Preferences exposes team name/auto-scroll and default assistant configuration. Team-name blur and switches PATCH `/api/admin/settings`; **Modify Prompt** opens a modal saving `/api/admin/default-assistant`. These settings change native consumers and saved metadata, not live model behavior. Cancel protects the prior assistant prompt.

The admin LLM Gateway switch PATCHes workspace settings. User gateway tab/scope eligibility remains a separate native gate; see [tokens and gateway](script-agents-settings.md#access-tokens-and-gateway). Enabling the flag does not deploy a provider proxy or authenticate real inference.

## Craft administration

`/admin/craft/access` controls workspace/user access; `/admin/craft/apps` controls the shared app catalog; its MCP tab edits availability and per-tool policies. Read/write categories, bulk policy and individual override choices must be scoped to the intended server/action; save persists metadata consumed by user Craft, not external permission grants. `/admin/craft/preferences` saves the native system instruction/preference fields through workspace settings. Reopen and enter Craft to demonstrate the consumer.

Builtin/custom app required fields, association, retained skills after delete, stale-session Reload and user credential connection are documented in [Craft admin apps](script-craft.md#admin-apps-association-and-policies). Do not maintain a second simulated app catalog for admin versus user screens.

## Search, voice, image, tracing and code execution configuration

Web Search cards distinguish **search providers** from **content providers**. Edit/Test/Connect save fake metadata under their respective `/api/admin/web-search/...` collections. Activation clears peers only within that category. Firecrawl content configuration and **Onyx Web Crawler** reset-default are not the same operation as a search-provider default. Test is a simulated success, not internet retrieval.

Voice config distinguishes speech-to-text (for example Whisper) from text-to-speech (TTS-1/HD). Activating one default changes only that mode; native model choices and disconnect confirmation update provider metadata. No audio capture/transcription/synthesis occurs, and the separate static voice-status fixture is not automatically recomputed from every edit.

Image-generation provider controls (`aria-label` prefixed `image-gen-provider-...`) save config, select/unset a default and delete its config/credential row. They do not generate an image; credentials readback requires an actually saved configuration. Tracing's native Braintrust configuration saves project/key/enabled metadata and simulated Test; some edition builds hide it. It never starts a trace collector. Code Interpreter **Reconnect**/enable writes `/api/admin/code-interpreter`; health remains a separate fixture and no interpreter starts.

## Index settings and document processing

Embedding provider **Connect** validates/saves fictional configuration, including custom model name/dimension. **Apply & Re-index** stages the request as the secondary search settings (the current model card stays), shows the native re-index progress banner with every connector waiting, and **Cancel** clears it; with the instant switchover the current settings change at once and the banner has no Cancel. There is no real indexing worker, so the counts never advance. The page only renders a model card when the seeded `apps.onyx.fixtures` provide `GET /search-settings/get-current-search-settings` (also `get-secondary-search-settings`, `reindex-progress`, `GET /admin/embedding/embedding-provider`, `GET /admin/code-interpreter` and `/health`), and the config section is disabled while a re-index runs, so start the world with `get-secondary-search-settings: null`. Vector quantization (including the native seven-bit choice), Contextual Retrieval toggle/model picker, Extract/Caption Images controls/model/size and inference/rerank fields are native forms with draft/Revert behavior. Provider groups in model pickers must be expanded before selection. Do not claim embeddings, OCR or captions were computed from those saves.

Document Processing's API-key Save/Delete stores only the configured boolean through the unstructured-key endpoints. No real key is retained or service invoked. Native status/progress/cost panels can be independent fixtures rather than live projections of a saved model.

## Security, service accounts, SSO and SCIM

Security switches and fields save `PUT /api/admin/security` only for keys present in the native seed. Password uppercase/length rules and lower-page JWT JWKS URL/audience/issuer commit through their native form/Enter/blur path. Saved metadata does not change actual authentication, SSRF/network policy, JWT validation or password storage.

Service Accounts **New** posts `/api/admin/api-key` with name/groups and reveals a one-time fake key. Name/group edits and confirmed Delete use the local account record plus sole Groups memberships; Group rename/member edits read back there too. Omitted groups clears them. Regenerate changes the fake display marker. SCIM **Generate**/**Regenerate** replaces one fake metadata record; native Copy/Download needs the matching Enterprise build and explicit Enterprise settings, and should be checked against actual clipboard/download bytes. Metadata reads do not expose the raw token; there is no directory synchronization or IdP validation.

SSO **Add** exposes Google, OIDC and SAML forms. A saved slug/name can become disabled while display name remains editable. OIDC needs client ID/secret/discovery URL; Verified Email/PKCE/scopes (Enter to commit chips) are separate fields. SAML needs IdP entity/URL/certificate and has optional SP entity/certificate/private key/email attributes. Secrets/certs are scrubbed to fake markers. Enable saves a flag, not a real connection. DNS verify endpoints only mark an in-memory flag—no DNS lookup—and domain-list fixture ownership is distinct. General SSO deletion is not implemented.

### OAuth claim snapshots and rerun

`/admin/oauth-test` is diagnostic readback, not authentication. Supply prepared claim/token/profile DTOs through `/api/admin/oauth-test/claims` and optional `/mockshop/admin-pages/oauth-claims-rerun`. **Re-run OAuth login** follows the native `/auth/oidc/authorize?next=/admin/oauth-test&redirect=true` link, replacing only the prepared snapshot and redirecting locally; actor, providers and unrelated Admin records remain unchanged.

A fresh-reset POST with `admin_oauth_claims_fixture:"empty"` selects optional `/mockshop/admin-pages/oauth-claims-empty` and its native **No claims received.** maps. Neutral `found:false` is a distinct **No Snapshot** state. Keep retains the selected local snapshot; fresh without the selector restores the seed. No cookies, sessions or OAuth/IdP requests are created by this diagnostic path.


## Hooks, Slack, Discord and standard answers

Hooks Connect/configure collects name, endpoint and fictional key. Validate adds a finite successful log, not an HTTP request. Deactivate/Disconnect changes status; the trash/delete affordance appears only in the supported disconnected context. Reconnect and confirmed Delete mutate the same local hook/log store. An empty execution log is a valid native view, not evidence the hook ran.

Slack bot create/edit/list saves name/token/config metadata. Enable checkbox and confirmed Delete update the bot; deleting it removes its configured channels. Channel create/edit uses channel name, selected agent/document sets and native response toggles; Update and row Delete persist local channel configuration. There is no Slack connection, message posting or channel discovery.

Saved channels project selected Agents and Document Sets from their sole current owners, preserving IDs as names change. **All Public** stores no persona; **Specific Document Sets** uses the fictional Slack-bot persona marker. Native **Answer Type** restores saved `channel_config.response_type`: Standard is `citations`, Detailed is `quotes`, and absent saved value defaults to Standard. This readback requires patch0017 in the selected artifact. Compare Update → Edit reopen/reload, Cancel, keep and dirty → fresh without overwriting other channel settings.

Discord **Add Server** creates an unregistered/pending guild and displays a fake registration key. Removing it requires confirmation; it never actually joins Discord. Existing guild channel Enable All/Disable All and **Update Configuration** change finite channel flags. The corpus's registered guild is a staged fixture, not proof the registration receipt works externally.

Standard Answers list/new/detail has keyword, answer and category/tag fields; **Create!**/**Update!** save records and row Delete is immediate. Category changes propagate the local category snapshot. These records are not automatically matched by the chat reply resolver. An authored chat answer with the same text is a separate reply, not proof Standard Answers integration.

## Document explorer, feedback and read-only leaves

Document Explorer is empty by default. Explicit fresh-reset control `admin_documents_fixture: "loaded"` opts into its synthetic document corpus; it is not a new keyed `state` field. Search POSTs `/api/admin/search`. Boost Edit/Save and Hidden toggle POST `/api/manage/admin/doc-boosts` and `/doc-hidden` against those rows. Document Feedback's liked/disliked ordering reads that same admin corpus, not ordinary chat votes or User Search. Reload/keep preserve mutations; a fresh reset re-seeds it.

Query History aliases/detail remain fixture history, not chats just sent. System Information displays version metadata. Export Logs creates a ready/no-logs local receipt and automatically downloads the raw empty ZIP; its Download button repeats it and `?export=<32-hex id>` reopens the receipt. Inspect actual filename/bytes when verifying a download. None of these pages accesses production logs or credentials.

### Federated configuration lifecycle

The connector catalog and native setup/detail forms use `GET/POST /api/federated` and numeric `GET/PUT/DELETE /api/federated/<id>` backed by one local collection. Create allocates a non-reused ID; follow the returned/discovered ID rather than assuming the seeded detail ID. Back/Cancel must leave drafts unsaved; Update preserves omitted config/credentials, and secrets are scrubbed. Native Delete uses the real browser confirmation—handle that dialog, not a substituted `window.confirm`.

List/detail and Document Set name/source selection read this same collection, including new IDs. Reopen/reload/keep retains mutations; fresh restores the authored seed. Unknown numeric IDs return404. Personal OAuth status remains separate and unchanged. No provider contact, ingestion or federated search execution is implemented.

## Analytics, reports and custom script

Admin Analytics has populated/empty query/user/Slack charts, date ranges, agent selector/search and native lower-page content. A no-match agent/date range is distinct from a missing route. **Generate Report** selects a period (including All Time), posts `/api/admin/usage-report` and exposes a canned fictional CSV; it is not computed from current users or that interval. Date controls and navigation reset follow their native client state.

Custom Analytics requires the appropriate build/server `CUSTOM_ANALYTICS_SECRET_KEY` prerequisite and existing frontend support; there is no invented client sidebar entry when absent. The native textarea/password form saves `PUT /api/admin/enterprise-settings/custom-analytics-script`; the read is a JSON-encoded string, not raw JavaScript text. Its secret field is ignored by the mock. Saved JavaScript may be consumed by the native frontend, so use harmless fictional text, never real tracking code. Saving and SWR refresh depend on the documented frontend patches; a success receipt is not proof an analytics collector ran.

## Theme, consent and announcements

Theme/enterprise settings expose labeled name/greeting/header/footer/help/disclaimer fields, required-consent settings and announcement configuration. **Apply Changes** PUTs `/api/admin/enterprise-settings`; lower-page text and conditional controls should be asserted in the actual app, not only the form heading. A first-visit required notice blocks the app until its checkbox and **Start**; acknowledgement is browser-local. A published announcement uses the banner store and native popup/notification dismissal. Unpublishing/removing it removes that notification; dismissing it is different from deleting its configuration.

Logo upload uses the real multipart image input and retains selected bytes/type in memory. The raw logo response takes precedence over seeded branding; malformed/non-image upload returns400. Check actual decoding and native preview/sidebar after Apply Changes/reload, not just the success receipt. Remove clears the native use_custom_logo setting, not the retained upload buffer. Fresh restores branding/banner and the seeded logo; browser consent keys must be cleared separately to show first-visit consent again.

## License and Cloud billing

Self-hosted **Update Key/Update License** accepts fictional license bytes and updates display metadata; there is no signature validation or license-server call. Genuine Cloud plan screens require the Cloud build rather than a self-hosted fixture with a Cloud-looking tier.

No-subscription **Get Business Plan** opens annual/monthly and seat-count controls. Native minimum reflects relevant users/invitations; unchanged/invalid choices disable actions. **Adjust Plan**/Cancel navigate/discard a draft. **Continue Payment** records only choice metadata, enters native submitting and deliberately receives an empty checkout URL to show the native invalid-response error. No external Stripe page or successful purchase is simulated; do not replace that failure with a fake checkout success.

An active plan's **View Plan Details** must show the correct tier (Business is not Enterprise). **Update Seats** opens native count/minimum/unchanged controls; Cancel preserves it, Confirm Change updates displayed seat metadata only. **View Users** is navigation. Trial **Upgrade Now** changes local status; canceling/annual warning/expired cases have separate seeded copy/dates. **Manage Plan** posts the local portal handoff and opens a read-only fictional receipt page; provider_contacted is false and subscription state is untouched. No account email/payment data is retained or transmitted by these fake handoffs. Use [backend billing](backend-admin.md#license-and-billing) to distinguish native validation from the mock's intentionally narrower server checks.

## Persistence and evidence boundaries

Successful native admin writes generally survive reload and same-world keep; fresh/world reset reseeds their owner. Read-only panels, browser drafts/consent and independent health/status fixtures have separate lifetimes. Sole-owner resource joins refresh supported saved names/metadata, not execution or universal propagation. Name the write, inspect its actual consumer, and assert reset/cancel separately.

Historical aggregate route sweeps, provider-form screenshots and retired underscore scripts are provenance, not all-screen acceptance. See the [per-script coverage ledger](script-coverage.md) for which unit supplies a unique operation, duplicates another recipe or merely asserts a regression. Never turn an unimplemented route's non-strict `{}` into a claimed working feature.
