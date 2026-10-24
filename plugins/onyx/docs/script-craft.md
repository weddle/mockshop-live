# Craft authoring and operating knowledge

Craft requires the compatible Enterprise frontend and staged Craft capability/settings data. It is a finite local simulation: no sandbox, scheduler, dev server, GitHub import, credential exchange or external app is actually run. The native UI consumes the same request shapes it expects in the product. [Backend Craft](backend-craft.md) is the authoritative request/response/store reference, including the shared admin-app/skill associations; [backend fixtures](backend-fixtures.md) explains seed construction.

## Entry, tour, model and provider prerequisites

The sidebar link `a[href="/craft/v1"]` enters Craft; `/craft` redirects to `/craft/v1`. The main composer is `[contenteditable="true"][role="textbox"]`, not the chat textarea. The first-visit **Meet Craft** tour has Next/Back and **Put Craft to work**. `localStorage['onyx:craftOnboardingSeen:' + viewer.id]` controls repeat display. A backend reset alone does not clear it; remove/set it intentionally according to whether the tour is part of the scene.

The model button opens provider groups; expand the desired provider before selecting a supported model. A provider-required admin has setup affordances; a nonadmin/basic viewer has different copy and no **Manage** control on Apps. No supported visible model also prevents native auto-preprovisioning of a session, which matters when showing truly no-session output states. Staging a no-provider world is not the same as leaving a composer unfilled in a provider-enabled world.

## Library files and folders

**Open add menu** → **Library** → **Manage library…** opens the native library modal. `GET /api/build/user-library/tree` returns the finite hierarchy. `aria-label="Toggle <folder>"` expands a folder; **Search files...** filters it and can show **No files match your search**. **Done** returns to the composer without deleting records.

**New folder** → `placeholder="Enter folder name"` → **Create** posts `/api/build/user-library/directories`. A unique nonempty folder name is required; slash-containing/duplicate names fail. Native upload inputs post `/api/build/user-library/upload`; ZIP upload uses `/upload-zip`. Folder-local **Upload to this folder** sets the parent path, so assert the new child under that folder rather than only searching the entire library. The mock discards arbitrary archive semantics and uses the editable synthetic bundle; a file named `.zip` is not proof of real ZIP extraction.

Folder/file **Delete** opens confirmation, then `DELETE /api/build/user-library/files/<id>` removes that node and descendants. This differs from immediate-delete user chat files. Confirm the item disappeared after closing/reopening the modal. A truly empty library shows an upload/drop affordance; read failure and folder-create write failure are separate native error branches. On a write error the mock intentionally makes no change. State staging, reset and exact error routes are described below.

## Skill catalog and editor

**Skills** opens `/craft/v1/skills`; `GET /api/skills` must be an object `{ builtins, customs }`, not a flat array. Search by skill name has a native empty-match view; clicking a name previews description/instructions/files, with Close returning to the catalog. Enable switches are `[role="switch"][aria-label="Enable <skill-name>"]` and use `PUT /api/skills/<id>/enabled`. Only one skill of a name may be enabled; **Switch skill** confirms replacing the currently enabled conflict through `replace_conflict`. A duplicate saved skill can exist disabled; do not conflate name uniqueness with enabled-name uniqueness.

