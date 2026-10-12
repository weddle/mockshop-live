# Onyx plugin

Onyx is the first application included with Mockshop. The plugin builds the real, pinned Onyx frontend and serves it against editable fictional fixtures and small in-run state handlers. No Onyx account, model provider or production backend is required for the scripted demos.

## Run it

Follow the [root quick start](../../README.md) for platform prerequisites (Linux x86-64 or macOS arm64) and installation. From the repository root:

```sh
export MOCKSHOP_PIN_CACHE="$HOME/.cache/mockshop/pins"
./mockshop build onyx
./mockshop verify onyx
./mockshop validate onyx --all
./mockshop up onyx
./mockshop shot onyx/omzo-followup
./mockshop clip docs/examples/omzo-incident.yaml
./mockshop down onyx
```

The default web port is `3300`; the fixture backend uses `8800`. Use `MOCKSHOP_ONYX_WEB_PORT` and `MOCKSHOP_ONYX_MOCK_PORT` to select different ports. Output is written under `out/onyx/`; frontend source, runtimes, caches, logs and recordings are generated locally and are not part of this repository.

The frontend is pinned to upstream Onyx commit `f858083d6cbe37c4146834d379e39511260a9879`. Toolchain, patches, editions, ports and runtime assembly are specified in [plugin.yaml](plugin.yaml). A sibling Onyx checkout is optional; otherwise the build fetches the pinned upstream source.

## Make a demo your own

- **Shared content:** edit a world such as [`worlds/omzo/world.yaml`](../../worlds/omzo/world.yaml). Company, people, teams, sources, documents and conversations use stable keys. Keep recurring names and prose linked with `{{people.sam.name}}`-style references.
- **Onyx mappings:** optional `apps.onyx` data supplies agents, explicit IDs, model aliases and specialized Onyx seed DTOs. See [`world.schema.json`](world.schema.json). The adapter generates real API routes, history, citations and local source previews; it does not send generic world objects to the frontend.
- **Exact replies:** put each prepared reply beside its scripted `send`. A live model is not involved. Identical questions at different step IDs can deliberately receive different answers.
- **Interaction:** write a short YAML script that drives the real controls. Start with the complete [Omzo incident](scripts/omzo-incident.yaml) and [Omzo follow-up](scripts/omzo-followup.yaml) examples, which share one world rather than copying their company and cast.
- **Presentation:** select a reusable profile and optional render overrides; keep business content out of those settings. Cursor movement drives real browser mouse actions rather than adding an invented pointer afterward.
- **State:** supported create, rename, save, delete and selection actions persist during a run. Fresh runs reset fake state; this is not durable storage.

The three default examples demonstrate specific visible outcomes, not a supported catalog of every product feature. Author the script needed for the task using the [playbook](PLAYBOOK.md) and [backend/API map](API-MAP.md), then inspect its report and output. Larger historical samples live under [`reference-examples/`](../../reference-examples/README.md), outside default discovery; [their knowledge coverage index](docs/script-coverage.md) keeps provenance without making those samples dependencies.

### World-to-Onyx mapping

`fixtures/base/` and the edition overlay are neutral platform defaults, not a default fictional company. Compilation writes complete disposable snapshots under `fixtures/.built/`; do not edit generated files. Source-vendor, person and document edits flow through native list/detail DTOs and linked reply/source content.

No `apps` block is required for a small world. The first declared person is the viewer unless you select one explicitly:

```yaml
apps:
  onyx:
    viewer: sam
```

Optional `apps.onyx.people.<key>.id`, team/group mappings, source IDs and document IDs preserve exact native identities where needed. Otherwise identities derive from stable entity keys, not names or list positions. Agent ownership and knowledge refer to person/source keys. `apps.onyx.fixtures` is reserved for ordinary Onyx seed DTOs needed by a particular native screen, not a second generic data model.

Supported source vendors are `confluence`, `notion`, `google_drive`, `github`, `slack`, `jira`, `zendesk`, `file`, `web`, `salesforce`, `zoom`, `sharepoint` and `gmail`. Changing a source's vendor derives matching labels, configuration, citation types and fictional URLs without changing its identity. Explicit incompatible URLs/configuration and source-specific connector locators fail rather than retaining the old vendor. Use `config_by_vendor`/`credential_by_vendor` when a source needs vendor-specific details. Unused unsupported background sources may remain in shared content; requesting them in an Onyx view or citation fails.

