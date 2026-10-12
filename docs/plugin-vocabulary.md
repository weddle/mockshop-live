# Plugin vocabulary: documented demo capabilities

Each plugin documents its demoable surface in two files. Together they answer one question for an agent (or a person)
writing scenarios: *what can I show with this plugin, where, and what will I see?*

| File | Audience | Content |
|---|---|---|
| `plugins/<p>/vocabulary.yaml` | machines, agents | the structured vocabulary: surfaces, entities, actions, demo moments, unsupported list, locales, scenario snippets. Schema: `schema/vocabulary.schema.json` |
| `plugins/<p>/PLAYBOOK.md` | people, agents | the same vocabulary as readable prose and tables, plus anything that does not fit the structure (caveats, how fixtures shape what you see) |

Both files are optional per plugin, but if `vocabulary.yaml` exists, `./mockshop validate <p>` checks it (see Validation).
`PLAYBOOK.md` must not contradict `vocabulary.yaml`; when they disagree, the YAML wins and the playbook is fixed.

The included Onyx integration is experimental. Its [vocabulary](../plugins/onyx/vocabulary.yaml) and
[playbook](../plugins/onyx/PLAYBOOK.md) describe the fixture-backed scope, not full upstream feature coverage.
Validation checks structure and references; it does not prove that an interaction succeeds in a browser.

## Tone

This is a **neutral capability vocabulary**, not sales or enablement copy.

- Describe what is on screen and what changes, in plain words: "the connector appears in the list with status Indexing".
- No benefits, value claims, personas or talk tracks ("empowers admins", "saves hours").
- Say what the *mock* does, not what the real product does. If the real product would send an email but the mock only shows
  a toast, write the toast.
- Be honest about gaps. Anything that looks clickable but does nothing, renders partially, or is not captured goes in
  `not_supported` (or carries a `status` other than `works`).

## vocabulary.yaml

The following is an illustrative format fragment, not a complete validated vocabulary or an assertion of current Onyx coverage.
Use the included plugin's vocabulary for actual fixture names, edition requirements and supported actions.

```yaml
plugin: onyx                       # must equal the plugin dir name
version: 1                         # format version (this document); currently 1
summary: >                         # 1-3 neutral sentences: which UI, which parts are mocked
  Onyx web UI (chat and admin) against fixture data.
locales: [en, es, ja]              # optional; must be a subset of plugin.yaml localization.locales
default_locale: en                 # optional; must be in locales

surfaces:                          # screens/areas a scenario can open
  - id: admin-connectors           # unique kebab-case id, referenced by actions/moments
    title: Connectors
    routes: [/admin/connectors]    # paths a `goto` can open directly (no host; ?query and #hash allowed)
    status: works                  # works | partial | placeholder | needs-capture
    description: Catalog of connector types, grouped by category, with search.
    notes: ...                     # optional: caveats (what is partial and why)
    edition: enterprise            # optional: needs this plugin edition (must be in plugin.yaml editions)
    group: Admin                   # optional: nav grouping (e.g. the product's menu category)

entities:                          # the fake things on screen, so agents use names that exist in fixtures
  - id: connector
    title: Connector
    description: A configured data source (name, type, status, last indexed).
    examples: ["Confluence – Engineering", "Google Drive – Sales"]   # example names; real plugins use their fixture values
    surfaces: [admin-connectors, indexing-status]

actions:                           # demoable verbs
  - id: add-connector
    title: Add a connector
    surface: admin-connectors       # where it starts
    entities: [connector]           # optional
    preconditions: [Confluence credential exists in fixtures]   # optional: state/fixtures/edition needed
    steps: Click a connector tile, fill the form, choose a credential.   # optional: how, in UI words
    outcome: The form shows the filled values; Save is enabled.         # required: what becomes visible
    persists: false                 # optional: true if the change survives navigation/deep links in the same run
    status: works                   # works | partial | not-supported (default works)
    scenario: admin-connectors      # optional: an existing scenario that shows it

moments:                           # good demo beats: a single screen state worth a screenshot or a clip beat
  - id: indexing-in-progress
    title: A connector mid-reindex with attempt history
    surface: indexing-status
    shows: Progress bar, attempt table with one failed and one running attempt.
    scenario: admin-connectors      # optional
    shot: connector-index-attempts  # optional: a shot name in that scenario

not_supported:                     # capabilities outside this mock's scope
  - what: Running a live external connector sync
    why: The local fixture backend does not connect to external content services.
    surface: admin-connectors       # optional

snippets:                          # small, copyable step sequences (scenario-spec step vocabulary)
  - id: open-connector-detail
    title: Open a connector's detail page
    action: add-connector           # optional
    steps:                          # validated against schema/scenario.schema.json step definitions
      - goto: /admin/indexing-status
      - click: { text: "Confluence – OPS space" }
      - wait: { text: Connector Configuration }
      - shot: connector-detail
```