**Create skill** → **Start from scratch** opens the editor. `input[name="name"]` requires a lowercase hyphenated name; `textarea[name="description"]` and `textarea[name="instructions_markdown"]` are required. **Rendered markdown**/**Raw markdown** change preview mode, not saved content. Save posts multipart `/api/skills/custom/editor`; subsequent Save patches `/api/skills/custom/<id>` with description/instructions. The editor remains open on the created record; discover its ID from the response/route. Cancel with unsaved changes opens a discard confirmation; canceling that confirmation retains the draft.

A native supporting-file input posts `/api/skills/custom/<id>/files`; **Remove <filename>** DELETEs the path. Ordinary supporting files add/replace that file. `SKILL.md`/ZIP replacement can replace content and must match the existing skill's name; **Replace content** is an explicit confirmation. **Delete skill** requires confirmation, then DELETEs the custom skill and reconciles app associations. Reopen/readback establishes persisted content and deletion, not just a modal closing.

## Skill imports, sharing and ownership

**Upload a skill** submits a real native file input for bundle inspection, then **Review skill** opens an editable draft. Save may show duplicate-name confirmation **Create anyway**. The mock interprets the configured fictional bundle rather than arbitrary ZIP/Markdown parsing. **Import skill** inside an already dirty editor has a replacement/unsaved-content confirmation; this is distinct from creating a new skill from the catalog.

**Import from GitHub** → repository input → **Search repository** posts `/api/skills/github/preview`. Only the configured offline repository is available. Individual `aria-label="Select <name>"` and **Select all importable skills** control importable selections; unavailable rows remain unavailable. **Import N skills** posts `/api/skills/github/import`; results distinguish imported, disabled-due-to-conflict and not-imported records. There is no network clone or live repository search.

**Edit sharing** opens native scope and permission controls: **Change sharing scope** → **Anyone in your organization**, **Change organization permission**, and typed **Add users, groups, and accounts** search. Staged user/group chips and **Select staged permission** are not committed until Save patches `/api/skills/custom/<id>/share`. Row **Update access for <recipient>** → **Remove Access** is also a saved draft change. Cancel/Escape leaves the previous shares intact.

Read-only viewer skills do not expose an editable form. Vacant ownership is a separate seeded state. The Owner row opens transfer; skill transfer accepts **users only**, unlike agent ownership which can accept a group. Back returns without changing ownership; Transfer posts `/api/skills/custom/<id>/transfer-ownership`. The previous owner remains an editor share when transferring away. Skills/app changes mark existing sessions' capabilities stale; **Reload** posts the session's `/skills/reload` endpoint and clears that flag. Merely closing the editor does not refresh an already loaded session's capabilities.

## App connections and callbacks

**Apps** opens `/craft/v1/apps`; the MCP tab is `?tab=mcp`. Search has a real no-match state. The user catalog is a projection of enabled admin apps plus per-user connection credentials; disabled admin apps are absent. **Connect** shows required credential-placeholder fields. Submitting `POST /api/build/apps/<id>/credentials` stores only a fictional/redacted credential representation and marks the app authenticated. **Disconnect** DELETEs those credentials, not the admin app or its skills.

A newly connected app can warn that associated skills are disabled. **Review skills** opens the filtered skill catalog; its enable switch performs the real skill toggle. **Show all skills** clears that context. **Manage apps** and aliases `/craft/v1/apps/manage` and `/craft/v1/apps/admin` redirect to `/admin/craft/apps` for eligible admins; nonadmin viewers do not gain management through an invented control.

OAuth-supporting app Connect obtains `/api/build/apps/<id>/oauth/start`, returning only the local `/craft/v1/apps/oauth/callback?code=mockshop-craft-only&state=<id>`. The callback posts `/api/build/apps/oauth/callback`; the exact finite marker/state is required. Error query, missing params, delayed exchanging and successful return-to-apps are distinct native states. The receipt changes the local per-user authenticated flag; no GitHub/other provider is contacted.

## Admin apps, association and policies

At `/admin/craft/apps`, **Add app** opens the catalog. A builtin card's **Add** opens required fictional credential/configuration fields plus bulk policy selection and Advanced per-action **Deny**/**Auto-approve** choices. Creating can lead to optional skill association; **Skip for now** is a real alternate completion. A managed app can intentionally hide configuration fields while still allowing supported policy edits.

