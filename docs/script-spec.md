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
| `scale` | number | 1 | deviceScaleFactor (2 = retina). |
| `theme` | `light`/`dark` | light | `prefers-color-scheme`. |
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

A step is a map with exactly one **op** key plus optional modifiers `id`, `presentation`, `only`, `at`, `cursor`. Scenes require stable step IDs unique across the script:

```yaml
- click: { role: button, name: Sources }
  only: clip        # run only when recording a clip ("shot" = only for screenshots)
  at: 12.5          # clip: wait until clip time 12.5 s before running this step
  cursor: { ... }   # per-step cursor override for this step only (see cursor.md)
```

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

Onyx adds `send: {text, reply: {text, queries, cites}}`, keeping a question and its exact prepared result together. An optional `reply.use` inherits reusable app content before explicit fields override it. Selection uses step identity, not a regex derived from the question. See [the complete example](examples/omzo-incident.yaml). Other plugins are not required to implement `send`.
### Ops

| Op | Argument | Behaviour |
|---|---|---|
| `goto` | path starting `/` | Navigates to base URL + path (`domcontentloaded`, then settles 600 ms). In clips the load time is cut and the screen crossfades (`clip.nav_fade`). The first `goto` starts the recording. |
| `click` | locator (+ `fade`, `settle`) | Waits visible, scrolls into view, then sends a real mouse click to the centre of the first nonempty viewport-clipped client fragment. Wrapped inline links are not clicked in the gap of their union box. Wrappers/overlays above that point still receive the click; frame-relative fragment offsets retain main-frame pointer coordinates. Shot: default settling is unchanged; `settle: 0` skips the automatic post-click network/loader wait so an immediate native transient state can be asserted and photographed. Clip: cursor glides to that same fragment first. `fade: true` (clip) crossfades the resulting state change; `settle` = ms (default 500). |
| `hover` | locator | Hover and hold (500 ms; clip: `hold_ms`). |
| `move` | `[x, y]`, locator, or `{to, hold, cursor}` | Move the pointer without clicking (clip: glides). `to` is a point or locator; optional `hold` is the clip-only delay in ms after moving (e.g. `{to: [900, 300], hold: 400}`). Optional inline `cursor` overrides this step. Use to steer the cursor through empty margin. |
| `fill` | locator + `value` | Sets the value instantly. |
| `type` | locator + `value` (+ `delay`, `clip_delay`, `clip_ms`) | Keystrokes. Shot: `delay` ms/key (15). Clip: whole text typed in `clip.type_ms` (override per step with `clip_ms`; `null` = per-key with `clip_delay`). |
| `press` | key name | `Enter`, `Control+K`, ... then settles 200 ms. |
| `wait` | ms, or locator (+ `state`, `timeout`) | Number = sleep. Locator: waits for `state` (`attached`/`detached`/`visible`/`hidden`, default `visible`), `timeout` ms default 20000. |
| `wait_gone` | locator (+ `timeout`) | Waits until hidden. |
| `settle` | ms (default 600) | Network idle (8 s max) + no `aria-busy`/`.animate-pulse`, then ms. Clips cap it at `clip.settle_cap_ms`. |
| `eval` | JS string | `page.evaluate`. |
| `scroll` | pixels (down; negative up) or locator | Number: wheel scroll; locator: scroll into view (smooth in clips). |
| `shot` | name, or `{name, hover, delay, full_page, clip, mouse, hold, cursor}` | Shot mode: PNG `NN-<name>.png` (parks the mouse at `mouse` or the bottom-right corner, optional `hover` locator, waits `delay` ms (300), captures; `full_page`, `clip: {x,y,width,height}` crop). Clip mode: a *beat*, the cursor glides to `hover` and holds `hold` ms (default `clip.hold_ms`). Optional inline `cursor` overrides this shot. Also checks the manifest's `crash_text`. |
| `pause` | ms | Clip-only pacing beat (no-op for screenshots). |
| `card` | string or `{title, subtitle, ms, keep}` | Clip-only full-screen title card. `keep: true` leaves it up so the next `goto` crossfades out of it. |
| `state` | `{overlays: [names], keep?: bool, ...state}` | Swaps the mock's fixture overlays mid-run (e.g. another persona or org; `[]` = base). Keeps in-run state (chats), the demo clock and locale by default. `keep: false` clears mutable state while retaining the script's compiled world/overlays unless `overlays` is explicitly supplied. Follow with `goto` so the page reloads with the new data. Same overlay switch as `./mockshop switch <p> <overlay...>` on a running instance. |
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

### Timing (`at:`) and the clip timeline

`at` is clip time from the first frame, with cuts removed (the same clock as `beat_times[].t_s`). Forms: `12.5` (seconds),
`"12.5s"`, `"1500ms"`, `"1:02.5"`. The runner sleeps until that time before running the step; if the clip is already past it
the step runs immediately and the timeline records `late_ms`. Ignored outside clips and before the first `goto`. Use it to land beats on
voiceover/music cues; keep surrounding steps shorter than the gap or the step will be late.

Every `./mockshop clip` writes next to the MP4 (`out/<plugin>/clips/`):

- `<name>.timeline.json`: `{script, plugin, clip, duration_ms, viewport, actions[], marks[]}`. Each action: `step`, `op`,
  `start_ms`, `end_ms`, `ok` (+ `error`), `selector` (compact form like `css:#x`, `role:button[Sources]`, `text:"..."`),
  `target_box {x,y,w,h}` (CSS px), `cursor {from, to}` (start/end position of the cursor), `at_ms`/`late_ms`, and op details (`url`, `name`, `chars`, `key`, `mark`).
  `marks[]`: `{name, note?, kind: mark|keyframe, t_ms, step}`.
- `<name>.vtt`: WebVTT cues (one per action and mark) for captions or editors.

See [examples/mini-clip.timeline.json](examples/mini-clip.timeline.json).

### `clip:` options (all optional)

| Key | Default | Meaning |
|---|---|---|
| `viewport` | script viewport | e.g. `[1920, 1080]` |
| `title` | none | `"Text"` or `{title, subtitle}` card over the first page; `title_ms` 3200 |
| `type_ms` / `type_delay_ms` | 2500 / 55 | total typing time per `type` (null = per-key) / ms per key |
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
./mockshop validate onyx/omzo-incident      # plugin/script
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
| `ports.web`, `ports.mock` | Base URL `http://127.0.0.1:<web>`. Env `MOCKSHOP_<PLUGIN>_WEB_PORT` / `_MOCK_PORT` override. `MOCKSHOP_URL` overrides the base URL. |
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
