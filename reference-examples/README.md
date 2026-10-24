# Reference examples

The historical Onyx collection: 227 YAML scripts, with their worlds, content fragments, snapshots and presentation profiles. These are reference material, not the default demo catalog or a claim of complete runtime coverage.

The original relative directory structure is preserved so the examples remain self-contained:

- `plugins/onyx/scripts/`: historical scripts, including underscore-prefixed probes.
- `worlds/`: their fictional companies, content and specialized Onyx seeds.
- `profiles/`: their presentation defaults.

They are excluded from normal plugin discovery and `./mockshop shot onyx --all`. Run an individual example explicitly from the repository root:

```sh
./mockshop --plugin onyx validate reference-examples/plugins/onyx/scripts/user-ask-with-citations.yaml
./mockshop --plugin onyx shot reference-examples/plugins/onyx/scripts/user-ask-with-citations.yaml
```

Historical scripts have been migrated to the world/script contract, but not all have been browser-revalidated. Edition requirements and simulation limits still apply.

For new demos, start with the small maintained examples in [`plugins/onyx/scripts`](../plugins/onyx/scripts/), the [authoring specification](../docs/worlds-spec.md), and the [Onyx playbook](../plugins/onyx/PLAYBOOK.md). The [coverage ledger](../plugins/onyx/docs/script-coverage.md) maps the historical examples to the operating knowledge retained in the guides.