### Fields

- `surfaces[].status`
  - `works`: renders fixture data; the listed actions behave as described.
  - `partial`: renders, but parts are missing or known-broken (say which in `notes`).
  - `placeholder`: reachable (direct link works, nav highlights) but the body is an honest "not captured" page.
  - `needs-capture`: not reachable in the mock yet; listed so agents know it exists in the real product's navigation.
- `actions[].persists`: a stateful mock keeps writes for the current run (reset at every run start). `false` means the UI
  reacts (dialog, toast, local state) but a reload or deep link shows the fixture value again.
- `actions[].outcome` and `moments[].shows` describe **visible** results only: texts, rows, badges, toggles.
- `snippets[].steps` use exactly the scenario step vocabulary ([scenario-spec.md](scenario-spec.md)); they are fragments,
  so they need not start with `goto`. Prefer selectors that already work in the plugin's scenarios.
- IDs are kebab-case (`^[a-z0-9][a-z0-9-]*$`) and unique within their list.

## PLAYBOOK.md

Free Markdown; these headings make the information easy for readers and clients to find:

1. `# <Plugin title> playbook`: one paragraph, same scope as `summary`.
2. `## Surfaces`: table `Surface | Route | Status | What you see`.
3. `## Entities`: the fake data, with the literal names to use.
4. `## Actions`: per action: preconditions, outcome, persists yes/no, scenario that shows it.
5. `## Demo moments`: one line each, with scenario/shot.
6. `## Not supported`: what to avoid and why.
7. `## Locales`: which locales render translated UI and any per-locale caveats.
8. `## Snippets`: the snippets as YAML blocks.

Keep the playbook concise: the YAML is the structured source of truth; prose can explain caveats a table cell cannot hold.

## Validation

`./mockshop validate <p>` (and `--all`, or a direct path to `vocabulary.yaml`) checks, when the file exists:

- **Schema**: `schema/vocabulary.schema.json` (unknown fields are errors, with "did you mean").
- **Plugin**: `plugin` equals the plugin dir name.
- **References**: every `surface`/`surfaces`/`entities`/`action` reference names a defined id; ids are unique per list.
- **Scenarios**: every `scenario:` names an existing `plugins/<p>/scenarios/<name>.yaml`; a moment's `shot:` exists in
  that scenario.
- **Locales**: `locales` is a subset of `plugin.yaml` `localization.locales`; `default_locale` is in `locales`.
- **Editions**: `edition` is a key of `plugin.yaml` `editions`.
- **Routes**: when the plugin has a built web route table (source-build plugins), every `works`/`partial` route must
  match it (error). Otherwise routes are checked against the `goto` paths of the plugin's scenarios: a `works`/`partial`
  route that no scenario opens is a warning (not checked against a route table), never an error.
- **Snippets**: every snippet step is a valid scenario step.
- **PLAYBOOK.md**: a warning if `vocabulary.yaml` exists without `PLAYBOOK.md`.

## Workflow for agents

1. Read `vocabulary.yaml` (or `PLAYBOOK.md`) before reading handlers or fixtures.
2. Pick surfaces with status `works`/`partial`, actions and moments; reuse snippets and the referenced scenarios.
3. Avoid everything in `not_supported` and any surface with `placeholder`/`needs-capture`.
4. When you add a scenario that shows a new action or moment, add it to the vocabulary and run `./mockshop validate <p>`.
