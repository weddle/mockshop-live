# Generate a world or script from a prompt

Generated content is ordinary editable YAML/Markdown. It uses the same schemas, validation, compilation and rendering as hand-written content. Rendering does not call an LLM. A world never executes code.

Read [the architecture and authoring contract](worlds-spec.md), `schema/world.schema.json`, `schema/script.schema.json`, and the target plugin's adapter documentation. Start with the complete [Omzo world](../worlds/omzo/world.yaml), [incident script](examples/omzo-incident.yaml), and [second script](examples/omzo-followup.yaml) that adds new content without duplicating the world.

## Inputs to give the assistant

- **Task:** create a new reusable world, or create/edit a script using an existing world.
- **Company and cast:** fictional company, recurring people, teams, and any names to preserve.
- **Application:** target plugin and required frontend edition.
- **Story:** background, documents, chats, facts, and intended audience.
- **Demo:** ordered user-facing features, desired questions/results, length and manual screen requirements.
- **Existing files:** world, script, relevant plugin schema/docs, and any presentation profile.
- **Scope:** edits that apply everywhere versus only this script or one exchange.

If an existing world is supplied, treat it as read-only unless the user explicitly requests a shared change. Put new story content under script `content`. Never clone the cast to make a new incident.

## Generation instruction

```text
Produce editable Mockshop YAML and, if useful, Markdown document bodies.
Use the supplied world and script schemas and the target plugin's contract.

1. Use stable map keys for reusable people, teams, sources, documents and
   conversations. Display-name changes must not change those keys.
2. Use {{people.<key>.name}}, {{company.name}}, and other path references
   for recurring identities. Preserve literal prose when no reuse is intended.
3. Use only shared world fields for genuinely reusable data. Put plugin-specific
   configuration in apps.<plugin>. Do not invent core entity types or plugin ops.
4. When using an existing world, reference its path. Add only new or changed
   data under script content. Keep unrelated scripts and shared data intact.
5. Write an explicit ordered scene list with stable scene and step IDs. Keep
   each question beside its exact prepared reply, queries and citations.
6. Use existing navigation/click/type/wait instructions for manual control.
   Unsupported requested features must be reported, not silently substituted.
7. Keep cursor/render settings out of the world. Select a profile in the
   script; use presentation on a script, scene or step only when requested.
8. Use reserved fictional domains for fabricated endpoints. Do not include
   real credentials, customer content, or fetched application data.
9. Use paths relative to the declaring file. Only explicitly included local
   files are composed. No generators, executable world code, or remote imports.
10. Return the concrete files and a short list of assumptions. Do not claim
    validation or rendering succeeded unless those commands actually ran.
```

## Validate and inspect

```bash
./mockshop validate docs/examples/omzo-incident.yaml
./mockshop shot docs/examples/omzo-incident.yaml
./mockshop clip docs/examples/omzo-incident.yaml
```

Inspect the screenshots/video and report, not just the exit status. The renderer can prove selectors and app behavior; schema validation alone cannot prove visual layout, narrative correctness, or factual consistency.

For a correction to an existing video, identify the step in that video's timeline:

```bash
./mockshop explain out/onyx/clips/omzo-incident-example.timeline.json --at 0:05
```

Then edit the identified step for local question/result changes, script `content` for script-wide entity changes, or the world for intentionally shared changes. Restyle with `--profile path/to/profile.yaml`; target a scene/step through `--render-overrides path/to/overrides.yaml`.

## Scripted content production

For large corpora or computed content, a trusted author can explicitly run a normal script that writes schema-valid YAML/JSON. The script is an authoring tool, not a world plugin or something the renderer executes. Keep its outputs deterministic when reproducibility matters. The same validation/render commands apply to its output.
