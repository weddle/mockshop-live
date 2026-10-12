# Scripts: stories, screens and authored outcomes

Contract: [script specification](../../../docs/script-spec.md) (steps, locators, timing, validation) and [worlds and overrides §4](../../../docs/worlds-spec.md#4-scripts-make-the-actual-script-easy-to-see). Read the selected plugin's operating references for its controls, seed prerequisites and supported operations. For Onyx only, use its [playbook](../../../plugins/onyx/PLAYBOOK.md) and relevant feature guides. Live probing: [live control](../../../docs/agent-guide.md).

## New story

- Pick the world the story belongs in, or create one ([worlds](worlds.md)).
- Put story-only additions under script `content`; keep shared evidence in the world.
- Ordered scenes with stable IDs; every step has a stable, script-unique ID and one instruction.
- Drive native controls and wait for the result a step produces, not an element that appears early.

## Authored outcomes and plugin conveniences

Keep each action and its intended result easy to edit together. Use high-level operations only when the selected plugin documents them; otherwise manually direct the native screens with ordinary steps. Do not assume the application has a chat or an exact-response mechanism.

**Onyx example:** keep the question, queries, citations and reply together in one `send` step. Use `reply.use` for reusable reply defaults, overriding only what changes. Replies, citations and cited source bodies must agree. Other plugins may represent outcomes differently.

## Manual screens and state

Lower-level `goto`/`click`/`type`/`wait`/`shot` steps remain available. Prefer keyed selections or aliases when the plugin supports them; do not invent `state` fields for unsupported controls. Use the locators and state/cache behavior documented by that plugin; record assumptions not checked in a render.

## Literals in scripts

Titles, cards, queries and replies that mention recurring company/product/location/domain names should use `{{path}}` references so renames propagate. Intentional one-off literals are fine.

## Targeted edit

Change only what was asked: one exchange/action and outcome, one scene, or one `content` override. For Onyx, a question/result change usually means editing one `send`. Override in script `content` rather than editing the world unless all scripts should change. Do not rename IDs other scripts or render-override files target.
