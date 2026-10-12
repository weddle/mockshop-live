# Scenario authoring and live control

Mockshop exposes the same scenario steps to YAML files and a JSON-lines live session. This guide is for people and programmatic clients; it does not require a particular agent runtime.

References: [scenario specification](scenario-spec.md), [scenario schema](../schema/scenario.schema.json), [plugin vocabulary format](plugin-vocabulary.md), [installation and platform requirements](../README.md#requirements).

## Author a scenario

1. Read the included plugin's [capability vocabulary](../plugins/onyx/vocabulary.yaml), [playbook](../plugins/onyx/PLAYBOOK.md), [manifest](../plugins/onyx/plugin.yaml) and [README](../plugins/onyx/README.md). Reuse steps and locators from existing scenarios; a rendered control is not proof that its backend behavior is implemented.
2. Write a YAML file with `name`, optional viewport/locale/clip settings and `steps`. A typical screen sequence is `goto` or `click`, then `wait` for visible content, then `shot`. Prefer `testid`, `role` plus `name`, `placeholder` or `label`; use CSS selectors for stable identifiers.
3. Run `./mockshop validate <file.yaml>` or `./mockshop validate onyx/<scenario>`. Schema validation does not exercise a browser or check locator correctness. Route checking needs a built frontend route manifest.
4. Run `./mockshop shot <target>`, inspect the report and open the PNGs in `out/onyx/<name>/`. A failed step can indicate a bad locator, an unsupported mock interaction or a frontend error; use the report and a live session to distinguish them.
5. For video, run `./mockshop clip <target>`. Add `pause`, `card`, `mark`/`keyframe` and `at:` where needed. The `.timeline.json` records action/marker times; recordings do not include generated narration.

Use fictional fixture data. Keep generated runtimes and toolchains separate from source edits. For concurrent instances, set `MOCKSHOP_ONYX_WEB_PORT` and `MOCKSHOP_ONYX_MOCK_PORT` to ports you control; backend state is shared by sessions on the same mock port. `down` stops the configured listeners, not just the current session's browser.

Only run trusted scenario files and plugins: `eval` executes page JavaScript, plugins run local code and builds execute manifest shell commands.

## Start a live session

```bash
./mockshop live onyx --name walkthrough --save walkthrough.yaml
# Optional recording or locale override:
./mockshop live onyx --clip --locale ja --name walkthrough
```

Run it as a long-lived subprocess. stdin and stdout use JSON lines: write one object per line and read the reply. Build/start logs go to stderr. Wait for the initial `ready` record before driving the session.

A step uses the YAML vocabulary expressed as JSON:

```json
{"id":1,"goto":"/app"}
{"id":2,"wait":{"selector":"#onyx-chat-input-textbox"}}
{"id":3,"type":{"selector":"#onyx-chat-input-textbox","value":"Hello"}}
{"id":4,"shot":"typed"}
{"id":5,"mark":"question-ready"}
{"id":6,"cmd":"save","path":"walkthrough.yaml"}
{"id":7,"cmd":"end"}
```

Optional `id` is echoed in step/command responses. `only`, `at` and `cursor` modifiers follow the scenario specification. Commands are:

| Command | Result |
|---|---|
| `{"cmd":"save","path":"file.yaml"}` | Write the successful steps as YAML and return validation results. Without `path`, use `--save` or the generated default under `out/`. The file is written even if validation reports errors. |
| `{"cmd":"export"}` | Return the YAML text and validation results without writing a file. |
| `{"cmd":"end"}` | End the session, finish any recording and emit the final record. EOF also ends it. |

`--save` exports again when the session finishes. Successful steps are exported in order; failed steps are not. Export contains `name`, `title` and accepted `steps`, not all session settings: add `locale`, clip configuration, viewport or fixture metadata explicitly, or pass the same CLI locale/clip flags on replay.

## Response shapes

The following are abbreviated examples, not captured results:

```json
{"ready":true,"plugin":"onyx","session":"walkthrough","out_dir":"/absolute/out/onyx/walkthrough","clip":false,"ops":["goto","click","shot"]}
{"id":3,"ok":true,"step":3,"op":"type","url":"http://127.0.0.1:3300/app","screenshot":"/absolute/out/onyx/walkthrough/step-003.png"}
{"id":4,"ok":false,"step":4,"op":"click","error":"locator.waitFor: Timeout ...","screenshot":"/absolute/out/onyx/walkthrough/step-004.png","problems":["STEP ..."]}
{"id":5,"ok":false,"error":"invalid step","errors":[{"path":"bogus","message":"..."}]}
{"id":6,"cmd":"save","ok":true,"path":"/absolute/walkthrough.yaml","steps":3,"errors":[],"warnings":[]}
{"done":true,"shots":[],"problems":[]}
```

Step replies include the current URL and a screenshot path, or `null` if screenshot capture failed. When timeline data is available, replies can include `t_ms` and `target_box`. `problems` contains newly observed problems, not necessarily a failed step. `ok` on a step means the operation completed, not that the UI is visually correct or the backend fully implemented. A live session continues after failed steps; its process exit status is not a substitute for inspecting responses and the final problems list.

Bad JSON, schema-invalid steps and unknown commands return error records without running a step. A locator can take its normal timeout (often 10–20 seconds) to fail; a shorter explicit `wait.timeout` is useful for probes.

A practical loop is: navigate, inspect the screenshot, choose a locator, run a step, inspect again. Add named `shot` and timeline markers at useful points, save, then validate and replay the exported YAML. In `--clip` mode, video and timeline are finalized when the session ends. See [the example export](examples/live-session.yaml).
