# Vendored: @trycua/cursor-motion (ported)

- Upstream: https://github.com/trycua/cua, `libs/typescript/cursor-motion/src`
- Commit: `5e638b2113f7105b93e0cccf4477e4080995f717`
- License: MIT, Copyright (c) 2025 Cua AI, Inc. (see `LICENSE`, copied unchanged)

Files:
- `motion.mjs`: geom.ts, rng.ts, ease.ts, path.ts, dubins.ts, style.ts, params.ts, spec.ts and plan.ts, plus the
  constants from effects.ts. These are hand-ported from TypeScript to JavaScript; the types are stripped and the
  logic is unchanged.
- `overlay.mjs`: the in-page player, ported from the effects.ts geometry, the render.ts painting and
  Trajectory.sampleAt/velocityAt. Mockshop's changes are listed in its header comment.

Not included: the Cua cursor artwork (render.ts `CURSOR_PATH`), `MotionPlayer`, driver.ts, the playground and the
tests. Mockshop's own shapes live in `core/cursor.mjs`.
