# Script lint

`./mockshop lint` keeps world-driven scripts free of data. A world-driven script has no `world:` line, so the same file runs unchanged against any world (`--world <file>` or `MOCKSHOP_WORLD`). It may navigate, click, type, wait, take screenshots and assert, on screen or with `assert_state` / `snapshot_state`. Names, emails, IDs, routes and response bodies come from the world through `{{refs}}` such as `{{agents.helper.name}}` or `{{documents.plan.id}}`.

```sh
./mockshop lint                      # every world-driven script (no world: line)
./mockshop lint path/to/script.yaml  # specific files
./mockshop lint --all                # every shipped script, including world-specific examples (informational)
./mockshop lint --json report.json   # also write a JSON summary (--json - prints only the JSON)
./mockshop lint --quiet              # summary line only
```

Findings print as `file:line: <rule> <name>: <message>`, followed by one summary line. Exit codes: 0 clean, 1 findings, 2 no scripts or a missing file. Full-line YAML comments are ignored, and so is text inside `{{…}}`.

## Rules

| Rule | Name | Flags | Instead |
|---|---|---|---|
| S0 | bad-pragma | a `lint-allow` pragma for a rule other than S1, without a reason, or with nothing to allow | fix or remove the pragma |
| S1 | literal-entity | a world entity's name or title written out literally | `{{people.x.name}}`, `{{documents.x.title}}`, … |
| S2 | literal-email | a literal email address | `{{people.x.email}}` |
| S3 | fixture-id | a numeric fixture ID in a selector, API path or ID list (`agent-row-actions-12`, `/persona/12`, `[11, 12, 13]`) | `{{agents.x.id}}` |
| S4 | api-fetch | an `eval` step that reads the backend through `/api` | `assert_state` / `snapshot_state` |
| S5 | web-storage | `sessionStorage` / `localStorage` used to seed or pass state between steps | world state or `snapshot_state` |
| S6 | mockshop-route | a `/mockshop/*` switch route | a world state flag |
| S7 | inline-data | response bodies or entity data under `content:` (only `includes:` is allowed) | move the data into a world |
| S8 | version-label | a literal `vX.Y.Z` | derive the label from the plugin pin (`{{plugin.ref}}` in fixtures) |

Entity names for S1 come from the shared worlds (`worlds/` and `reference-examples/worlds/`): display names and titles of people, teams, sources, documents, conversations, and of each app's agents, replies and LLM providers.

## Allowlist

When UI copy happens to equal an entity name, add a pragma on the same line with a reason of at least 10 characters:

```yaml
  - wait: { text: Planning Notes Draft }  # lint-allow S1: fixed heading copy in the product UI
```

Inside `eval` JavaScript, use `// lint-allow S1: <reason>`. Only S1 can be allowlisted. Every use is counted in the summary.
