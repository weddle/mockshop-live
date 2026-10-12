# Specification: reusable worlds, explicit scripts, independent profiles

Status: approved implementation specification. This document defines the world, script, and presentation authoring contract.

## Decision

Build a small data resolver in front of the existing fixture/runner system, not a content platform or a new programming language.

Three author-facing concepts:
- **World**: reusable background data, such as Omzo, its people, documents and conversations.
- **Script**: the demo script: ordered scenes and steps, script-local content, and exact results.
- **Profile**: reusable presentation defaults, such as cursor appearance, motion and timing.

A **scene** groups consecutive steps. A **step** is one instruction. A **demo** is the informal name for the experience; a **clip** is its rendered video. Use these consistently in schema/docs, without banning ordinary English synonyms.

Separation is about ownership, not forcing everything into separate files: worlds must not contain cursor settings; scripts may select a profile and carry explicitly scoped presentation overrides.

## 1. World design

Start with one world.yaml. Allow explicit includes when it gets large; do not require one file per entity type. Markdown bodies may be referenced through an explicit file field.

Use maps keyed by stable identifiers, rather than arrays of records with repeated key fields:

```yaml
company:
  name: Omzo
  domain: omzo.example
people:
  dana:
    name: Dana Reyes
    title: Director of Reliability Engineering
  sam:
    name: Sam Adeyemi
sources:
  runbooks:
    name: Engineering Runbooks
    vendor: confluence
documents:
  rollback:
    source: runbooks
    title: Relay rollback procedure
    body: "Contact {{people.sam.name}} before starting the rollback."
```

Typed shared entities should be few and genuinely reusable: company, people, teams, sources, documents, conversations/messages, plus a free-form `vars` map. All collections are optional. Chat history can share people and message text; an assistant's search traces and tool events need not become a universal conversation schema.

Application-specific content belongs under `apps.<plugin>` and is validated by that plugin. Onyx agents, model-provider settings, indexing state, access rules and prepared response details need not all become core abstractions. These blocks may reference shared entities and variables. They can live in separate included files, leaving the shared company/cast clean.

Only promote an application-specific concept into core when another real plugin needs substantially the same semantics. No mandatory chat, document, or send baseline for plugins.

## 2. Composition and overrides

One composition rule everywhere data is combined:
- Objects merge recursively.
- Scalars and arrays replace.
- Omitted fields inherit.
- `null` is a value, not a deletion instruction.

World includes load in listed order, then the owning file. Paths are relative to their declaring file. Reject include cycles. No search-path precedence, remote fetching, semver resolver, or content lockfile. Git and explicit paths handle sharing/versioning; record input hashes with each render.

A script's `content` has the same shape as a world and merges onto it. It can add data as well as override data. This is how a new incident gets its own documents, facts and conversations without modifying Omzo or creating another world.

```yaml
world: ../worlds/omzo/world.yaml
content:
  people:
    sam:
      name: Sam Okafor
  vars:
    incident: INC-2400
  documents:
    incident-note:
      source: runbooks
      title: "{{vars.incident}} incident notes"
      body: "{{people.sam.name}} coordinated the response."
```

For deletion, provide one explicit `remove` list of entity paths in the script, applied after composition and before validation. Removing referenced data is an error. Prefer explicit screen item lists when the intent is hiding an item rather than deleting it. Do not introduce append/remove-by-predicate/rename/conditional patch languages.

Do not support world mutation scoped to a step: changing the global person catalog for one frame has unclear persistence semantics. Exact local responses and explicit screen state provide local control without that ambiguity.

## 3. References and scriptability

Use `{{people.sam.name}}`-style path substitution in textual values, including script text and locators. A whole-value reference preserves the referenced type; embedded substitutions must resolve to scalar text. Resolve after world/script composition. Reject missing paths, cycles and unsafe property access; report file and field. Do not recursively interpret substituted text as fresh template source.

For reusable structured defaults, use one optional `use` reference on a structured object, then merge its explicit fields over the referenced object. This uses the same merge rule, not a new inheritance system. Validate the resulting object against its expected type.

```yaml
reply:
  use: apps.onyx.replies.incident-summary
  queries: ["INC-2400 rollback owner"]
  text: "{{people.sam.name}} coordinated the rollback."
```

Keep arithmetic, loops, random selection and general computation out of YAML. Deterministic adapter computations handle mechanical totals and DTO fields. Authors can generate ordinary YAML/JSON using an explicitly invoked trusted script in their preferred language. The runtime never automatically executes code from a world. This supplies full scriptability without implementing or claiming a JavaScript sandbox.

