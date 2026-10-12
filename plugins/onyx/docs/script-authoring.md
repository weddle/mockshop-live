# Authoring mechanics and evidence boundaries

[Playbook](../PLAYBOOK.md) · [Script syntax](../../../docs/script-spec.md) · [Backend runtime](backend-runtime.md)

This guide states source-derived operating contracts, not newly observed browser results. The [coverage ledger](script-coverage.md) records which historical definitions supplied each contract.

## Build a fresh world and script

A world owns reusable background data. A script owns ordered scenes/steps, story-local `content`, exact answers and persistent screen selections. A profile owns cursor/render defaults. Shared collections are maps keyed by stable names; references such as `{{people.reviewer.name}}` propagate edits. Arrays replace rather than append, objects merge recursively, omitted fields inherit and `null` is a value. `remove` applies after composition; dangling references fail.

Onyx-specific seed records go under `apps.onyx.fixtures`, keyed by an ordinary exact `METHOD /path` such as `GET /mockshop/user-files`. These are seed DTOs, **not** requests that will be executed, and cannot override a dynamic handler's live state. Prefer shared people/sources/documents/conversations and the adapter's `agents`, `viewer`, `models` and `replies` mappings where they fit. See [native projection and seed dependencies](backend-runtime.md#shared-content--native-seeds) and [fixture field reference](backend-fixtures.md). Do not copy a private snapshot merely to obtain IDs or labels.

Give every scene and step a stable ID. For an exact chat result, place the reply adjacent to the question:

```yaml
scenes:
  - id: investigate
    steps:
      - id: open-chat
        goto: /app
      - id: ask-owner
        send:
          text: "Who owns the follow-up?"
          reply:
            title: "Follow-up owner"
            queries: ["follow-up owner"]
            cites: [handoff]
            text: "{{people.reviewer.name}} owns the follow-up. [1]"
      - id: inspect-sources
        click: {role: button, name: Sources, exact: true}
      - id: sources-ready
        wait: {text: Found Sources, exact: true}
```

This is a scene fragment: its world must define `people.reviewer`, document `handoff` and that document's source, plus a usable native model catalog. See the retained [world example](../../../worlds/omzo/world.yaml) for complete file structure, not for required fictional content. A model alias only resolves an existing visible model; it does not create a provider. Citation numbers refer to `cites` order. Two identical questions at different step IDs can have different exact replies. Exact responses are consumed once; a missing prepared response is an error, not regex fallback. Found Sources is the sidebar heading observed in the current retained examples; older numbered-citation/file contexts can expose Cited Sources or User Files instead, so choose the heading for the actual native source state rather than making one universal.

A source vendor must be supported where used. Changing `confluence` to `notion` requires compatible explicit URLs, connector configuration and locator text; the compiler refuses an incompatible vendor instead of silently presenting Confluence. Stable IDs derive from keys, not names or order. Use the adapter's explicit ID mapping only when a native route or deliberately authored cross-reference requires it.

World references are one-pass. To retain an Onyx runtime placeholder such as `{{prev.answer}}` or `{{ago:2h}}`, use the explicit template-opening variable technique in [the backend runtime reference](backend-runtime.md#shared-content--native-seeds). Do not let the world resolver interpret a runtime placeholder as a missing world entity.

## Navigation and locator discipline

`goto` takes a native page path, including query parameters. Native user routes include `/app`, `/app/agents`, `/app/agents/create`, `/app/agents/edit/:id`, `/app/settings/...`, `/craft/v1/...`, `/nrf`, `/nrf/side-panel` and `/auth/...`. Projects are `/app?projectId=...`, chat history is `/app?chatId=...`, and an agent selection is `/app?agentId=...`; there is no separate Projects or user-files page. The local source viewer is a **mock page** behind `/api/mockshop/source/:id`; navigate with `location.assign()` when the native-page route validator would reject an API path.

Locator resolution uses `testid`, then `role`/`name`, `placeholder`, `label`, `selector`, or `text`. A bare string is a substring text search. Prefer exact visible names and scoped selectors. `nth` is zero-based; `last` is useful for the newest message, but a count/readback assertion should establish the expected message set first. CSS selectors are not automatically made unique or visible. `any_visibility` is for deliberate hidden-input inspection, not a way to click hidden product controls.

| Repeated label or icon | Correct context | Mistake prevented |
|---|---|---|
| GPT/model name | Composer: `[data-testid="model-selector"] button`; answer: `[data-testid="AgentMessage/regenerate"]`; opened options: `[role="dialog"] :text-is("...")` | Selecting an answer footer instead of the next-turn model, or confusing regeneration's override with the composer selection. |
| Save / Cancel / Delete / Connect | Scope to the active `[role="dialog"]`, relevant card or table row | A page button, nested dialog or another row can have the same label. |
| File Open/Delete | Scope the filename row, hover it, then its `.opal-attachment-item-button-action` controls | Selecting a file attaches it; its eye icon previews it; its trash icon deletes or unlinks according to the owning surface. |
| Chat options | `[data-testid="ChatButton"]:has-text(...) button[aria-label="Chat options"]`, or the specific `href` row | Project detail and sidebar can display the same chat twice. |
| Agent card icons | `.radial-00:has-text(...) .h-24 button`: stats, edit, share, pin at this pin | Footer Start Chat is outside the header; icon-only Edit has a tooltip, not a dependable aria-label. |
| Provider model row | `[data-model-name="raw-model-name"]`; row-right button 0 Rename, 1 Settings | Custom labels are editable; raw model identity must remain stable. |
| Clear filter X | Sibling button beside the active time/tag/creator trigger | The X is not inside the trigger. Clicking the trigger merely reopens the menu. |
| Portal popover | `[role="dialog"]:has([role="slider"])` for model settings | The provider form is another dialog underneath it. |

Tooltip-only controls sometimes require public DOM structure or the exact source SVG path. Such selectors are pin-specific contracts, not invented accessibility labels. Focused reusable locators are documented in the [file picker](script-files-projects.md#recent-files-and-the-full-library), [Craft output panel](script-craft.md#output-panel-artifacts-and-previews), [extension settings](script-auth-extension.md#new-tab-extension-surface) and tables above. Re-check the actual control when changing the frontend pin; the coverage index intentionally contains no copied selector catalog.

Native popovers can close on Escape, selection or navigation, but not every disappearance signals completion. Search tag refinement temporarily replaces the menu with a spinner and remounts it still open; wait for results and the remounted menu before closing it. A credential Update closes the inner editor, not the outer credential picker. File previews nest above the file picker; Escape closes the preview first. Provider settings popovers also nest above the provider dialog.

## Completion waits and transient states

Use a semantic wait before a presentation pause. `pause` is clip-only, not a screenshot synchronization primitive. `settle` includes bounded network/loader waits and is not a universal completion oracle.

| Operation | Completion evidence |
|---|---|
| Chat send | Expected answer content **and** completed latest answer. Exact `send` requires its prepared backend turn to complete and the latest `[id^="message-"]` wrapper to contain `onyx-ai-message`; optional `send.wait` runs afterward. A previous completed answer's test ID is not sufficient. Live optimistic wrapper IDs can be negative and need not equal backend IDs until reload. |
| Regenerate/edit | New expected branch/content plus the correct answer-level model; readback can assert node parentage/count. |
| File upload | Uploading → Processing → ready; send disabled while pending, expected attachments still present afterward. |
| Image | `img.complete && img.naturalWidth > 0`, plus visible dimensions; an `<img>` element alone is insufficient. |
| PDF/Word/workbook | Loaded native preview content, current filename and expected sheet/page; an iframe or download link alone is insufficient. |
| Save | Dialog closes or source-specific success appears; navigate away/reopen and inspect exact values. |
| Deletion | Row disappears, survivors remain, reload preserves absence; distinguish unlinking from actual deletion. |
| Craft turn | Source completion output/approvals/turn status; queued, running and interrupted are distinct states. |
| Search | Returned result or native empty/error state and retained query; do not wait for a chat answer in Search mode. |
| Download/copy | Native success indicator is useful but limited. For downloads, browser completion and saved bytes are separate evidence; clipboard denial may legitimately show an alert. |

`click.settle: 0` and `shot.delay: 0` preserve real transient Uploading, loading, pending, copy-check or toast states that default settling can outlast. They do not authorize photographing a named state without asserting that state. The auth verification error form has an always-pulsing logo: normal loader settling can consume the resend success toast. Craft loading staging uses a 25-second delay to outlast the existing navigation/loader settling before positively asserting Loading.

Scroll the control and outcome into the viewport before clicking or capturing. Full-page images do not make an off-screen control a visible interaction. Toast stacks can cover a real pointer target: the scheduled-task Created/Paused toasts can cover Resume, so wait for them to expire rather than bypassing them. Connector Advanced collapse state may survive same-component navigation; inspect its chevron before toggling instead of blindly clicking twice.

## State, keep and reset

| Instruction | Meaning and subsequent action |
|---|---|
| `state: {sidebar: [keys]}` | Ordered chat-list mask; hidden conversations remain available by direct ID. New chats omitted from the mask stay hidden. |
| `state: {connectors: [keys]}` | Ordered indexing-row selection; summaries are recomputed. It does not run indexing. |
| `state: {agent: key}` / `{model: alias}` | Adapter resolves IDs/catalog descriptor, updates appropriate screen/session state, and reloads. Wait again for the native selected control. Old answer snapshots are not relabeled. |
| `state: {world: relative-path}` | Compiles/switches a complete background persistently. No temporary step-scoped entity mutation; references in the script still resolve its primary world. |
| Same-world keep | Retains supported run-local writes. It is not equivalent to keeping every module across a different world namespace. |
| Fresh reset | Clears backend stores to active seeds, then the script/runner must establish browser state and re-navigate. |

Use [the exact per-store matrix](backend-runtime.md#control-plane-and-reset-matrix): root chats/agents/preferences/providers retain per-world namespaces, while files/projects/users/groups/MCP/Craft and other seed caches reseed on a world change. The backend is process-wide; independent concurrent demos need separate instances/ports.

For explicit reset assertions, the historical corpus uses the same control plane as the runner:

```yaml
- id: reset-backend
  eval: |
    (async () => {
      const current = await (await fetch('/api/__mockshop/state')).json();
      const result = await fetch('/api/__mockshop/state', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({overlays: current.overlays,
          anchor: current.demo_anchor, locale: 'en', keep: false, resetChats: true})
      });
      if (!result.ok) throw new Error('Fresh backend reset failed');
    })()
- id: reopen-after-reset
  goto: /app
```

Do not hard-code a private compiled overlay name. A `state` switch followed by a fresh reset must retain `current.overlays` so it resets the intended compiled world. Do not send `strict` just to reset product state: doing so resets strict miss evidence. First assert real dirty state, then keep/reload, then fresh/reload and exact seed restoration. An empty-to-empty test proves no reset behavior.

Backend resets do not clear these browser-local states:

- `onyx:onboardingCompleted:<user-id>`: native Finish Setup dismissal.
- `allUsersInitialPopupFlowCompleted`: first-visit/consent acknowledgment.
- `onyx:craftOnboardingSeen:<user-id>`: Craft tour.
- `useOnyxAsDefaultNewTab`: extension preference.
- Smooth Streaming's native cookie; auth-error restart/session markers; referral cookie.
- `NEXT_LOCALE`: native HttpOnly locale cookie. An English backend reset inside a Spanish browser is not a fresh English UI. Use a genuinely new runner context or the native language control.

Clearing a specific onboarding marker can stage the prerequisite, but is not proof that the user's Finish/Start control works. Do not clear all storage indiscriminately: script sessionStorage snapshots record IDs/readbacks for later assertions and are not a second product store.

## Direct evaluation and files

Use `eval` for readback, same-origin navigation, public DOM focus/scroll, explicitly supported staging endpoints, and native upload/drag/paste event setup. Never inject private React/Formik state, counterfeit a trusted extension parent, or mutate product APIs in place of the visible action under demonstration.

The corpus's direct writes target the control/staging plane: `/api/__mockshop/state`, `/api/mockshop/auth-anonymous/stage`, `/api/mockshop/sharing-feedback/outcome`, `/api/mockshop/browser-extension/{context,outcome}`, and `/api/mockshop/user-craft/stage`. The corresponding guides explain their finite inputs. Ordinary `/api/me`, provider/catalog/detail, project/files, permissions and chat reads are supplementary assertions. A read-only source viewer GET, connector OAuth landing GET or personal-connect landing GET must not perform a fake account write; explicit local form POST does that.

The upload pattern delivers fictional bytes to the **existing native input**:

```javascript
const input = document.querySelector('input[type="file"][multiple]');
if (!input) throw new Error('Native upload input missing');
const transfer = new DataTransfer();
transfer.items.add(new File(['Fictional teaching note.'], 'notes.txt', {type: 'text/plain'}));
input.files = transfer.files;
input.dispatchEvent(new Event('change', {bubbles: true}));
```

Scope the input to its current modal/dropzone: an agent avatar, Vertex credential file, Craft skill bundle, Craft supporting file, connector archive and user attachment are different controls. Input event delivery proves the frontend's upload handler, **not** that an OS chooser was visibly opened/used. Reusable paste/drop, MIME and oversize recipes are in [file event recipes](script-files-projects.md#native-file-event-recipes). They exercise the existing handler, not a direct product-store insertion.

The public pointer-dispatch convention in existing scripts drives dnd-kit from real row/handle geometry with pointer-down/move/up and intermediate movement. Use it only for the native drag workflow (project membership or agent order), then require changed visible order/membership and reload. A programmatic endpoint write is not a drag demonstration.

## Edition, locale and evidence

Community, Enterprise and Enterprise Cloud are different built artifacts. The native `/admin/groups2` alias needs the existing prefix-boundary patch; paid-route aliases may rewrite to `/ee/admin/...`. Community `/license` and enterprise branding may intentionally be 404; a redirect to General or `/app` is the native guarded result, not a successful paid page.

Locales declared by the plugin: English, Spanish, Portuguese, French, German, Japanese, Chinese, Korean and Arabic (`en/es/pt/fr/de/ja/zh/ko/ar`). Locale setup affects browser language, headers, native cookie and `/me.preferences.language`, not authored data. Arabic smoke asserts both HTML language and RTL/computed layout. The language-control workflow covers one English→Spanish transition and the nine menu endonyms, not nine fully exercised applications. English selectors will not automatically survive translation.

Historical source contains both acceptance claims and `EDITONLY`, `pending`, `unverified` or archived comments for the same families. Those statements refer to different earlier artifacts. This documentation does not reconcile them into a new pass. Build/handler/source changes, edition, viewport, locale and upstream patches require their own observed evidence.

For a deliberate failed request: stage only the named operation, perform the real native action, assert the native error and that protected prior state is unchanged, then recover with the same control or explicit staging reset. Scope known errors to method/status/path/query and the actual compiled console source. Do not copy private samples' historical ports/chunk hashes as reusable allowlists. A broad Chromium resource-error allowance in an old file is weaker evidence than an exact source-scoped allowance; neither permits a failed script step.

Route smoke definitions and `_probe` only enumerate rendered entry points. `continue_on_error`, an API assertion, a screenshot filename or an existing vocabulary `works` label does not establish completion, downloads, runtime acceptance or real services.
