# Onyx mock backend operating map

This is the implementation contract for **our mock backend**, not an upstream API compatibility claim. It is intended to remain useful without any private demo scripts. Every route below is relative to the mock root; the native frontend normally requests the same path with `/api` prepended. Statements are **source-derived**, not a claim that a browser interaction or test was exercised while writing these docs.

## Read by task

| Need | Reference |
|---|---|
| Understand request dispatch, fixture precedence, worlds, screen selection, reset/keep, edition and locale | [Runtime and world contract](docs/backend-runtime.md) |
| Send, regenerate, edit, stop, reopen, search, share or vote on a chat; render citations; stage browser-extension context | [Chat, search and streaming](docs/backend-chat.md) |
| Configure agents, pins, user settings, memories, tokens, files or projects | [User data and controls](docs/backend-user.md) |
| Operate connectors, credentials, LLM providers, document sets, users, groups, MCP, admin settings and integrations | [Admin controls](docs/backend-admin.md) |
| Author Craft skills, apps, tasks, session streams, approvals and output files | [Craft contract](docs/backend-craft.md) |
| Stage login/signup/email/anonymous/SSO/callback/consent/password flows | [Authentication and conditional flows](docs/backend-auth.md) |
| Find remaining fixture-only routes, neutral defaults, known no-ops and required frontend patches | [Fixture and patch inventory](docs/backend-fixtures.md) |

For shared content authoring and script → scene → step/profile structure, use the [world specification](../../docs/worlds-spec.md). The backend pages explain what buttons' requests actually do to state. Frontend locators and click sequences belong in the plugin's frontend/script operating documentation, not in a second backend implementation.

## Complete implementation-owner index

All `handlers*.mjs` modules are accounted for here. Root composition order matters: the first matching handler that sends a response wins; returning `false` permits later handlers/fixtures. A dynamic response does **not** automatically receive fixture transforms.

