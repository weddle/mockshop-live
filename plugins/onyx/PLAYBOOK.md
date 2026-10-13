# Onyx script authoring playbook

This is the operating manual for authoring a new demo against the pinned, native Onyx frontend and Mockshop's local backend. It does **not** require access to the historical sample scripts or their fictional worlds. A visible button is not evidence that the corresponding production service exists: the guides below identify its request, the mock state it changes, the screen that consumes that state, and its reset boundary.

## Start with the outcome, then the data

1. Define the visible outcome and the edition needed to expose its native controls.
2. Put reusable company, people, teams, sources, documents and conversations in a **world**. Use stable keys and references, not repeated fictional names.
3. Put the demonstration's ordered **scenes** and **steps**, local `content`, and exact `send.reply` beside the question in a **script**. Select a **profile** for presentation. Do not put cursor settings in a world.
4. Read the appropriate feature guide below. Supply its prerequisite records through shared entities and, where necessary, `apps.onyx.fixtures` native seed DTOs. The [backend reference](API-MAP.md) specifies those DTOs and the actual handler owner.
5. Drive the native control; wait for a feature-specific completion condition; assert the resulting consumer. For persistence, navigate away and reopen. For reset, first make the state demonstrably dirty.
6. When assigned verification, validate the script, run it on the matching built edition, inspect every relevant image/report, and separately inspect actual clip playback. Source-derived expectations and old sample comments are not verification of the current artifact.

The complete syntax is in the [script specification](../../docs/script-spec.md); composition is in the [world specification](../../docs/worlds-spec.md). Read [authoring mechanics](docs/script-authoring.md) before adding direct evaluation or state controls.

## Feature guides

| Intended screen or outcome | Operating guide |
|---|---|
| Native locators, modal scope, waits, reset/keep, edition/locale, uploads, direct evaluation, error evidence | [Authoring mechanics](docs/script-authoring.md) |
| Exact replies, manual chat, model choice versus regeneration, edit/branch/stop, citations, Recents, search, sharing and feedback | [Chat and retrieval](docs/script-chat.md) |
| User file picker, real input/drop/paste events, previews/downloads, saved attachments, project files/chat membership/deletion | [Files and projects](docs/script-files-projects.md) |
| Gallery/editor/pins/sharing/ownership, admin curation, onboarding/branding/notifications, personal settings/tokens/connectors/usage | [Agents and settings](docs/script-agents-settings.md) |
| Local login/signup/verification, conditional callbacks/consent/password/impersonation, Community guards, native extension routes | [Auth and extension surfaces](docs/script-auth-extension.md) |
| Craft library, finite turns, approvals/subagents, output files/webapps, apps, skills, scheduled tasks and staged failures | [Craft](docs/script-craft.md) |
| Providers, model policies, connectors/indexing, document sets, MCP, users/groups, security, bots, analytics/billing and remaining admin forms | [Administration](docs/script-admin.md) |
| What knowledge was retained from every historical script, including underscore files; unique contracts versus repeated demonstrations and regression assertions | [Coverage ledger](docs/script-coverage.md) and [machine-readable index](docs/script-coverage.json) |

Each feature guide uses this contract: **screen + scoped locator → operation/API → changed mock state → visible result → persistence/reset → limitations**. API paths in those guides include the browser's `/api` prefix. Backend route tables generally omit that prefix.

## Rules that prevent misleading demos

- Use a real matching build. `requires` can skip an incompatible script; a fixture cannot enable compiled-out Cloud, Enterprise, Forgot Password or analytics code.
- Prefer test IDs and scoped role/label locators. A model name appears both in the composer and on completed answers. Scope composer choices to `[data-testid="model-selector"]`; regeneration starts from `AgentMessage/regenerate`.
- Wait for the **result**, not just an element that appears early. `onyx-ai-message` may exist while streaming; a file thumbnail may exist before processing/decoding; a download click does not prove bytes were downloaded.
- Distinguish modal drafts, browser-local settings, and server-owned state. `Escape` normally discards a modal draft, but some editors retain browser drafts. Backend reset does not clear localStorage, sessionStorage, cookies or stale component caches.
- `state.world` is a persistent whole-background switch, not a temporary rewrite of individual people. Some stores survive by world namespace; others reseed on a namespace change even with keep. Use the [actual reset matrix](docs/backend-runtime.md#control-plane-and-reset-matrix).
- Direct readback supplements a visible native write; it is not a substitute for clicking Save, confirming deletion, inspecting a pending state or reopening the screen.
- Check the saved consumer, not only its picker: Advanced Agent fields, current Group/resource names, new federated IDs and Slack Answer Type must survive native reopen/reload. `keep:true` and a fresh reset test different boundaries; neither implies durable storage.
- Deliberate error demonstrations require a narrow known-error allowance **and** positive native error UI, protected state and recovery. Never allowlist failed steps or every HTTP/console error.
- Use fictional credentials and reserved domains. Provider tests, auth, permissions, MCP, Craft, indexing, scheduling, billing and model responses are local simulations, not connections to real services.
- A route inventory, generated screenshot name or assertion in source says what a script intends to cover. It is not a claim that this checkout was run or accepted.

## Content and presentation

Keep question, answer, citation metadata, source body and saved history consistent. Exact replies are authored output; a follow-up does not demonstrate arbitrary model understanding. English fixture text remains English when the native interface changes locale.

Use the existing [cursor engine](../../docs/cursor.md), explicit pauses and meaningful end states. Avoid hovering a citation while opening Sources: layout reflow can move the tooltip over the answer. Route the pointer through empty margin when needed. Stills cannot establish temporal cursor motion or video readability.

Native file inputs, clipboard APIs and new-tab behavior have browser/OS boundaries. Do not replace those boundaries with a fake success image. See the relevant guide for what the scripts actually stage and what still requires browser evidence.

For finite Agent Knowledge browsing, author `/mockshop/user-knowledge-hierarchy` and document DTOs in the world; do not assume an indexer will discover folders. For a native chat submission that must retain its typed-question or Stop stage, arm a declared exact `turn/question` reply with `state:{turn:<key>,keep:true,resetChats:false}` immediately before the native click/Enter. The convenience `send` instead types and waits for completion. See [runtime contracts](docs/backend-runtime.md#screen-selection-and-exact-sends).

## Scope and evidence

The guides were extracted from all 227 YAML definitions in the historical `plugins/onyx/scenarios/` corpus, including `_probe.yaml` and `_admin-agent-curation-original.yaml`, plus `vocabulary.yaml`, the existing authoring references and the current handlers. Historical names in the coverage ledger are provenance, not public runtime dependencies or instructions to copy a sample.

The extraction performed no builds, tests, browser runs or visual acceptance. Contradictory historical acceptance notes, missing old proof-map files, compiled-artifact conditions and partial backend behavior are explicitly treated as source ambiguity, not inherited certification. [Coverage methodology](docs/script-coverage.md#how-to-use-this-ledger) describes the distinction.
