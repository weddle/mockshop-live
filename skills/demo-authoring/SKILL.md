---
name: demo-authoring
description: "Use only to create or edit Mockshop demo worlds, YAML walkthrough scripts, or presentation profiles, or to run those scripts with a Mockshop application plugin. Do not use for general demo planning, fiction/worldbuilding, ordinary Onyx usage, or unrelated plugin development."
---

# Demo authoring

For designers and coding agents working with **Mockshop**. Activate for an explicit Mockshop authoring/rendering request or supplied Mockshop artifacts—not merely mentions of demos, worlds, scripts, cursors, plugins or Onyx. This file is the workflow; selectively loaded guides hold task detail; the specifications remain the contract. A repo-local file is not automatically loaded; installed-skill discovery depends on the host.

## 1. Choose the job, then load only its guide

| Job | Guide |
|---|---|
| Select, configure or run a Mockshop application plugin | [plugins](references/plugins.md) |
| New reusable world, cast, content pack or shared evidence | [worlds](references/worlds.md) |
| New story, manual screens, exact replies, or a targeted content edit | [scripts](references/scripts.md) |
| Profiles, scoped cursor/pacing, restyling a finished demo | [presentation](references/presentation.md) |

Combine guides when the job spans them (a new world usually comes with a script). Do not read guides you do not need. Core specifications: [worlds and overrides](../../docs/worlds-spec.md), [script specification](../../docs/script-spec.md), [generation from a prompt](../../docs/generate-world.md), [validation and live control](../../docs/agent-guide.md).

## Select the application plugin

Use the [plugin guide](references/plugins.md) to discover/select a plugin, locate its operating docs, understand supported world mappings and invoke the assigned stages. Application behavior belongs to that plugin's contract; Onyx is one example, not a requirement.

Links to `docs/`, `plugins/` and `profiles/` assume this repository layout. If installed separately, locate the user's Mockshop checkout and resolve those references there; do not assume the installed skill bundles application docs or runtimes. External plugin docs live at that plugin's discovered location.

New worlds, casts, content, scripts and profiles are legitimate outputs. Reuse is optional: reuse a world when the story belongs in it, do not clone one to change one exchange.

## 2. Define the demo before writing YAML

Audience, the one point the demo makes, features/screens involved, the visible outcome the viewer should remember, target duration. Administrative or inventory screens still need a user-facing outcome (a finding, a decision, a fixed problem), not just a tour.

## 3. Ownership in one line each

- **World:** reusable background and evidence more than one script relies on.
- **Script `content`:** additions/overrides only this story needs.
- **Profile / `presentation`:** cursor, pacing, styling. Never in a world or content.

## 4. Review once

- References resolve to the intended entities; no leftover literal where a reference was meant.
- Question, reply, citations, source bodies and saved history agree.
- Each script contains the evidence it claims; nothing depends on another script's local content.
- Every shown control is supported by the plugin's operating references; simulations are not presented as real services.

## 5. Verify to the assigned level, and say which

| Level | Meaning |
|---|---|
| Authored | Files written and reviewed; nothing run |
| Compile-valid | `./mockshop validate` passed: schemas, references, compilation, available route checks |
| Render-verified | Ran on the matching built edition; images/reports (and clip playback, for clips) inspected |

Validation does not prove locators, readability or timing. Script-only deliverables need no screenshots or videos unless requested; when rendering is requested, one focused render per demo is enough — do not expand a test matrix.

## 6. Hand off

Changed paths, verification level per demo, and every remaining uncertainty stated explicitly — assumed selector/label text, initial expand/collapse state, model or agent visibility, intentionally empty sources. Never imply render certification you did not perform.
