# Cursor

Headless Chrome has no visible pointer, so Mockshop draws one. Before each move, the cursor is planned
(`core/cursor.mjs` + the vendored planner in `core/vendor/cua-cursor-motion/`). Then:

- the **real mouse** (`page.mouse.move`) follows the planned samples in wall-clock time, so hover, focus and tooltip
  states fire on the way, as they would for a person;
- an **overlay** (a page-wide `<canvas>`, `pointer-events: none`) plays the same trajectory with its effects.

Path planning is deterministic for the same seed, scenario, targets and configuration. Browser layout and capture
timing can still vary; this does not promise byte-identical screenshots or recordings. Cursor control is part of
Mockshop's experimental v0.1.1 runner.

Demo: `plugins/onyx/scenarios/cursor-demo.yaml` (`./mockshop clip onyx/cursor-demo`, `./mockshop shot onyx/cursor-demo`).

## Where to configure it

Settings merge in this order (later wins):

1. built-in defaults (`CURSOR_DEFAULTS` in `core/cursor.mjs`)
2. manifest `runner.cursor:` (plugin.yaml, optional)
3. back-compat clip keys: `clip.cursor` (`false` = no overlay; object/string = merged), `clip.move_ms` (= `timing: fixed, ms: <move_ms>`), `clip.pre_click_ms`
4. scenario `cursor:`
5. a step whose only key is `cursor:`, which changes the settings from that step on
6. a per-step `cursor:` **step modifier**, written beside the op key like `only:` and `at:`. It works on `click`,
   `hover`, `move` and `shot` (for a shot it also takes the still keys below). It applies to that step only, and a
   look change reverts after the step. A still-fading click ripple keeps the effect colour, fill and scale it had
   on mouse-down; restoring the cursor body does not restyle that pulse. The older inline form, `cursor:` inside
   the op's object (`click: {selector: x, cursor: {...}}`), still works. If a step has both, the step-level one wins.

Anywhere a `cursor:` value is accepted, it can be an object, a style name (`cursor: comet_swoop`) or `true`/`false`
(enabled).

Clips install the overlay even when initially disabled, keeping it hidden until a cursor-only step enables it.
The current look, position and visibility survive same-origin document navigation. Disabling the overlay does
not stop real mouse movement or change the clip's pauses.

```yaml
cursor: false
steps:
  - goto: /app
  - move: [260, 170]                          # real mouse moves; overlay stays hidden
  - cursor: true                            # visible from here on
  - hover: { selector: "#onyx-chat-input-textbox" }
  - cursor: false
  - goto: /app                               # still hidden after navigation
  - cursor: true
```

```yaml
cursor:
  style: comet_swoop
  speed: 1.2
  look: { shape: pointer, fill: "#2563eb", rotate: true }
steps:
  - goto: /app
  - click: { text: "New Session" }
    cursor: { style: spring_settle }           # step modifier: this step only
  - move: { to: [900, 300], hold: 400 }
    cursor: { ease: "cubic-bezier(.3,1.4,.5,1)", timing: fixed, ms: 600 }
  - cursor: { effects: { trail: true } }       # cursor-only step: from here on
  - shot: here
    cursor: { ripple: 0.35 }
```

## Motion options

