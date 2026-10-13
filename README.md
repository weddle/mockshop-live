# Mockshop

**Experimental v0.3.0 · Onyx first**

Mockshop runs a real, pinned application frontend against a lightweight fixture backend. YAML scripts drive the UI with Playwright to produce screenshots or paced video walkthroughs, without running the application's production backend or using live accounts.

The included application is [Onyx](plugins/onyx/README.md). Its frontend is built locally from upstream commit `f858083d6cbe37c4146834d379e39511260a9879`, with the small patches in `plugins/onyx/patches/`. The backend supplies fictional fixture data, scripted chat streams and selected stateful interactions. This repository does **not** contain an upstream frontend build, captured proprietary bundles or a working Onyx production backend.

Version **0.2.0** adds reusable worlds, script-local content and exact replies, scenes/steps, independent presentation profiles, scoped overrides and render-source lookup. It retains macOS support from **0.1.1**. The public examples are now a small authoring reference; detailed operating guides preserve the knowledge from the historical sample collection. This is not a promise of full frontend coverage or production readiness.

Version **0.3.0** extends Onyx's editable, resettable demo state: agent Advanced Options and knowledge selections; live connector, group, provider and document-set views; federated connector create/edit/delete; deterministic native greetings; and saved Slack answer-type readback. It retains artifact-free validation from **0.2.1** and the existing worlds/scripts/profiles architecture. Native frontend changes require a matching local rebuild; no production integrations or private operating material are included.

## What is included

- **Pinned frontend builds:** fetch the manifest's upstream source, apply patches, build a slim local runtime and record file hashes for verification.
- **Fixture backend:** YAML routes plus JavaScript handlers for selected saves, lists, sessions and streams. Fixture overlays change the demo data; script starts reset in-run state.
- **YAML scripts:** a shared step vocabulary for screenshots, clips and live control, with schema and plugin-aware validation.
- **Screenshots:** PNGs and a JSON report of failed steps and observed browser problems.
- **Clips:** MP4 recordings, action timelines and WebVTT cues, with cursor motion, pauses, title cards and timing markers.
- **Localization:** select the UI translations shipped by the pinned frontend; fixture text and scripted answers are not automatically translated.
- **Live control:** one JSON step per stdin line, one JSON result per stdout line, with export to script YAML.
- **Pin cache:** preserve locally built runtimes outside Git and restore matching pins before rebuilding.

```text
YAML script -> Playwright -> pinned Onyx frontend (:3300)
                                      |
                                 API requests
                                      v
                         fixture backend (:8800)
                                      |
                          YAML + selected handlers

Outputs: out/onyx/<script>/ or out/onyx/clips/
```

## Requirements

The build and process-management baseline is **Linux x86-64** and **macOS (Apple Silicon)**:

- Node.js 20+ and npm on `PATH` to bootstrap the CLI; a currently supported Node release is recommended. Onyx's pinned Node toolchain is downloaded into `.toolchains/` when needed.
- Git, Bash, `curl`, `tar`, `patch`, and either GNU command-line utilities plus `ss` (typically from `iproute2`) on Linux, or the stock macOS tools including `lsof`.
- Bun at the version declared in [the Onyx manifest](plugins/onyx/plugin.yaml), currently `1.4.2`, to build Onyx. A different Bun version emits a warning rather than being installed automatically.
- Installed Chrome or Chromium. Set `CHROME_PATH` to its executable if discovery does not find it. Mockshop uses `playwright-core` and does not download a browser.
- `ffmpeg` with H.264 encoding support for `clip` and `live --clip`.
- Several GB of free disk for the temporary frontend build, dependencies, runtime, cache and outputs, and enough memory for a Next.js build.
- Network access for the initial toolchain, dependency and upstream downloads. A completed runtime/cache reduces later network dependence; allowed fonts and favicon requests can still use the network.

Other platforms (Windows, Intel Macs, Linux ARM) are untested. The bootstrap downloads the Node archive matching `process.platform`/`process.arch`, so any platform with a published Node build for the pinned version may work, and port discovery uses `ss` on Linux and `lsof` on macOS.

## Quick start

Run from a Linux x86-64 or macOS arm64 machine with the requirements installed:

```bash
git clone https://github.com/weddle/mockshop-live.git
cd mockshop-live
npm ci
export MOCKSHOP_PIN_CACHE="$HOME/.cache/mockshop/pins"

./mockshop plugins
./mockshop build onyx --community
./mockshop verify onyx
./mockshop validate onyx
./mockshop up onyx
./mockshop shot onyx/omzo-followup
./mockshop clip docs/examples/omzo-incident.yaml
./mockshop down onyx
```

There is no `mockshop install` command or published global CLI package: install this checkout's dependencies with `npm ci`, then use `./mockshop`. The wrapper also installs dependencies on demand if `playwright-core` is absent.

