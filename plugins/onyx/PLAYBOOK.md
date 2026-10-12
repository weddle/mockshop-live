# Authoring an Onyx demo

Start with a specific visible outcome: a useful answer with readable citations, an editable agent, a file preview, or a settings change that survives navigation. Use the real pinned frontend and fictional content. Mockshop is a way to stage that interface, not to reproduce Onyx's production backend.

## A short working loop

1. Build and verify the default Community runtime using the [plugin quick start](README.md).
2. Pick one existing scenario under `scenarios/` whose interface is closest to the desired demo.
3. Edit the relevant fixture text and records. Use a named overlay for a different story rather than changing shared seeds unnecessarily.
4. Adjust the scenario through native controls using the [scenario reference](../../docs/scenario-spec.md). Add assertions for the visible state that matters.
5. Validate, run that specific scenario, and inspect the report and screenshots.
6. Once the flow works, record a clip and inspect actual playback, including text readability and the ending state.

Example commands from the repository root:

```sh
./mockshop validate onyx --all
./mockshop shot onyx/user-ask-with-citations
./mockshop clip onyx/user-ask-with-citations
```

Use `./mockshop live onyx` for the existing JSON-lines control interface described in the [agent guide](../../docs/agent-guide.md). It drives the same native frontend; avoid replacing visible interactions with direct calls that only change the fixture backend.

## Content and presentation

Use neutral fictional organizations, people, documents and credentials. Keep the question, scripted response and source preview consistent. A follow-up is another staged turn, not evidence that a model understood arbitrary input.

Give viewers enough time to read useful results. Configure the existing [cursor engine](../../docs/cursor.md) for visible motion and click emphasis. The clip timeline and captions should describe what actually occurs; do not imply continuity across a fixture reset or a connection to a real external service.

## Boundaries

Edition and locale declarations select actual frontend behavior. An Enterprise scenario may be skipped on Community; a successful English run does not prove another locale. Native controls absent at the pinned version should not be invented. Generated runtimes and outputs are local, ignored artifacts subject to upstream licenses.

Keep each new fake response or state change small and tied to the intended screen. Do not add production authentication, provider calls, durable storage, permissions or billing machinery to make a demo.