| key | values | default | meaning |
|---|---|---|---|
| `enabled` | bool | `true` | Clips: draw the overlay. The real mouse moves either way. |
| `screenshots` | bool | `false` | Screenshots: draw the overlay in every still. When off, nothing is injected, so existing shots are unchanged. |
| `style` | `signature_arc` `spring_settle` `magnetic` `comet_swoop` `adaptive` `classic` `straight` `arc` `bow` `custom` | `signature_arc` | Motion style (see below). |
| `timing` | `native` `fitts` `fixed` `distance` | `native` | `native`: the style's own timing. `fitts`: `150 + 120·log2(D/W+1)` ms, 300..1000. `fixed`: `ms`. `distance`: `base_ms + ms_per_px·D`, clamped to `min_ms..max_ms` (defaults 350, 0.35, 250, 1200). |
| `ms` | ms | 1430 | Move time for `timing: fixed`. |
| `speed` | number | `1` | Multiplier: 2 = twice as fast, 0.5 = half speed. Applies to every style. |
| `ease` | `linear` `min_jerk` `smootherstep` `in_out_cubic` `in_out_sine` `out_cubic`, `[x1,y1,x2,y2]` or `"cubic-bezier(x1,y1,x2,y2)"` | style's | Speed curve along the path. y outside 0..1 overshoots. |
| `path` | `straight` `arc` `bow` | style's | Path shape. |
| `arc_size` | 0..1 | 0.25 | Arc scale (0.25 keeps each style's own arc, 0 is straight; negative flips the side). |
| `arc_flow` | -1..1 | 0 | Where the arc peaks: -1 near the start, +1 near the target. |
| `start_handle`, `end_handle` | 0..1 | 0.3 | Bézier control-point distance from each end (fraction of the chord). |
| `bow` | number | 0.06 | Bend of `path: bow`, as a fraction of the distance. |
| `settle` | `none` `follow_through` `spring` | style's | End behaviour: none; overshoot and return; damped wobble. |
| `overshoot` | fraction | 0.018 / 0.05 | Overshoot as a fraction of the distance (follow_through / spring). |
| `overshoot_px` | px | 8 / 6 | Overshoot cap in px. |
| `cycles`, `decay` | number | 1.3, 2.6 | Spring wobble cycles and decay. |
| `spring` | 0.3..1 | 0.72 | `classic` arrival damping (1 = critical, 0.3 = bouncy). |
| `peak_speed`, `min_start_speed`, `min_end_speed` | px/s | 900, 300, 200 | `classic` speed profile. |
| `turn_radius` | px | 80 | `classic` Dubins turning radius. |
| `heading` | `tangent` `fixed` | `tangent` (magnetic: fixed) | With `look.rotate`, the arrow leans into the motion (`tangent`) or keeps its rest pose (`fixed`). |
| `seed` | string | scenario name | Determinism seed. Each move uses `seed|scenario|n`; only `adaptive` draws random numbers. |
| `reduced_motion` | bool | `false` | Short, straight 120 ms glide with no effects. |
| `effects` | `{trail, glow, magnet, ripple, squish}` bools | style's | Turn effects on or off; unset keeps the style's default. |
| `trail` | `{secs, fade_len, steps, tail_width, head_width, alpha}` | `0.18, 60, 26, 2, 12, 0.38` | Comet trail geometry. |
| `glow` | number | `1` | Strength of the speed glow. |
| `pre_click_ms` | ms | `clip.pre_click_ms` (220) | Hover before a click (clips). |

### Styles

The first six are the Cua Driver styles, with their default effects:

- `signature_arc`: arc, min-jerk, small follow-through overshoot, Fitts × 1.1. Effects: glow, ripple, squish.
- `spring_settle`: gentle arc that arrives early, then a damped spring wobble. Effects: glow, squish.
- `magnetic`: accelerates, then is pulled onto the target and locks on; the arrow keeps its pose. Effects: magnet highlight, ripple.
- `comet_swoop`: big arc, in-out cubic. Effects: trail, ripple.
- `adaptive`: picks precise-click for small targets (< 16 px), keynote swoop for long moves (> 900 px), and Fitts/min-jerk otherwise. Effects: squish.
- `classic`: Dubins arc–straight–arc path at a set speed, then a spring overshoot. No effects.

The remaining styles are Mockshop additions, built as custom specs on top of `signature_arc`:

- `straight` (straight path, no settle), `arc` (= signature arc), `bow` (gentle quadratic bend), `custom` (signature_arc
  plus whatever `path`/`ease`/`settle`/`timing` you give).

Setting `ease`, `path`, `settle`, `bow`, `overshoot*` or `timing: distance` on `signature_arc`, `spring_settle` or
`comet_swoop` turns the move into a custom spec built from that style. `magnetic`, `adaptive` and `classic` are
simulations: they take `timing` (`native`/`fitts`/`fixed`), `speed`, `effects` and the classic knobs, and ignore
ease/path/settle.

## Look (`cursor.look`)

| key | default | meaning |
|---|---|---|
| `shape` | `arrow` | `arrow` (classic OS-style pointer), `pointer` (sleek arrowhead), `dot`, `ring`. All are Mockshop's own drawings. |
| `path`, `viewbox`, `hotspot` | | Custom SVG path in a `[w, h]` viewbox, with the hotspot `[x, y]` in viewbox units. Overrides `shape`. |
| `size` | 30 (dot 22, ring 28) | On-screen height in px. |
| `fill` | `#111111` (ring: `none`) | Body colour. |
| `stroke`, `stroke_width` | `#ffffff`, 1.6 (ring: effect colour, 2.5) | Outline. |
| `shadow` | `true` | Drop shadow. Tune it with `shadow_color`, `shadow_blur` (4) and `shadow_y` (1.5). |
| `effect_color` | `#3b82f6` | Colour of the ripple, trail, glow, magnet and halo. |
| `opacity` | 1 | Body opacity. |
| `rotate` | `false` | Lean the arrow into the motion (follows `heading`). Always off for dot and ring. |
| `halo` | `false` | Soft glow around the body (Cua's layered glow strokes). |
| `float` | `false` | Cua's gentle idle float (the cursor drifts slowly). Keeps the screencast busy, so leave it off for small clips. |
| `ripple_fill` | `true` | Fill the ripple disc as well as stroking it. |
| `ripple_scale` | 1 | Ripple size multiplier. |

## Effects

All effects follow the `@trycua/cursor-motion` geometry:

- **trail**: a comet tail along the last 0.18 s of the path.
- **glow**: a radial glow that grows with speed.
- **magnet**: a rounded highlight around the target rect for 0.7 s after a `magnetic` lock-on.
- **ripple**: a 0.52 s expanding ring on mouse-down.
- **squish**: the cursor presses in for about 50 ms on a click, then rebounds.

In clips, the ripple and squish fire on every real `mousedown`. They use the effects of the last planned move.
The ripple snapshots that click's look and fades for the same 0.52 s even when the cursor body is restyled.
Frozen screenshot ripples instead use the current shot look.

## Screenshots

Stills are unchanged unless you opt in:

- `cursor.screenshots: true` draws the cursor in every shot. It sits at the last click, hover or move point, or at the
  shot's `hover` target.
- A `shot` with its own `cursor:` object shows the cursor in that shot even when `screenshots` is off. `cursor: false`
  hides it.

```yaml
- shot: click-here
  cursor: { at: { text: "Save" }, ripple: 0.35, squish: true }
- shot: target
  cursor: { at: [640, 400], magnet: true, look: { shape: dot, fill: "#ef4444" } }
```

Keys of a shot's `cursor:` object:
- `at`: a locator or `[x, y]`.
- `ripple`: `true`, or 0..1 for how far the frozen ripple has expanded (`true` = 0.3).
- `squish`: `true`, or 0..1.
- `magnet`: `true` (the `at`/hover element's rect) or `[x, y, w, h]`.
- `look`: a look override for this shot only.

Moves are instant in screenshot mode; only clips animate.

## Page API (for `eval` steps)

The overlay exposes these functions on `window`:
- `__msCursor(x, y)`
- `__msClick(x, y, {ripple, squish})`
- `__msStill({at, ripple, squish, magnet})`, or `__msStill(null)` to clear it
- `__msCursorHide(bool)`
- `__msCursorLook(look)`, which takes a resolved look
- `__msPlay(trajectory)`

## Vendored code and licensing

`core/vendor/cua-cursor-motion/` is a port of `@trycua/cursor-motion`. Source: <https://github.com/trycua/cua>,
`libs/typescript/cursor-motion/src`, commit `5e638b2113f7105b93e0cccf4477e4080995f717`. License: MIT, Copyright (c)
2025 Cua AI, Inc. The original LICENSE is kept next to the code, and the port is listed in `NOTICE`.

- `motion.mjs`: geom, rng, ease, path, dubins, style, params, spec and plan, plus the effect constants. This is a
  hand port from TypeScript to JavaScript with the types stripped and the logic unchanged.
- `overlay.mjs`: the in-page player, ported from `Trajectory.sampleAt`/`velocityAt`, the effects geometry and
  render.ts painting. Mockshop changed it to use pluggable shapes and colours, a page-wide canvas, and frozen
  screenshot effects.
- **Not ported:** the Cua cursor artwork (`CURSOR_PATH` in render.ts, from Cua Driver's cursor-overlay theme). Its
  licence was not verified separately, so Mockshop draws its own shapes (`SHAPES` in `core/cursor.mjs`).
- Also not ported: `MotionPlayer` (Mockshop has its own player), `driver.ts` (Cua Driver config snippets) and the
  playground.

Mockshop's own code remains Copyright (c) 2026 Ryan Weddle, MIT.
