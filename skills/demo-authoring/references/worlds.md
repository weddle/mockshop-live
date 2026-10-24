# Worlds: reusable background, cast and evidence

Contract: [worlds and overrides](../../../docs/worlds-spec.md) (composition, references, `use`). Prompt-driven generation: [generate a world or script](../../../docs/generate-world.md). For native mappings and seed DTOs, read the selected plugin's schema and operating references; Onyx's [playbook](../../../plugins/onyx/PLAYBOOK.md) and [backend/API map](../../../plugins/onyx/API-MAP.md) apply only to Onyx.

## What goes in a world

Use the shared optional company, people, teams, sources, documents and conversations that fit the background. Put other reusable facts, such as products and locations, in `vars`; application-specific content belongs in `apps.<plugin>`. A plugin need not implement every shared entity. Keep unsupported background data reusable, but explicitly requested unsupported behavior must be reported, not silently substituted.

## Evidence ownership

Each script resolves its own world plus local `content`; another script's additions do not carry over. If several scripts claim the same evidence or inventory, put it in the world or supply it explicitly in each script. For example, an Onyx source populated only by script A's local documents may have no documents in script B. Ensure the visible inventory matches the story; intentionally empty content is valid when explained.

## Make recurring identities referable

- Define company, product, location, domain, email domain and people once; refer to them with `{{path}}` everywhere they recur — source and document titles, document bodies, app metadata, and the scripts' cards, queries and replies.
- Define reusable structured defaults once so scripts can `use` them; exact reply defaults are one Onyx-specific application of this mechanism, not a required world component.
- Native IDs, routes or model labels that must be explicit: define once, reference where the syntax allows.
- Intentional literals are fine. Do not rewrite ordinary prose into references for its own sake; references matter where reuse or renaming is intended.

## Editing an existing world

A world edit changes every script that uses it. Edit the world only when that is the intended scope; otherwise override in the script's `content` (see [scripts](scripts.md)).