`up`, `shot`, `clip` and `live` build on first use if the runtime artifact is missing. An existing but modified runtime is not silently repaired: `up` prints verification warnings; use `verify` explicitly and rebuild when necessary.

The frontend is at `http://127.0.0.1:3300`; the fixture backend is at `http://127.0.0.1:8800`. Browser scripts set a fictional auth cookie. Browsing manually may first show Onyx's native login page; this is demo authentication, not real account security.

## Commands

```bash
./mockshop plugins                         # list discovered plugins
./mockshop build onyx --community          # fetch, patch, install, build, assemble runtime
./mockshop build onyx --keep-work          # keep temporary source/dependencies for inspection
./mockshop verify onyx                     # verify pin, customizations, edition and file hashes
./mockshop pin onyx                        # show manifest pin and runtime metadata
./mockshop up onyx                         # start local frontend and fixture backend
./mockshop status onyx
./mockshop restart onyx
./mockshop down onyx

./mockshop validate onyx                   # manifest, vocabulary and scripts; no browser
./mockshop validate onyx/omzo-incident
./mockshop validate docs/examples/mini-clip.yaml
./mockshop shot onyx/omzo-incident
./mockshop shot onyx --all                 # the small public example set
./mockshop clip docs/examples/omzo-incident.yaml
./mockshop shot onyx/cursor-demo --locale ja
./mockshop live onyx --name walkthrough --save walkthrough.yaml
./mockshop live onyx --clip --locale ja

./mockshop switch onyx                     # return running backend to base/edition fixtures
./mockshop cache list
./mockshop cache verify onyx
./mockshop fetch onyx                      # debug: export pinned, patched source without building
```

Targets can be `onyx/<script>`, just `<script>` for the default plugin, a plugin name for all its scripts, or a YAML file path. Files beginning with `_` are excluded from batch discovery. `--plugin <name>` selects a plugin explicitly; `MOCKSHOP_PLUGIN` changes the default. External plugin roots can be supplied through colon-separated `MOCKSHOP_PLUGIN_PATH`; no additional application distribution is included here.

Port overrides are `MOCKSHOP_ONYX_WEB_PORT` and `MOCKSHOP_ONYX_MOCK_PORT`. The backend state is shared by every session using that process: use separate ports for concurrent instances, locales or fixture variants. `down` stops listeners on the configured ports, so choose ports you control.

## Scripts

Use a **world** for reusable company/cast/content; a **script** containing **scenes** and **steps** for the walkthrough; and a **profile** for cursor/render defaults. Start with [the short Omzo example](docs/examples/omzo-incident.yaml), [its shared world](worlds/omzo/world.yaml), and [a second story using the same world](docs/examples/omzo-followup.yaml).

The [world/script specification](docs/worlds-spec.md) defines composition and override behavior. The [generation guide](docs/generate-world.md) specifies how an assistant or trusted script produces the same editable files from a prompt.

The default examples are deliberately small. The older collection and its worlds/profiles live under [`reference-examples/`](reference-examples/README.md), outside normal discovery and `--all` runs. To author a new walkthrough, use the [Onyx operating playbook](plugins/onyx/PLAYBOOK.md), [backend/API map](plugins/onyx/API-MAP.md), and [historical knowledge coverage index](plugins/onyx/docs/script-coverage.md). Those references retain the routes, controls, state, seed dependencies and simulation boundaries without requiring an old script.

```bash
./mockshop validate docs/examples/omzo-incident.yaml
./mockshop clip docs/examples/omzo-incident.yaml --profile profiles/zoom-blue.yaml
./mockshop explain out/onyx/clips/omzo-incident-example.timeline.json --at 0:05
```

Script `content` adds to or overrides its world without modifying shared files. Put an exact question, queries, citations and reply together in an Onyx `send` step. Use `presentation` on a script, scene or step for scoped direction, or `--render-overrides file.yaml` to restyle by stable scene/step IDs without editing the script. Narrow presentation settings revert at scope end.

A minimal example using the included Onyx input:

```yaml
name: typed-question
viewport: [1440, 900]
strict: true
steps:
  - goto: /app
  - wait: { selector: "#onyx-chat-input-textbox" }
  - type:
      selector: "#onyx-chat-input-textbox"
      value: "Hello"
  - shot: question
```

Save it as a YAML file, then pass its path to `validate` and `shot`. Prefer locators documented in the plugin's operating references: `testid`, `role` plus `name`, `placeholder`, `label`, visible `text`, or a stable CSS `selector`.

Operations include navigation, click/hover, fill/type, key presses, waits, scroll, evaluation, screenshots and fixture-state switches. Clip pacing adds `pause`, `card` and cursor movement. `mark`/`keyframe` label timeline points; `at:` aligns a step to a clip time. See [the complete script reference](docs/script-spec.md), [cursor options](docs/cursor.md) and [the clip example](docs/examples/mini-clip.yaml).