| Source | Owned operation/state | Detailed contract |
|---|---|---|
| [handlers.mjs](handlers.mjs) | Composition; chat trees; prepared turns; org/screen state; agents/pins; user settings; source viewer | [Runtime](docs/backend-runtime.md), [chat](docs/backend-chat.md), [user](docs/backend-user.md) |
| [chat.mjs](chat.mjs) | Answer selection/context, citation rendering, NDJSON packets, saved-tree serialization | [Chat](docs/backend-chat.md) |
| [adapter.mjs](adapter.mjs) → [adapter/](adapter/), [world.schema.json](world.schema.json) | Shared world → Onyx DTOs, generated routes/history/source bodies/replies; `send` and `state` (including `world` and `viewer` switches) compilation. `adapter.mjs` re-exports `compile`; `adapter/materialize.mjs` runs one module per entity (people, settings, teams, connectors, documents, llm, plugins, craft, billing, tier, project, replies, agents, conversations, bodies) in a fixed order over a shared context; `connectors` derives `cc_pairs`/`index_runs` through `adapter/index-runs.mjs`. plugins/craft/billing/tier and the connectors section are declared in the schema but fail loudly until their area implements `derive()`. | [Runtime](docs/backend-runtime.md) |
| [handler-registry.mjs](handler-registry.mjs) | Auto-loads every `handlers-*.mjs` not hand-composed by `handlers.mjs` (`export default create(core) → {routes, transform, reset}`, optional `export const order`); negative order runs before the core composition. New modules need no edit to shared wiring. Name them `handlers-<area>-<topic>.mjs`. | [Runtime](docs/backend-runtime.md) |
| [handlers-index-monitoring.mjs](handlers-index-monitoring.mjs) | Read-only query handling for the v5.0.0-beta.2 runs feeds, index attempts and status-page connector list; per-request throughput and overview from the authored runs | [Admin authoring: indexing states](docs/script-admin.md#authored-indexing-states-v500-beta2-status-page-and-connector-page) |
| [handlers-save-controls.mjs](handlers-save-controls.mjs) | Org-keyed LLM catalog, connectors, credentials, pair metadata, metadata-only uploads, guarded indexing requests/errors and pending deletion | [Admin: providers/connectors](docs/backend-admin.md#providers-connectors-and-credentials) |
| [handlers-document-sets.mjs](handlers-document-sets.mjs) | Document-set form records | [Admin: document sets](docs/backend-admin.md#document-sets) |
| [handlers-admin-users.mjs](handlers-admin-users.mjs) | Accepted/invited/pending users; shared group membership identities | [Admin: users and groups](docs/backend-admin.md#users-and-groups) |
| [handlers-admin-groups.mjs](handlers-admin-groups.mjs) | Group membership/resources/permissions/token limits | [Admin: users and groups](docs/backend-admin.md#users-and-groups) |
| [handlers-mcp.mjs](handlers-mcp.mjs) | MCP server/tool metadata, local authentication receipts | [Admin: MCP](docs/backend-admin.md#mcp) |
| [handlers-admin-pages.mjs](handlers-admin-pages.mjs) | Remaining admin forms, sole federated collection, apps, billing snapshots, reports, configuration, notifications | [Admin: remaining pages](docs/backend-admin.md#remaining-admin-pages) |
| [handlers-user-files.mjs](handlers-user-files.mjs) | Known-file catalog records, metadata-only uploads, attachment references, fixture byte serving | [User: files](docs/backend-user.md#files) |
| [handlers-user-projects.mjs](handlers-user-projects.mjs) | Projects and chat/file associations | [User: projects](docs/backend-user.md#projects) |
| [handlers-user-search.mjs](handlers-user-search.mjs) | Fixture document filtering/classification and chat response selection; no search-session store | [Chat: search](docs/backend-chat.md#search) |
| [handlers-user-extras.mjs](handlers-user-extras.mjs) | Agent sharing/ownership decorations, labels, notifications, avatar responses; delegates actual agents to root | [User: extras](docs/backend-user.md#extras) |
| [handlers-sharing-feedback.mjs](handlers-sharing-feedback.mjs) | Sharing status/feedback/fail-next flags over root chat nodes | [Chat: sharing and feedback](docs/backend-chat.md#sharing-and-feedback) |
| [handlers-browser-extension.mjs](handlers-browser-extension.mjs) | Fictional tab context, fail-next stream error, root message-selection callback | [Chat: browser extension](docs/backend-chat.md#browser-extension) |
| [handlers-auth-anonymous.mjs](handlers-auth-anonymous.mjs) | Sole fictional auth identity/cookie/mailbox state | [Auth](docs/backend-auth.md) |
| [handlers-user-conditional.mjs](handlers-user-conditional.mjs) | Callback/consent receipts; delegates identity to Auth | [Auth: conditional](docs/backend-auth.md#conditional-flows) |
| [handlers-user-craft.mjs](handlers-user-craft.mjs) | Skills, user app credentials, tasks, sessions, finite SSE turns, output metadata/library | [Craft](docs/backend-craft.md) |
| [fixtures/base/*.yaml](fixtures/base/) (`NN-<area>.yaml`: core, settings, conn, plug, craft, llm; merged in file-name order), [enterprise overlay](fixtures/edition-enterprise/00-edition.yaml) | Neutral platform DTOs and native edition defaults; not fictional organizations | [Fixtures](docs/backend-fixtures.md) |
| [plugin.yaml](plugin.yaml), [patches](patches/) | Frontend pinned to Onyx v5.0.0-beta.2 (b80667827), build/runtime/edition/locale gates and narrow UI patches | [Runtime](docs/backend-runtime.md), [patches](docs/backend-fixtures.md#frontend-patches) |

## Reading conventions and boundaries

- Tables list exact methods and paths; `:id` is one path segment and `*` a wildcard suffix. Braced choices in prose/tables enumerate literal route alternatives, not a new routing syntax.
- Unless a row says otherwise, writes read JSON via `ctx.body()` and return HTTP 200; `null`, `{}`, a row and a list are different response bodies. Query fields are marked `?field`; multipart fields are explicitly named.
- `core.fixture()` returns a seed DTO **without** running plugin transforms. Therefore a table that says “fixture-only join” deliberately does not promise to see another module's live edits.
- Composed readers explicitly join sole live owners where supported: provider/image choices, connector and Group resources, Agent Knowledge/tools/sharing, Project featured flags and Slack Agent/Document Set readback. These joins preserve IDs; they do not implement service execution or permission propagation.
- No state is durable. Preserving some state with `keep:true` is not a database and does not preserve every module on a world switch. See the reset matrix.
- No real LLM, search index, connector ingestion, MCP execution, sandbox, scheduler, identity provider, email, DNS, billing or public sharing service is implemented. Local pages/receipts are not live integrations.
- Do not use real secrets or private files. Most secret/upload controls discard or replace inputs, but generic metadata fields are not a comprehensive sanitizer; the admin logo handler intentionally retains selected image bytes in memory.
- Unknown routes are **not** supported operations merely because non-strict mode returns an empty success. Strict mode emits a 501 and records the miss. Explicit error-stage controls and their limitations are documented by owner.

## Coverage and evidence

The references cover every current handler module, all base and enterprise fixture route families, adapter materialization, both streaming protocols and every checked-in frontend patch. They distinguish mutations, fixture-only reads, no-op receipts, fall-through and intentionally staged errors. They do not assert production authorization or complete upstream endpoint parity. Source-derived limitations and unexercised/ambiguous behavior are called out inline; no tests, builds or browser checks were run for this documentation change.
