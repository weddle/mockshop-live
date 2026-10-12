# Presentation: profiles, scoped direction, restyling

Contract: [worlds and overrides §5](../../../docs/worlds-spec.md#5-presentation-defaults-plus-natural-scopes). Cursor options: [cursor](../../../docs/cursor.md). Clip timing and `at:`: [script specification](../../../docs/script-spec.md#timing-at-and-the-clip-timeline). Existing profiles: [`profiles/`](../../../profiles/).

## Where it goes

- **Profile:** default cursor/clip/viewport/scale/theme for a demo. A script selects one; `--profile` replaces it.
- **Script/scene/step `presentation`:** scoped changes to cursor and pacing; they revert at scope end. Not viewport, FPS, scale or theme below script level.
- **`--render-overrides file.yaml`:** restyle a finished demo by stable script/scene/step IDs without editing the script.
- Never put presentation in a world or in `content`.

## Restyling a finished demo

Prefer a different profile or a render-override file over editing the story. Target scenes/steps by their stable IDs; find an ID from a timestamp via the render timeline. A script-wide override does not unhide a deliberately hidden scene — target that scene explicitly.

## Direction

Explicit pauses, cursor moves and cards are legitimate. Aim for a meaningful end state and readable pacing. Stills cannot establish cursor motion or video readability; only an inspected clip can.