### Prepared turns and persistent screen state

Each stable step owns its reply:

```yaml
- id: explain-rollback
  send:
    text: Who owns the rollback?
    reply:
      text: "{{people.sam.name}} coordinates the rollback. [1]"
      queries: [Relay rollback]
      cites: [rollback]
```

`cites` names shared document keys in numbered-citation order. The adapter arms this exact step once, types and sends through native controls, and waits for both backend completion and the newest answer's rendered completion marker. An optional `send.wait` runs afterward. Arming does not reload the page or clear chat history. Missing prepared data is an error, never a regex fallback. Manual exploratory replies can still be authored under `apps.onyx.replies`; their regex matching cannot consume exact-step replies.

```yaml
- id: stage-follow-up
  state:
    sidebar: [relay-rollback-runbook-walkthrough, weekend-on-call-handoff-notes]
    connectors: [runbooks]
    agent: null
    model: gpt-5.2
```

Sidebar and connector lists are ordered entity-key selections. Agent keys belong to `apps.onyx.agents`; `null` selects the built-in assistant. Models use catalog names or `apps.onyx.models` aliases; `null` clears the selection. Screen controls persist until an explicit change or run reset. By default they preserve the backend conversation and refresh the same browser route; a sidebar selection hides other entries without deleting the active chat. Explicit `keep: false` or `resetChats: true` requests a reset instead. Do not combine keyed screen selections with raw `overlays`, `turn` or `screen` controls. Follow screen changes with a wait/assertion for the specific hydrated native control you intend to show.

Advanced `state.world` selects a precompiled **whole world** for explicit account/world-switch demonstrations. It persists until another switch or reset; it is not a scoped entity patch and does not automatically revert at scene boundaries. Keep/reset policy is explicit. Author references still resolve against the script's immutable primary content.

Runtime fixture tokens are different from content references. When an advanced seed needs one, migrated worlds explicitly use `vars.onyx_template_open: "{{"` and, for example, `"{{vars.onyx_template_open}}ago:2h}}"`. Bare `{{ago:2h}}` is not a valid shared-content reference. Prefer ordinary authored values unless a native fixture actually needs a runtime token.

See the [worlds specification](../../docs/worlds-spec.md) for content composition and the [script reference](../../docs/script-spec.md) for native operations. Backend state is process-wide: concurrent independent runs require separate ports, not merely separate browser sessions.

## Editions and licensing

Community is the default. Enterprise and Cloud variants are opt-in and may expose additional native controls. Scripts declaring `requires: enterprise` cannot establish Community coverage. See the root [NOTICE](../../NOTICE) and Onyx's upstream license before using an Enterprise variant; Mockshop's MIT license does not license Onyx Enterprise code.

This repository does not bundle an Onyx frontend build. The local upstream build includes modules subject to their upstream licenses, including `ee/` modules imported by Onyx. Do not redistribute a generated runtime without reviewing those licenses.

The included custom-analytics patches `0009` and `0012` contain Onyx Enterprise source excerpts and modifications, not MIT-licensed Mockshop code. Each patch identifies its license scope; the exact pinned terms are included in [ONYX-ENTERPRISE-LICENSE.txt](patches/ONYX-ENTERPRISE-LICENSE.txt). Use and distribution remain subject to those terms.

## Limits and safe operation

This is a local demo system, not an Onyx replacement backend. Authentication screens, credentials, connectors, billing, provider setup and related actions use fictional local data where supported; they do not establish real accounts, permissions, integrations or model access. Do not supply real passwords, provider keys, tokens or customer data. The runner blocks unapproved outbound hosts; configured font/favicon hosts remain subject to network availability.

`report.json` records failed steps, requests and console diagnostics. Strict scripts can fail on unexpected errors. A successful build or a screenshot alone is not proof of the desired interaction; inspect the resulting state and report. UI coverage in this experimental release is incomplete.

See [API-MAP.md](API-MAP.md) for the plugin's fixture/state architecture and [PLAYBOOK.md](PLAYBOOK.md) for practical demo authoring.