Do not warn merely because an intentional literal replaced an inherited value. Do not require every number in prose to be a fact. References are valuable where reuse is intended, not a rule against writing normal text.

Rename propagation applies to references, not arbitrary literal prose. Generated/default worlds must use references for recurring identities. Literal-name scans can flag likely leftovers, but never silently rewrite text or pretend to understand its meaning.

## 4. Scripts: make the actual script easy to see

Use an ordered list of scenes, each containing an ordered list of steps. Scene and step IDs are stable author names, not list positions. Step IDs should be unique within a script, making presentation targets and timeline lookup unambiguous.

Authoring structure:

```yaml
world: ../worlds/omzo/world.yaml
plugin: onyx
profile: ../profiles/zoom-blue.yaml

content:
  people:
    sam:
      name: Sam Okafor

scenes:
  - id: investigate
    steps:
      - id: incident-question
        send:
          text: "Who handled the rollback?"
          reply:
            queries: ["relay rollback incident commander"]
            cites: [rollback]
            text: "{{people.sam.name}} coordinated the rollback."
  - id: admin
    presentation:
      cursor: false
    steps:
      - id: show-connectors
        goto: /admin/indexing-status
```

Question, queries, citations and reply are adjacent; editing one exchange needs no world edit and no regex update. Register/select its prepared response by stable step identity, scoped to the current run/session, before the UI submission; consume it once and clear it on reset. Manual browsing without an active scripted response remains a separate plugin concern; never silently substitute another reply if an explicitly armed response is missing.

Exact screens stay supported. A plugin exposes a small typed `state` instruction using author-facing values and entity keys: sidebar items, connector rows, selected agent, model, etc. Such state persists until another explicit change or run reset. This is distinct from temporary presentation scope. Plugin implementations must handle the real frontend's state/cache behavior; a route override alone is not proof the screen changed.

For explicit organization/account-switch demonstrations, Onyx supports persistent `state.world` pointing to another local world file. The adapter precompiles the alternate world and lowers the switch to ordinary fixture-state controls. This switches the complete background until the next switch/reset; it is not a temporary step-scoped entity override and does not mutate either source world.

Keep lower-level navigation/click/type/press/wait instructions available. High-level `send` is an Onyx convenience, not a universal plugin requirement. A script can be completely hand-authored.

Do not start with runtime script template inheritance, steps-as-map patches, automatic scene reordering, or separate script packs. A starter copies an ordinary editable script. Moving/deleting scenes means moving/deleting the corresponding list entries. Reuse worlds and content immediately; introduce a single explicit snippet/include mechanism for action sequences only when repeated real scripts justify it.

Sharing content across applications does not promise the same UI script runs across them.

## 5. Presentation: defaults plus natural scopes

Profiles contain existing cursor/render settings, not world content. Scripts may select a default profile. A CLI profile replaces that selection, allowing a finished demo to be rerun with another cursor/color/motion style.

Effective settings are: engine defaults < selected profile < script presentation < scene presentation < step presentation. Object fields merge; narrower settings revert at the scope end. Cursor hidden state must not discard inherited appearance settings needed when it becomes visible again.

Profile files use `cursor`, `clip`, `viewport`, `scale`, and `theme` settings. `presentation` uses the same shape. Scene/step presentation may change cursor settings and clip pacing, not encoding/session settings such as viewport, FPS, scale, or theme.

External render overrides use `{presentation: {...}, scenes: {scene-id: {...}}, steps: {step-id: {...}}}`. Paths supplied with `--profile` or `--render-overrides` are relative to the working directory; profile paths inside a script are relative to that script.

For restyling without touching a script, support a render override file with only three targets: script, scene ID, step ID. Matching render overrides win over inline values at the same scope; narrower scope still wins. A script-wide setting does not accidentally unhide a deliberately hidden scene. To change that decision, target the scene explicitly.

No arbitrary selector grammar, click-number matching, absolute-time cues, or profile inheritance stacks. A timestamp can be looked up in the render timeline to find a stable step ID.

Retain precise pauses and cursor moves when explicitly scripted. They are legitimate manual direction. Do not force authors to translate every timing decision into new beat/emphasis abstractions. Presentation settings must remain outside world/content sections.

## 6. Small implementation boundary

Pipeline: load data -> merge -> resolve references -> validate -> plugin compile -> existing fixtures + executable script -> existing runner/render.

Compile one complete effective script fixture set, not separate world/script incremental builds with route dependency graphs. Recompile the small data set on change initially. This trades some redundant compilation for much simpler correctness and debugging; optimize only with measurements.