`shot` writes `out/<plugin>/<script>/NN-<shot>.png`, `report.json` and `resolved.json`. A failed step also produces `FAILED-stepN-<op>.png`. `clip` writes an MP4, `.report.json`, `.resolved.json`, `.timeline.json` and `.vtt` under `out/<plugin>/clips/`. Resolved metadata records source inputs and hashes; the timeline records scene/step IDs, effective presentation and action timing. Mockshop does not synthesize narration or music.

In non-strict mode, failed steps fail the command while other observed problems are reported. `strict: true` also fails on unexpected console/page errors, HTTP failures and unmocked backend requests. Narrow, reasoned `known_errors` matches classify known problems separately; they never excuse failed steps. Since **0.2.1**, validation works without a compiled frontend: schemas, references, plugin compilation and alias definitions are checked, while physical frontend route and alias-destination checks explicitly report that they were skipped. Those route checks run automatically when the compiled route table is available. Validation cannot prove locator correctness or visual quality: inspect the reports and images.

## Authoring demos

Designers and coding agents authoring worlds, scripts or presentation changes should read the [demo-authoring skill](skills/demo-authoring/SKILL.md). It is a short procedure that links the authoritative specifications and plugin operating references; it is not loaded automatically.

## Live control

`./mockshop live onyx` accepts JSON lines using the script step vocabulary:

```json
{"goto":"/app"}
{"wait":{"selector":"#onyx-chat-input-textbox"}}
{"type":{"selector":"#onyx-chat-input-textbox","value":"Hello"}}
{"shot":"typed"}
{"cmd":"save","path":"walkthrough.yaml"}
{"cmd":"end"}
```

The session emits a readiness record, step results with screenshot paths, and a final record. Optional input `id` values are echoed. Only successful steps are exported. Exported YAML does not automatically preserve the session's CLI locale or clip mode: add script metadata or pass the same flags when replaying. See [the live-control guide](docs/agent-guide.md).

## Editions and licensing

**Community is the default** and disables Onyx's paid-EE frontend feature flag. Opt-in builds are available as `--enterprise` and `--edition enterprise-cloud`; the latter enables native Cloud frontend branches against mock fixtures, not a live cloud service.

Edition selection is build flag, then `MOCKSHOP_ONYX_EDITION`, then untracked `mockshop.local.yaml` (for example `onyx: { edition: enterprise }`), then the manifest default. To verify or run an opt-in edition consistently, keep its environment/local selection in effect. `requires:` scripts incompatible with the built edition are skipped, not counted as failures. A batch run is therefore not a claim that every included script ran.

Mockshop's original code is **MIT**, Copyright (c) 2026 Ryan Weddle; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Vendored cursor-motion code keeps its own MIT notice in `core/vendor/cua-cursor-motion/`. Dependencies have their own licenses.

Onyx code outside its `ee/` directories is MIT Expat licensed. Onyx's `ee/` code is under the **Onyx Enterprise License**, not MIT. The upstream frontend imports EE modules even when Community features are disabled, so a locally generated Community runtime can contain EE code. Disabling the feature flag does not relicense it. Two included patches, `0009-custom-analytics-client-boundary.patch` and `0012-custom-analytics-script-readback.patch`, contain Enterprise source excerpts and modifications; their headers identify that exception, and the exact pinned terms are included in [ONYX-ENTERPRISE-LICENSE.txt](plugins/onyx/patches/ONYX-ENTERPRISE-LICENSE.txt). Use and distribution remain subject to those terms. This repository ships the integration, fixtures and patches, **not an upstream build or an Enterprise license grant**. Mockshop is not affiliated with or endorsed by Onyx.

## Fixtures and plugin interface

A plugin directory contains a `plugin.yaml` manifest, `fixtures/base/*.yaml` and `scripts/*.yaml`. Optional `handlers.mjs` implements dynamic behavior; patches and overlays customize the pinned source. [Vocabulary documentation](docs/plugin-vocabulary.md) explains the machine-readable capability inventory and readable playbook.

An optional `adapter.mjs` compiles resolved shared world data and `apps.<plugin>` settings into ordinary fixtures and executable steps. Shared entity collections are optional; plugins need not implement chat or documents. Explicit unsupported script requests fail rather than silently degrading. Generated fixture sets are not authoring files.

Fixture files load in name order. The edition overlay sits above base, and script overlays sit above the edition. Later layers win. Saving fixture files reloads the backend. Responses can use time templates relative to `demo_anchor`, route parameters, or explicit status envelopes:

```yaml
GET /items/:id: { id: "{{param:id}}", updated_at: "{{ago:2h}}" }
POST /example-denied: { __status: 403, __body: { detail: "Demo denial" } }
```

Unmatched routes are logged to `logs/<plugin>/mock-misses.log`. Strict requests receive HTTP 501; non-strict requests can receive guessed empty JSON responses. A 200 fallback is not evidence that an API is implemented.

Key manifest fields (complete machine-readable definitions: [plugin schema](schema/plugin.schema.json)):

| Field | Purpose |
|---|---|
| `name`, `title`, `kind` | Plugin identity and frontend integration type. |
| `upstream.{repo,commit,subdir,local_mirror}` | Exact source pin; an optional mirror is read-only. |
| `toolchain.{node,bun}` | Required build tool versions. |
| `edition`, `editions` | Build flags and edition fixture overlays. |
| `workdir`, `build` | Temporary source directory, patches/overlay and install/build commands. |
| `runtime` | Runtime directory, assembly copies, required artifact and runtime-written exclusions. |
| `ports`, `start` | Local server ports, command, environment and readiness path. |
| `mock.{handlers,fixtures,strip_prefix}` | Backend handler module, fixture root and request prefix. |
| `runner` | Browser defaults, demo clock, cookies, allowed hosts, strictness and known problems. |
| `localization` | Supported UI locales, aliases, cookie and mock user-language fields. |
| `route_aliases` | Static validation metadata for native frontend rewrites; does not install routes or bypass gates. |
| `hooks` | Optional module replacing the default fetch/build lifecycle. |

A handler module's default factory receives `core` (plugin, state, response/stream helpers, templating, fixture lookup and logging). It returns `routes`, optional fixture `transform` functions keyed by `METHOD /path`, and optional `reset(body)`. Route entries use `{method, path, handle(ctx)}`; `ctx` exposes parameters, query, async `body()`, `send`, request/response and shared state. Handlers run before fixtures; returning `false` permits fall-through. `reset` runs when `/__mockshop/state` is updated. See the included handler modules for concrete implementations.

A hooks module may export `fetch(m, ctx)` and `build(m, ctx)`; `ctx.defaults` provides the normal fetch/build/toolchain helpers. The core also contains generic captured-frontend routing, but no captured application assets are included or licensed by this distribution.

## Cache and generated files

Set `MOCKSHOP_PIN_CACHE` to a writable location outside the checkout, as in the quick start. The inherited default is an absolute directory and is not a portable per-user choice. The cache stores SHA-256 blobs and pin manifests keyed by upstream revision, edition and build/customization configuration. `cache verify` rehashes stored blobs. Normal builds try a matching cache first; `--keep-work` deliberately performs a fresh build.

Generated files are not source distribution content:

- `plugins/onyx/work/`: temporary upstream source, dependencies and build intermediates; normally removed after assembly.
- `plugins/onyx/runtime/`: the locally built runnable frontend and its verification manifest.
- `plugins/<plugin>/fixtures/.built/`: compiled script fixtures; regenerated from world/script inputs.
- `.toolchains/`: downloaded Node toolchain.
- `out/`: screenshots, recordings and reports.
- `logs/`: build, frontend, mock and miss logs.

`verify` checks recorded provenance and file hashes; it is not a security audit or proof of complete UI coverage. Cache contents retain upstream licensing obligations and should not be published as part of this repository.

## Limitations and references

This is an experimental, script-oriented integration. Some routes and actions are partial or absent; frontend controls may render without a corresponding backend implementation. Mock saves generally persist only within the current run, not across backend restarts. Scripted answers do not perform retrieval or call real models. The Onyx capability inventory and documentation describe intended scope, but do not guarantee that every script succeeds on every browser, locale or edition.

Use fictional data and trusted script/plugin files: `eval` steps execute page JavaScript, plugin handlers execute local code, and build manifests run shell commands. Mockshop is a local demo tool, not an authentication boundary or a sandbox for untrusted code. The browser runner blocks most outbound requests, but allowed hosts and build downloads mean it is not an absolute offline/security guarantee.

- [Onyx integration and known gaps](plugins/onyx/README.md)
- [Onyx controls and authoring playbook](plugins/onyx/PLAYBOOK.md)
- [Onyx mock backend/API contract](plugins/onyx/API-MAP.md)
- [Script specification](docs/script-spec.md)
- [Reusable worlds and scoped presentation](docs/worlds-spec.md)
- [Prompt-to-world generation](docs/generate-world.md)
- [Cursor configuration and attribution](docs/cursor.md)
- [Script authoring and live protocol](docs/agent-guide.md)
- [Plugin vocabulary format](docs/plugin-vocabulary.md)
- [Example live-session YAML](docs/examples/live-session.yaml)
- [Example clip timeline](docs/examples/mini-clip.timeline.json)