**Create** for a custom app collects **My Custom App**, URL patterns (commit a pattern with Enter), and Authorization/header template pairs. **Add header**/**Add credential** create distinct editable rows; scope by the dialog's labeled group and row index. Their `Remove … pair N` controls remove only that draft pair. Canceling a dirty editor opens an unsaved confirmation; cancel that confirmation to resume editing, or discard deliberately. Save writes the shared admin app store (`/api/build/admin/apps` and its item operations; exact bodies in backend Craft).

**Associate existing** searches editable current skills, not a disconnected fixture list. Choosing a private skill can require **Make organization-wide** and **Save skills**; the shared skill must acquire the intended public permission. Unlink opens confirmation and stages an association removal until Save. **Delete app** confirms deletion but retains its custom skills, unlinks them and disables them; it does not silently delete authored skill content. Assert the skills catalog after deletion. This cross-owner relationship is an important reason to use native mutation paths instead of overwriting unrelated fixtures.

Enable/Disable `<app-name>` toggles app availability. The MCP tab's Enable/Disable `<server-name>` changes `available_in_craft`; the user tab reads current `/api/mcp/servers/craft`, not a stale copy. Admin Craft access, system preferences and MCP read/write/bulk policy controls are covered in [admin Craft controls](script-admin.md#craft-administration). All approval policies are local metadata; they do not authorize a real external action.

Historical vocabulary notes disclose a native validation callout in the custom-app bulk-policy dropdown and another in the pre-transfer skill combobox, even while describing successful saves/transfers. The YAML alone does not establish the exact current rendering of those callouts. Do not suppress them or claim a pristine form from an old acceptance sentence; inspect the actual current artifact when that visual state matters.

## Sessions, queued turns and approvals

`/craft/v1?sessionId=<id>` opens a saved session. Its sidebar `.opal-sidebar-tab:has-text("<name>") button[aria-label="Session options"]` offers Rename and Delete. Rename focuses `.opal-sidebar-tab input`; Enter commits `PUT /api/build/sessions/<id>/name`. Delete requires a dialog then DELETEs that session. A created session's ID is read from `sessionId`, never assumed.

Typing `/prefix` in the contenteditable composer exposes the skill picker; Escape dismisses it before replacing the prompt. A real attachment input posts `/api/build/sessions/<id>/upload`. **Send** posts `/api/build/sessions/<id>/send-message`, then the native UI reads finite turn events. Wait for **Stop generating** to demonstrate an active turn. While running, another instruction can be **Queue message**; `[data-testid="queued-message-bar"] button` removes the queued draft. Queued client text is distinct from a persisted sent human message.

The finite response may include a subagent. `aria-label="Switch agent"` opens the agent menu; selecting the subagent shows its read-only trace, and selecting the main agent returns to the writable conversation. This is authored event content, not an actual parallel worker. **Stop generating** posts `/interrupt`, marks the finite turn canceled and leaves the saved partial state. Reopening asserts saved human prompt and assistant output rather than assuming the visible stream was persisted.

Approval cards use `aria-label="Show details"`, **Approve this action once**, **Approve for session**, and **Reject this action**. Scope the intended unresolved card; the first matching global button can refer to another action. `/api/build/approvals/<id>/decision` records approval/rejection; `/session-grant` records a session approval. Already resolved approvals return conflict. These controls resolve local metadata only; no shell command/tool action is performed.

## Output panel, artifacts and previews

The pinned header output toggle has a tooltip but no accessible-name prop; the corpus uses `.ps-4.pe-4.py-3 > .shrink-0 > button`. A saved session without `nextjs_port` starts with its panel closed: click the actual header toggle rather than waiting forever for Files. Close/reopen preserves the native panel navigation state where supported.

**Files** lists a directory tree; `button.w-full:has-text("outputs")` expands that folder and a filename opens its tab. Markdown renders authored text; CSV/raw files show finite text; image completion requires a loaded image (`img[alt="<name>"].opacity-100` in this pin); PDF uses a blob iframe; PPTX preview has **Slide 1 of N** and ArrowRight/ArrowLeft navigation. A thumbnail/frame is weaker than a valid download assertion. **Download MD file**, **Export to .docx**, and artifact/folder **Download** return local authored/synthetic bytes or archives; no converter/sandbox is invoked.

**Go back**, **Go forward**, **Refresh** operate on the native output navigation; `Close <filename>` closes a transient file tab. **Artifacts** lists children of the output root, not an extra `outputs` wrapper. Scope archive downloads to `aria-label="Open <artifact>"` or `Toggle <folder>` so same-label Download buttons are not ambiguous.

**Preview** consumes `/webapp-info` and its local preview URL. Starting shows **Starting the dev server...**; ready shows the local finite preview. `[data-testid="url-text-wrapper"] button` copies the URL, and **open in a new tab** is an actual browser handoff. **Share webapp** → Organization patches `/api/build/sessions/<id>/public`; Copy link is a clipboard operation. This is not production deployment or real public hosting.

There are three distinct empty conditions: **No files yet** with no session; **No files in this directory** for a real saved session with no entries; and **No artifacts yet** plus disabled Preview when no webapp exists. Provider-enabled auto-provisioning can prevent the first, hence its separate no-provider prerequisite. A staged artifact-file read error is different from an empty directory and must remain an error view.

## Scheduled tasks and history

**Scheduled Tasks** or `/craft/v1/tasks` shows the native table. `[data-testid="new-task-button"]` opens `/craft/v1/tasks/new`. Name/prompt inputs (`task-name-input`, `task-prompt-input`) validate on blur; prompts support the slash skill picker. Schedule modes are Interval and Daily / Weekly; minutes require 1–59 and hours 1–23, so 60 minutes is intentionally invalid. `interval-every`, `daily-weekly-time`, and `weekday-N` expose real controls. No selected weekday represents the native every-day rule. Legacy advanced/cron records can have a different edit condition; do not invent an advanced editor absent from the current UI.

Preapproval app controls (`pre-approval-app-<id>`) require an app/MCP enabled for Craft. **Save and run now** creates via `POST /api/build/scheduled-tasks` and returns to the **list**, not the detail page. With the seeded twenty-row page size, the appended created item is on page two; use the real table footer next/previous buttons, then open the row. Discover the task ID from its route.

Pause/Resume and edited name/prompt/schedule PATCH the task. The created/paused toast stack can cover Resume's pointer target: wait for `body:not(:has([data-testid="toast-container"] .opal-toast))` plus an enabled `status-toggle`, not an arbitrary click retry. **Run now** posts `/run-now` and immediately creates a finite successful run/session; there is no background scheduler or clock-triggered execution. A successful `[data-run-status="SUCCEEDED"]` opens the saved session with `scheduled-run-banner` and `back-to-task-button`. Failed/skipped/other seeded histories are display fixtures; a skipped row is not openable. **Load more** pages the run history.

Edit opens `/craft/v1/tasks/<id>/edit`; Save commits and reopen verifies fields. Delete (`delete-button`, `confirm-delete-task`) removes the local task and returns to the table. Empty task list, empty run history, task-list error and history error are independent states. **Try again** must follow a staged restoration to loaded data; it is not proof of automatic recovery from an unchanged failure.

## Loading, errors, usage limit and reset

`POST /api/mockshop/user-craft/stage` accepts an explicitly supported path and finite view state. Read states include loaded/empty/error/loading; special output states include starting, and send-message supports limited/error/loaded. Exact path templates (such as `/build/sessions/:id/files`) matter: a concrete ID is not interchangeable with a staging template. See the backend Craft staging table rather than guessing arbitrary response overrides.

Distinct corpus branches cover Skills loading/read error/empty; Apps empty/read error fallback; Library empty/read/write error; task list/history empty/read error and explicit retry; artifact file error; starting/disabled preview; and a recoverable native usage-limit banner after Send. To capture loading, the staged delay must outlast the runner's bounded navigation/network-idle and loader settling. A screenshot of an already loaded grid named “loading” is not loading evidence. Restore the staged path to loaded before claiming recovery, then wait for its actual content.

Native writes persist across page reload and keep transitions: sessions, renamed titles, skill content/shares/enablement, app associations/credentials, tasks/runs, library entries and output sharing. Fresh reset reconstructs their seed stores and clears finite staged outcomes. Browser tour/storage keys require separate cleanup. The composed reset script deliberately creates and reads back a skill, app, task and uploaded library file before resetting, then verifies each creation disappeared; this is stronger than resetting an already clean screen. No historical acceptance comment is treated here as fresh execution proof.