The plugin compiler owns API shapes, IDs, URLs, citation numbering, seed routes and app-specific state. IDs depend on stable entity keys, not names or declaration order. Backend-specific numeric ID requirements belong to the adapter; detect collisions. Explicit supported ID/URL values may be supplied where a demo needs them.

Compose app defaults, edition settings and fictional content inside the compiler before emitting ordinary fixtures. Do not make a generic route-patch language a prerequisite. Reuse existing runtime fixture mechanics where possible, and keep fictional defaults out of the neutral base.

An adapter consumes only the shared collections it understands, plus its own app block. Unused background content is fine. Explicit script requests for unsupported screens, operations, source vendors or references are errors, not quietly ignored or remapped. A requested Notion source must never silently render as Confluence.

Validation needs file/field diagnostics, resolved references, entity relationships, step IDs, supported app state and profile targets. Save resolved inputs, hashes and scene/step-to-time/source mappings beside the clip. Start with existing validate/render commands plus timestamp lookup; no large new CLI suite.

## 7. Prompt-to-world specification

Publish the actual schema, one small complete world, one complete script, and a generation instruction describing:
- The requested company, cast, reusable content and script-specific story.
- Stable keys and references for all recurring identities.
- Shared fields versus the requested plugin's optional app block.
- Existing world input, so generating a new script creates only its new content/overrides rather than cloning the company.
- Exact authored questions/results when requested; no inferred response required at render time.
- Reserved fictional domains for fabricated endpoints.
- Separate presentation output only when requested.

Any assistant or user script can produce those ordinary files. Validate and render them through the same path as hand-written content. Generation must not hide a second data model, require an LLM during rendering, execute downloaded pack code, or overwrite an existing world without explicit intent. Start with this clear generation contract, not a model-provider abstraction, repair orchestrator, judge service, denylist service or review/accept lifecycle.

## 8. Acceptance cases before calling the implementation complete

1. One Omzo world supports two distinct scripts; the second adds its own incident documents without copying people/company data.
2. Change one question, search-query list and response in one step; only that exchange changes, including when another step uses the same question.
3. Change one referenced person's name in the world: every reference in all scripts follows. Override it in one script: the world and other script remain unchanged. Literal leftovers are reported honestly.
4. Change a source vendor: all derived connector/citation/link representations follow when supported; incompatible explicit URLs/locators or unsupported vendors produce actionable errors. No automatic content rewriting or fallback vendor.
5. Explicit screen lists/order/state are reflected in the real frontend, without accidental reset of the current conversation.
6. Render the same script with two profiles. Content remains the same; scene hide and step color/motion overrides revert correctly.
7. Timestamp lookup identifies the rendered scene/step and the relevant authoring file, using that clip's own timeline rather than whichever render is latest.
8. The plugin contract has no compulsory chat/document baseline; unrelated app blocks and unused world content do not prevent reuse.
9. Generated and hand-written worlds use exactly the same schema and validation path.
10. A world with no Onyx-specific entities cannot leak another company's base fixtures into the UI.

These are end-to-end implementation acceptance cases, requiring actual frontend/video smoke evidence in addition to deterministic regression tests.

## 9. Public product and sample boundary

The maintained authoring surface contains the engine, plugin implementation, schemas, operating references, presentation profiles, one small reusable Omzo world, and a few complete example scripts. A plugin's feature set is **not** a catalog of hundreds of predefined scripts. Authors and agents write ordinary scripts from the operating documentation.

Preserve the larger historical demo collection and its specialized fictional worlds/content under `reference-examples/`, outside default plugin discovery and batch runs. Samples use the same public contract; the engine must not import their content by default. Extract all implicit operating knowledge into the maintained guides: screen routes, controls/selectors, API requests/responses, mutable state and resets, seed dependencies, timing, errors, no-ops, unsupported boundaries and edition gates. Retain a coverage/provenance index mapping the historical collection to those references. The archive can later move to a separate repository without changing the engine.

Core vocabulary is **world**, **script**, **scene**, **step**, and **profile**. “Scenario” is not another artifact or execution layer. Shared world content stays reusable; a script's local additions/overrides and exact screen instructions remain visible and editable. Migrate old fictional fixtures to explicit content, remove mixed-world defaults, and remove obsolete catalog terminology and paths rather than adding aliases. Keep unrelated build/edition/doctor fixes separate.

The hard unavoidable work is mapping content consistently into the real application's APIs and state. Spend complexity there, not in a generic language, dependency manager or universal application ontology.
