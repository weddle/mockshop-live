# Mockshop script spec

Authoritative reference for `plugins/<plugin>/scripts/*.yaml`, derived from `core/runner.mjs`, `core/clip.mjs`,
`core/timeline.mjs`, `core/cli.mjs`, `core/plugin.mjs`. Machine-readable form: [`schema/script.schema.json`](../schema/script.schema.json)
and [`schema/plugin.schema.json`](../schema/plugin.schema.json). Check files with `./mockshop validate` (below).

One YAML file = one script. `./mockshop shot` runs it to PNGs; `./mockshop clip` replays the same steps as a human-paced MP4
(plus a timeline). Files starting with `_` are skipped by `--all`.

## Script fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `steps` | list | either steps or scenes | Instructions run in order; flat form remains useful for direct scripting. |
| `name` | string | file name | Output dir `out/<plugin>/<name>/`, clip `out/<plugin>/clips/<name>.mp4`. |
| `title` | string | none | Informational only. |
| `plugin` | string | CLI/default plugin | Application integration used by an external script file. |
| `world` | local path | none | Reusable world YAML, relative to this script. |
| `content` | object | none | Script-local additions/overrides in the same shape as the world. |
| `remove` | list of entity paths | none | Explicit entity removals after composition; dangling references are errors. |
| `scenes` | list of `{id, steps, presentation?}` | either scenes or steps | Named consecutive groups of steps; IDs remain stable when reordered. |
| `profile` | local path | engine defaults | Presentation profile relative to this file; CLI `--profile` replaces this selection. |
| `presentation` | object | none | Script overrides for cursor, clip pacing, viewport, scale and theme. |
| `viewport` | `[w, h]` | manifest `runner.viewport`, else `[1440, 900]` | `clip.viewport` wins in clip mode. |
| `scale` | number | 1 | Browser deviceScaleFactor (2 = retina screenshots). Videos encode at viewport × scale (e.g. `[1152, 720]` at 2 → 2304×1440); CDP may supply CSS-resolution frames that are resampled, so output dimensions do not guarantee additional native detail. Cursor, locators, `[x, y]` points and the timeline stay in CSS px. |
| `theme` | `light`/`dark` | light | `prefers-color-scheme`. An explicit theme (script, `presentation`, profile or `--render-overrides`) is also sent to the mock with the start-of-run reset as `core.state.theme`, for plugins that render the app theme from user data. Without one, `core.state.theme` is unset and the world's own preference stays. Plugins that do not map `core.state.theme` only get `prefers-color-scheme`. |
| `locale` | string | see [Locale](#locale) | UI language (browser locale, Accept-Language, the app's selector cookie, mock user language). |
| `timezone` | string | manifest, else `America/New_York` | |
| `cookies` | list of `{name, value, domain?, path?}` | none | Added after the manifest's `runner.cookies`. |
| `overlays` | list of names | none | Extra fixture dirs under the plugin's `fixtures/`, layered on base. |
| `demo_anchor` | ISO 8601 string | manifest `runner.demo_anchor`, else real start time | Fixed demo "now": fixture `{{ago:2h}}` times and the page clock start here. |
| `continue_on_error` | bool | false | Keep going after a failed step (otherwise the run stops at the first failure). |
| `strict` | bool | manifest `runner.strict`, else false | Any unexpected problem (console/page error, HTTP >= 400, unmocked request) fails the run, not just failed steps. Strict unfixtured mock endpoints return 501; permissive requests can receive guessed empty JSON. The report includes strict server-side misses even when an SSR caller hides the error. Strictness and misses reset at each script start and survive in-run overlay/fixture resets. |
| `known_errors` | list of `{match, reason}` | none (plus manifest `runner.known_errors`) | Strict-mode allowlist. A problem line containing `match` (or matching `/regex/flags`) is reported as `known (<reason>)` and in `report.json` `known_problems`, and does not fail the run. Failed steps are never allowlisted. Use a narrow match and explain the known limitation in `reason`. Console errors retain the browser's available source URL as ` [source: <url>]`; fully anchored patterns must include that source. |
| `requires` | name or list | none | Editions the built runtime must have; otherwise `shot`/`clip` skip the script (not a failure). |
| `clip` | object | see below | Clip-mode pacing. |
| `cursor` | object, style name or bool | none | Script-level cursor defaults: motion style, timing, look, effects, screenshot overlay. See [cursor.md](cursor.md). |

Unknown top-level fields are errors in `validate` (typos are the commonest mistake).

Cursor values are validated at every script, clip, step-modifier and inline position: a boolean, a known
style name, or an options object using the keys in [cursor.md](cursor.md). Unknown keys are errors, including
inside `effects`, `trail` and `look`; style, timing, path, settle, heading and named easing values must be
supported. Easing also accepts four numeric Bézier coordinates or `cubic-bezier(x1,y1,x2,y2)` (including
overshooting y values). Nullable motion/look fallback options remain accepted, as do null effect overrides
that retain style defaults. Look shapes are `arrow`, `pointer`, `dot` or `ring`; a nonempty custom SVG `path`
overrides the shape and may supply a two-number `viewbox` and `hotspot`. Shot cursor keys `at`, `ripple`,
`squish` and `magnet` remain accepted alongside motion/look options. This validates configuration, not SVG
path rendering or changes to engine behavior.

## Steps

A step is a map with exactly one **op** key plus optional modifiers `id`, `presentation`, `only`, `at`, `cursor`, `meta`. Scenes require stable step IDs unique across the script:

```yaml
- click: { role: button, name: Sources }
  only: clip        # run only when recording a clip ("shot" = only for screenshots)
  at: 12.5          # clip: wait until clip time 12.5 s before running this step
  cursor: { ... }   # per-step cursor override for this step only (see cursor.md)
```

`meta` is a free-form object (for example `meta: {intent: "open the Agents page", lint_allow: [T03]}`). It is never an operation: it is ignored by the runner and copied verbatim into that step's timeline action record. Plugin-compiled steps (such as an Onyx `send`) pass it to every step they expand into.

A step with `cursor` and no op key (`- cursor: { style: spring_settle }`) means "change cursor settings from here on".
It may also have `only` and `at`: the mode filter and clip timestamp apply before the runner changes the settings for
all later steps (see [cursor.md](cursor.md)).

The older inline form inside an op's object is also accepted, for example
`- click: { selector: "#send", cursor: { style: spring_settle } }` or
`- shot: { name: here, cursor: { ripple: 0.35 } }`. It applies to that step only; if both inline and step-level
`cursor` are present, the step-level modifier wins. Inline cursor settings do not replace the op's required fields
(such as a locator base key or a shot name).


World references such as `{{people.sam.name}}` work in script strings, including typed text and locators. Script `content` is applied before references resolve. The [world specification](worlds-spec.md) defines merge, removal, `use` and reference rules.

`presentation` at scene or step scope overrides cursor settings and clip pacing for that scope, then restores broader settings. Session-wide frame/encoding settings cannot change mid-scene. An external `--render-overrides` file uses `presentation`, `scenes: {id: {...}}`, and `steps: {id: {...}}`; its values win over inline values at the matching scope. The narrower scope still wins.

Onyx adds `send: {text, reply: {text, queries, cites}}`, keeping a question and its exact prepared result together. An optional `reply.use` inherits reusable app content before explicit fields override it. Selection uses step identity, not a regex derived from the question. See [the complete example](examples/acme-incident.yaml). Other plugins are not required to implement `send`.
### Ops

| Op | Argument | Behaviour |
|---|---|---|
| `goto` | path starting `/` | Navigates to base URL + path (`domcontentloaded`, then settles 600 ms). In clips the load time is cut and the screen crossfades (`clip.nav_fade`). The first `goto` starts the recording. |
| `click` | locator (+ `fade`, `settle`) | Waits visible, scrolls into view, then sends a real mouse click to the centre of the first nonempty viewport-clipped client fragment. Wrapped inline links are not clicked in the gap of their union box. Wrappers/overlays above that point still receive the click; frame-relative fragment offsets retain main-frame pointer coordinates. Shot: instant `scrollIntoViewIfNeeded`; default settling is unchanged; `settle: 0` skips the automatic post-click network/loader wait so an immediate native transient state can be asserted and photographed. Clip: a target that is off screen (centre clipped by the viewport or a scrolling ancestor, or less than half visible) is first scrolled to the centre smoothly (700 ms wait) so the page never jumps under the cursor, then the cursor glides to that same fragment. The timeline action records `click_ms`, the video time of the mousedown. `fade: true` (clip) crossfades the resulting state change; `settle` = ms (default 500). |
| `hover` | locator | Hover and hold (500 ms; clip: `hold_ms`). |
| `move` | `[x, y]`, locator, or `{to, hold, cursor}` | Move the pointer without clicking (clip: glides). `to` is a point or locator; optional `hold` is the clip-only delay in ms after moving (e.g. `{to: [900, 300], hold: 400}`). Optional inline `cursor` overrides this step. Use to steer the cursor through empty margin. |
| `fill` | locator + `value` | Sets the value instantly. |
| `type` | locator + `value` (+ `delay`, `clip_delay`, `clip_ms`, `click`, `cursor_path`) | Keystrokes. Shot: `delay` ms/key (15). Clip: first clicks the field (cursor glide, hover, press, like `click`) unless the pointer already rests inside the field or the step sets `click: false`, then types the whole text in `length / clip.type_cps` seconds clamped to 700..3200 ms (override per step with `clip_ms`; `null` = per-key with `clip_delay`; `clip.type_cps: null` restores the fixed `clip.type_ms`). `cursor_path`: ordered waypoints (`[x, y]` or locators) the cursor moves through while this one step types the whole value (clip: glides with the step's cursor settings; shot: the pointer ends at the last waypoint). The step finishes when both typing and motion finish; either failure fails the step. Typing one prepared question in several `type` steps remains unsupported and can still be refused with 409 (see [cursor.md](cursor.md#moving-while-typing)). |
| `press` | key name | `Enter`, `Control+K`, ... then settles 200 ms. |
| `wait` | ms, or locator (+ `state`, `timeout`) | Number = sleep. Locator: waits for `state` (`attached`/`detached`/`visible`/`hidden`, default `visible`), `timeout` ms default 20000. |
| `wait_gone` | locator (+ `timeout`) | Waits until hidden. |
| `settle` | ms (default 600) | Network idle (8 s max) + no `aria-busy`/`.animate-pulse`, then ms. Clips cap it at `clip.settle_cap_ms`. |
| `eval` | JS string | `page.evaluate`. |
| `scroll` | pixels (down; negative up), `{by, at}`, or locator (+ `edge`) | Number: wheel scroll. Clip: the cursor first glides to the centre of the main content area (the largest scrollable element under the viewport centre, never the sidebar), then the wheel turns; shot: the pointer moves to 60% of the width. `{by: <px>, at: <locator>}`: the pointer anchors on `at` (clip: glides there, unless it already rests inside it; shot: moves there), then the wheel turns `by` px, so exactly what is under the pointer scrolls. Locator: scroll into view (smooth in clips). `edge: top`/`bottom`: instead move that element's own native scroller (the element itself, else its nearest scrollable ancestor, else its frame's document) to the edge, without moving the pointer. Locators may enter frames (`iframe[...] >> internal:control=enter-frame >> ...`). |
| `upload` | `{click: <locator>, files: [{name, text}\|{path, name?}]}` | Clicks the visible control that opens a native file chooser (same glide, press and settle as `click`), waits for the `filechooser` event, then sets the files. `text` files are in-memory UTF-8 buffers named `name`; `path` files are read relative to the script's folder (`name` defaults to the base name). The file type is taken from the extension (`.md`, `.csv`, `.txt`, `.json`, `.pdf`, `.docx`, `.xlsx`, `.pptx`, images; otherwise `application/octet-stream`). A headless capture never shows the OS dialog, so the click is followed directly by the file appearing. The click's `click_ms` is recorded. |
| `shot` | name, or `{name, hover, delay, full_page, clip, mouse, hold, cursor}` | Shot mode: PNG `NN-<name>.png` (parks the mouse at `mouse` or the bottom-right corner, optional `hover` locator, waits `delay` ms (300), captures; `full_page`, `clip: {x,y,width,height}` crop). Clip mode: a *beat*, the cursor glides to `hover` and holds `hold` ms (default `clip.hold_ms`). Optional inline `cursor` overrides this shot. Also checks the manifest's `crash_text`. |
| `pause` | ms | Clip-only pacing beat (no-op for screenshots). |
| `card` | string or `{title, subtitle, ms, keep}` | Clip-only full-screen title card. `keep: true` leaves it up so the next `goto` crossfades out of it. |
| `state` | `{overlays: [names], keep?: bool, ...state}` | Swaps the mock's fixture overlays mid-run (e.g. another persona or org; `[]` = base). Keeps in-run state (chats), the demo clock, locale and presentation theme by default. `keep: false` clears mutable state while retaining the script's compiled world/overlays and explicit theme unless `overlays` is explicitly supplied. Follow with `goto` so the page reloads with the new data. Same overlay switch as `./mockshop switch <p> <overlay...>` on a running instance. Plugins with an adapter also compile high-level keys: `world` (another world file), `viewer` (sign in as another person of the active world), and plugin screen selections. |
| `mark` / `keyframe` | name, or `{name, note}` | No browser action. Writes a labelled point on the clip timeline (see below). `keyframe` is an alias. |

### Locators

A bare string means visible text (substring). An object uses one base key (checked in this order):
`testid`, `role` (+ `name`, `exact`), `placeholder`, `label`, `selector` (CSS/Playwright), `text` (+ `exact`).
Modifiers: `has_text` (filter), `nth: N`, `last: true`, `any_visibility: true`. Everything except `selector` is filtered to
visible elements and the first match is used. Op-specific extra keys (`value`, `fade`, `state`, `timeout`, `cursor`, ...) live in the same object.

```yaml
- click: "More Agents"                          # visible text
- click: { testid: new-chat }
- click: { role: button, name: Sources }        # exact: true for exact name match
- type: { placeholder: "How can I help?", value: "hello" }
- click: { selector: "#send", nth: 0 }
- wait: { text: "Featured", state: visible, timeout: 30000 }
```

```yaml
# Glide over the page while one exact question types (one input, one send).
- type: { selector: "[contenteditable='true']", value: "What changed in the onboarding checklist?", cursor_path: [[900, 300], { testid: send-button }] }
# A Docs preview inside an iframe: start at the top of its scroller, then bring a heading into view.
- scroll: { selector: "iframe[src*='iframe-sdk'] >> internal:control=enter-frame >> desktop-text-area", edge: top }
- scroll: { selector: "iframe[src*='iframe-sdk'] >> internal:control=enter-frame >> text=Safety note" }
```

### Timing (`at:`) and the clip timeline

`at` is clip time from the first frame, with cuts removed (the same clock as `beat_times[].t_s`). Forms: `12.5` (seconds),
`"12.5s"`, `"1500ms"`, `"1:02.5"`. The runner sleeps until that time before running the step; if the clip is already past it
the step runs immediately and the timeline records `late_ms`. Ignored outside clips and before the first `goto`. Use it to land beats on
voiceover/music cues; keep surrounding steps shorter than the gap or the step will be late.

Every `./mockshop clip` writes next to the MP4 (`out/<plugin>/clips/`). A clip run never replaces existing outputs
(`<name>.mp4`, `.report.json`, `.resolved.json`, `.timeline.json`, `.vtt`) unless `--force` is given (`force: true` for
`runScript`/`runScripts`); every requested target is checked before any server, browser or recording starts. Two requested
scripts whose (world-resolved) names select the same output, including the same script requested twice, refuse the whole
batch even with `--force`; this also applies to `shot` output directories.
Case-only and Unicode-normalization-equivalent output names are also refused on every host for portable batches.

A recording writes everything (frames, failure stills and all five outputs) into a private `.<name>-XXXXXX/` directory
under `clips/`. Only a passing take is published: no failed step, and in strict mode no unexpected problem (the same rule
that fails the command). Publishing renames the complete set over the flat paths; the previous files are moved aside first
and restored if any rename fails. Each file is replaced atomically, but the set is not: a reader looking during publication
can see a mix. A failed take publishes nothing and leaves every previous output untouched, even with `--force`; the command
reports `clip not published` and keeps the take (report, resolved script, timeline, MP4 and `FAILED-step*.png`, frames
removed) in that `.<name>-XXXXXX/` directory for inspection; delete it when done. Its report's `mp4` names the kept file;
a published report names the final flat path. Frames are removed after each run (kept with `MOCKSHOP_KEEP_FRAMES=1`).
Interrupting a run with Ctrl-C removes its directory on a best-effort basis; SIGKILL, a crash or power loss can leave one
behind (with a previous set under `previous/` if it happened mid-publication), to be removed or restored by hand.

- `<name>.timeline.json`: `{script, plugin, clip, duration_ms, viewport, actions[], marks[]}`. Each action: `step`, `op`,
  `start_ms`, `end_ms`, `ok` (+ `error`), `selector` (compact form like `css:#x`, `role:button[Sources]`, `text:"..."`),
  `target_box {x,y,w,h}` (CSS px), `cursor {from, to}` (start/end position of the cursor), `at_ms`/`late_ms`, `meta` (the step's `meta`), `click_ms` (click and upload: video time of the mousedown), and op details (`url`, `name`, `chars`, `key`, `by` for scroll, `files` for upload, `mark`).
  `marks[]`: `{name, note?, kind: mark|keyframe, t_ms, step}`.
- `<name>.vtt`: WebVTT cues (one per action and mark) for captions or editors.

See [examples/mini-clip.timeline.json](examples/mini-clip.timeline.json).

### `clip:` options (all optional)

| Key | Default | Meaning |
|---|---|---|
| `viewport` | script viewport | e.g. `[1920, 1080]` |
| `title` | none | `"Text"` or `{title, subtitle}` card over the first page; `title_ms` 3200 |
| `type_ms` / `type_delay_ms` | 2500 / 55 | fixed typing time per `type` when `type_cps` is null (null = per-key) / ms per key |
| `type_cps` | 32 | typing speed in characters per second: a `type` takes `length / type_cps` s, clamped to 700..3200 ms (a step's `clip_ms` wins; null = fixed `type_ms`) |
| `nav_fade` / `fade_ms` | 450 / 450 | crossfade ms for navigations / `fade: true` clicks (0 = hard cut) |
| `move_ms`, `pre_click_ms`, `after_click_ms`, `after_type_ms` | unset (planner timing), 220, 600, 700 | `move_ms` forces a fixed glide time (back-compat), hover before click, beats after click / typing |
| `settle_cap_ms`, `idle_timeout_ms` | 300, 1500 | |
| `hold_ms`, `end_hold_ms` | 2200, 2500 | `shot` hold; hold on the last frame |
| `cursor` | true | back-compat: `false` hides the overlay; an object or style name is merged into the script `cursor:` block |
| `fps`, `crf`, `preset` | 30, 18, slow | encoding |

## Locale

`locale:` (script) or `--locale <code>` (CLI, on `shot`, `clip` and `live`) picks the UI language. Precedence: CLI flag, script
`locale:`, manifest `runner.locale`, a cookie in `cookies` named like `localization.cookie`, then `localization.default` (else `en-US`).
The plugin manifest's `localization` block lists `locales` (an unsupported code fails the run), `aliases`, `app_locales` (app-specific
identifiers), the selector `cookie`, and `user_fields` (`"GET /me": [preferences.language]`) that the mock rewrites to the chosen
language. The runner sets the browser locale and Accept-Language, adds the selector cookie, and sends the locale to the mock with the
state reset before the first navigation. `report.json` and clip reports record `locale`.

```yaml
locale: ar          # Onyx Arabic (RTL)
```
```
./mockshop shot onyx/cursor-demo --locale ja
```

## Reports

Shot mode: `out/<plugin>/<name>/report.json` (`shots`, `shot_times`, `problems`); a failed step saves `FAILED-stepN-<op>.png`
and the command exits 1. Clip mode: `<name>.report.json` with `beat_times` and `problems`.

## Validating

```
./mockshop validate path/to/x.yaml          # a file (plugin inferred from its location, else the default plugin)
./mockshop validate onyx/acme-incident      # plugin/script
./mockshop validate onyx --all              # plugin.yaml + every script (or `./mockshop validate --all`)
./mockshop validate plugins/onyx/plugin.yaml
```

Checks: JSON Schema (fields, types, exactly one op per step, `did you mean` hints), plus plugin-aware checks: `overlays` exist as fixture dirs,
`requires` names a real edition, duplicate shot names (warning), and each `goto` path matches a page route of the built web runtime
(Next.js `app-paths-manifest.json`; plugins without one get a "not checked" warning). It does not start a browser and cannot check locators:
run `./mockshop shot` for that. Exit code 1 if any file fails.

## Plugin manifest (`plugin.yaml`)

Manifest overview: [README plugin interface](../README.md#fixtures-and-plugin-interface); complete machine-readable fields: [plugin schema](../schema/plugin.schema.json). Fields used by scripts:

| Field | Effect on scripts |
|---|---|
| `ports.web`, `ports.mock` | Base URL `http://127.0.0.1:<web>`. `MOCKSHOP_PORT_OFFSET` (integer) shifts every port, so concurrent sessions can coexist. Env `MOCKSHOP_<PLUGIN>_WEB_PORT` / `_MOCK_PORT` override a single port absolutely (no offset). `MOCKSHOP_URL` overrides the base URL. |
| `runner.viewport/timezone/locale/demo_anchor/strict` | Defaults for the script fields of the same name. |
| `runner.known_errors` | Plugin-wide known errors, added to each script's `known_errors`. |
| `runner.cookies` | Cookies set for every script (this is how login is bypassed). |
| `runner.allow_hosts` | Outbound hosts allowed besides localhost (all else is aborted). |
| `runner.crash_text` | Texts that, if present at a `shot`, are reported as an app crash. |
| `runner.origins` | `captured-frontend` plugins: `{prefix, target: mock \| runtime:<dir>, spa}` request routing. |
| `edition`, `editions` | Names usable in `requires`; fixtures overlay per edition. |
| `mock.fixtures`, `mock.handlers` | Fixture dir (overlays live beside `base/`) and dynamic handlers. |

## Examples

Full scripts: `plugins/onyx/scripts/*.yaml`. Exported from a live session: [examples/live-session.yaml](examples/live-session.yaml).
Marks and `at`: [examples/mini-clip.yaml](examples/mini-clip.yaml).
