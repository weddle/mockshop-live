# Plugin vocabulary and operating knowledge

A plugin must be understandable without a collection of sample scripts. Its documentation should answer: **what does this control do, which API does it call, how does the mock respond, and what state changes?**

| File | Responsibility |
|---|---|
| `plugins/<p>/vocabulary.yaml` | Structured inventory of screens, entities, operations, useful visible outcomes, limitations and optional step snippets. |
| `plugins/<p>/PLAYBOOK.md` | Author-facing entry point: how to build a fresh script using the supported controls and operating guides. |
| `plugins/<p>/API-MAP.md` | Mock backend entry point: request dispatch, routes, seed data, state ownership, persistence/reset and simulation boundaries. |
| `plugins/<p>/docs/*.md` | Detailed operating contracts linked from the entry points and vocabulary. |

The source implementation is authoritative. Distinguish source-derived behavior from exercised verification. A `works` inventory entry describes intended supported behavior; it is not evidence of a current successful browser run.

## Operating documentation requirements

For each UI family, explain:

1. **Screen:** frontend route, edition/permission prerequisites and required seed data.
2. **Control:** visible label and locator context; distinguish controls with identical labels.
3. **Request:** method, API path, important request fields and request order.
4. **Implementation:** owning handler, fixture routes and mutable state stores.
5. **Result:** response/stream structure and the resulting visible UI state.
6. **Lifecycle:** persistence across navigation, chat changes, world switches and resets.
7. **Timing:** actual completion signals, refresh requirements and asynchronous states.
8. **Boundaries:** simulated external effects, unsupported writes, canned outputs and success-shaped no-ops.
9. **Failure:** supported error staging and how to diagnose missing or inconsistent data.

Do not present a native button as fully implemented merely because it renders. Do not explain a mocked connector in terms of real indexing or a prepared answer in terms of real retrieval.

Sample scripts are examples, not the specification. When samples move to a separate repository, their unique operating knowledge must remain here as documentation, implementation, and focused regression tests.

## Vocabulary schema

Machine-readable format: [`schema/vocabulary.schema.json`](../schema/vocabulary.schema.json). Root fields:

| Field | Meaning |
|---|---|
| `plugin` | Plugin directory name. |
| `version` | Vocabulary format version, currently `1`. |
| `summary` | What the local integration supports; state major limitations. |
| `locales`, `default_locale` | UI locales supported by the plugin. |
| `surfaces` | Screen/area IDs, frontend routes, descriptions and support status. |
| `entities` | Data concepts the screens expose, with optional examples and surface references. |
| `actions` | Operations: prerequisites, instructions, outcome, persistence and operating-guide links. |
| `moments` | Useful visible outcomes, with operating-guide links. |
| `not_supported` | Explicit limitations and reasons. |
| `snippets` | Optional copyable low-level step sequences; not an inheritance or template system. |

IDs are kebab-case and unique within each list. Cross-references name IDs, not titles.

```yaml
plugin: example
version: 1
summary: Fixture-backed records and local edits; no external synchronization.
locales: [en]
default_locale: en

surfaces:
  - id: records
    title: Records
    routes: [/records]
    status: partial
    description: Lists local seeded records and supports in-run edits.
    notes: Refresh after replacing seed data.

entities:
  - id: record
    title: Record
    description: A reusable document mapped into the application's record shape.
    surfaces: [records]

actions:
  - id: edit-record
    title: Edit a record
    surface: records
    entities: [record]
    preconditions: [A record exists and the viewer can edit it.]
    steps: Open the record, choose Edit, change its title and save.
    outcome: The list and detail title both update.
    persists: true
    status: partial
    guide: docs/records.md#editing

moments:
  - id: saved-record
    title: Saved record
    surface: records
    shows: Updated title in both the list and detail panel.
    guide: docs/records.md#editing

not_supported:
  - what: Publishing edits to an external service
    why: Writes update only the local mock's in-run state.
    surface: records

snippets:
  - id: open-records
    title: Open records
    action: edit-record
    steps:
      - goto: /records
      - wait: {role: heading, name: Records}
```

This example describes a hypothetical plugin, not additional implemented Onyx routes.

### Screens and routes

`surfaces[].routes` are **frontend navigation routes**, not API endpoints. Use the backend operating guide for API request contracts. Query strings and fragments are allowed in navigation paths.

Screen status is one of `works`, `partial`, `placeholder`, or `needs-capture`. Use `notes` to explain incomplete behavior. Optional `edition` names a manifest edition; optional `group` describes a navigation category.

### Actions and persistence

Actions require `id`, `title`, `surface`, and `outcome`. Optional fields include `entities`, `preconditions`, `steps`, `persists`, `status`, `guide`, and `script`.

`persists: true` means the change survives ordinary navigation within the supported mock lifecycle. It does not imply durable storage or persistence across a reset/restart. The operating guide must specify the actual scope.

Action status is `works`, `partial`, or `not-supported`. Preconditions must state required content, permissions, edition and UI state—not merely say “run sample X.”

### Guide links and optional examples

`guide` is a plugin-relative Markdown file with an optional heading anchor, such as `docs/chat.md#model-selection`. Keep these links within the plugin. Heading anchors and explicit `<a id="...">` anchors are checked by validation.

`script` optionally names a small example kept in `plugins/<p>/scripts/<name>.yaml`. A moment may also name a `shot` in that script. These references are optional: a feature must not require a bundled example to be documented or supported. Archived sample names belong in historical coverage provenance, not active vocabulary dependencies.

### Snippets

Snippet `steps` use the ordinary [script step vocabulary](script-spec.md). They need not begin with navigation, but their prerequisites must be understandable from the associated action. Prefer locators that identify controls by role, label or stable application attributes. Keep fictional names and story choices in world references or the author's own script rather than baking them into reusable instructions.

## Validation

```bash
./mockshop validate onyx
./mockshop validate plugins/onyx/vocabulary.yaml
```

Validation checks:
- Schema fields/types and unique IDs.
- Surface/entity/action references.
- Local guide files and heading anchors.
- Optional bundled script/shot references.
- Locale and edition declarations against the manifest.
- Supported frontend routes against the built route table, when available. Without a built table, unmatched routes receive warnings rather than claims of support.
- Snippet step shapes against the script schema.
- Presence of `PLAYBOOK.md` beside the vocabulary.

Validation cannot prove a locator works, a response shape matches the pinned frontend, or a save has the documented effect. Exercise the actual screen and inspect its state/report.

## Workflow for agents

1. Read the plugin's `PLAYBOOK.md`, vocabulary and relevant operating-guide sections.
2. Select a reusable world or define the required content explicitly.
3. Write a new script using documented routes, controls and state contracts. Existing samples are optional references.
4. Validate it, exercise it against the real frontend and inspect the visible result.
5. Record and inspect the clip with the selected presentation profile.
6. If implementation behavior changes, update the operating contract and focused regression coverage. Adding another story does not require extending the plugin vocabulary.
