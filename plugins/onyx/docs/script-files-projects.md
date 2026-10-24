# Files and projects

The file picker, file viewer and project UI use the native frontend over the mock's user-file/project stores. They are not a filesystem browser or a document ingestion service. [Backend user state](backend-user.md) specifies request bodies and seed DTOs; [backend fixtures](backend-fixtures.md) explains how to author those seeds. The controls and assertions below are source-derived unless separately identified as observed in an execution report.

## Recent files and the full library

There is no standalone user-files page in this pin. The chat composer paperclip opens a quick list; the legacy pin locates its unlabeled button with `#onyx-chat-input button:has(svg path[d^="M12.0924 3.99814"])`. This path selector is a pinned-UI fallback, not a stable product API. Scope to the composer and prefer a semantic label if the pinned build gains one.

The quick list contains the three most recent items. **All Recent Files** appears only with more than three; seed at least four if that control is part of the story. The full picker reads the native recent-file catalog (`GET /api/user/files/recent`). Its searchable rows are `[role="dialog"] [role="button"]:has(.opal-attachment-item-button):has-text("<filename>")`. Clicking a row toggles composer selection; it does not open the preview or delete the file. **Done** closes the picker and retains the selected attachment chips.

Hover a specific row to reveal its eye and trash controls. The legacy eye uses SVG path prefix `M12 8.66667`; trash uses `M2 3.99998`. Those actions are distinct from the row-selection target. The selected-only filter uses SVG `viewBox="0 0 16 12"`; deselect-all uses `viewBox="0 0 15 15"`. Search filters the catalog by filename and has a genuine no-match state. Deselecting all or a composer's `aria-label="Remove"` only unselects files; the library record remains.

## Upload, paste, drop and readiness

**Add Files** and the native paperclip upload use a real hidden `<input type="file" multiple>`. Supply a synthetic `File` through a `DataTransfer`, assign `input.files`, and dispatch a bubbling `change` event as shown in [direct evaluation](script-authoring.md#direct-evaluation-and-files). The element must be the mounted native input, not a detached stand-in. Paste uses a `ClipboardEvent` with file data; drop uses `dragenter`/`dragover`/`drop` on the actual composer or project drop zone. A click recipe alone cannot exercise paste or drop.

`POST /api/user/projects/file/upload` adds metadata to the local user-file catalog. `POST /api/user/projects/file/statuses` reads finite time-based processing states; the chat's saved associations are also exposed by `GET /api/user/projects/session/<id>/files`. Wait for Uploading/Processing to finish and the send control to become enabled. An early attachment chip can still represent an unusable pending file. Multiple uploads and combined paste/drop selections must be waited on individually.

Submitted bytes are not generically parsed into answers. Only exact filenames in the authored catalog are accepted; unknown names and explicit `reject` entries return rejection metadata. The catalog supplies preview bytes, answer text, MIME/type, delays and optional final status. Use [file seed fields](backend-user.md#user-files) to author a new filename before uploading it. Reuploading the same name replaces its record rather than allocating another ID. Oversize checks require an actually oversized `File`, not a suggestive filename. A `FAILED` processing record has a native toast/removal branch; do not hide it with a direct state mutation and call it successful upload.

## Native file event recipes

These short recipes exercise existing handlers and contain no sample-specific world, narrative or catalog. Before using them, define the chosen filename in the native file catalog and scope the intended mounted input/dropzone. The composer paperclip input is `input[type="file"][accept="*/*"]`; the full-library input in this pin is `input[type="file"]:not([accept])` with `multiple`. Avatar, Vertex credential, skill bundle and supporting-file inputs have their own scope/accept rules.

For paste, the receiving element is the textbox, not its surrounding drop zone:

```javascript
const textbox = document.querySelector('#onyx-chat-input-textbox');
if (!textbox) throw new Error('Native composer missing');
const data = new DataTransfer();
data.items.add(new File(['Synthetic content.'], 'notes.txt', {type: 'text/plain'}));
textbox.dispatchEvent(new ClipboardEvent('paste', {
  clipboardData: data, bubbles: true, cancelable: true
}));
```

For a file drop, use `#onyx-chat-input` (or the mounted project drop zone), not the human-message text:

```javascript
const dropzone = document.querySelector('#onyx-chat-input');
if (!dropzone) throw new Error('Native drop zone missing');
const data = new DataTransfer();
data.items.add(new File(['Synthetic content.'], 'notes.txt', {type: 'text/plain'}));
dropzone.dispatchEvent(new DragEvent('drop', {
  dataTransfer: data, bubbles: true, cancelable: true
}));
```

If the story shows the drag-over affordance, dispatch `dragenter` and `dragover` on that same target first; a completed drop alone need not display the hover state. After either event, wait for processing/ready, require exactly one selected attachment per file and inspect the native library row. Removing its composer chip must leave that row intact. Clipboard paste events exercise the paste handler, not OS clipboard permission or user-tab capture.

The native pre-upload limit is **100 MiB** at this pin. A real `File([new Uint8Array(101 * 1024 * 1024)], 'oversized.txt', {type: 'text/plain'})` sent through the native input exercises that guard before FormData/backend upload. Use this allocation only for the intentional oversize branch; assert the native rejection and absence of an uploaded record. Do not allowlist an imagined upload HTTP failure for a purely client-side guard.

Set MIME intentionally: `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/pdf`, `image/svg+xml`, or the native Office MIME as appropriate. MIME/name alone does not create valid content: the catalog's backing bytes and parsed-preview fields determine the viewer. Vertex service-account upload is the important different path: the native FileReader reads actual JSON contents before saving a scrubbed credential, so a filename-only marker cannot fill its form.

## Preview formats and downloads

| File kind and native control | Visible result and completion assertion | Boundary |
| --- | --- | --- |
| Markdown/plain text/code/JSON | Text viewer; copy changes native check state; download offers the file's own name. | Authored text fixture, not a live filesystem read. |
| CSV/data | Table/data rendering for staged content, including empty data. | No general spreadsheet computation. |
| PDF | Native PDF/iframe or blob view; download response must begin with `%PDF` when asserting a real PDF payload. | An iframe existing is weaker evidence than valid file bytes. |
| Image/SVG | Native image, zoom/reset/download. Wait for image load and nonzero `naturalWidth`/`naturalHeight`, not merely an `<img>`. | A historical image fixture is 640×360. That is a fixture dimension, not a universal expected size. Some historical `.png` names wrap disclosed SVG bytes; filename alone is not MIME/format proof. |
| Workbook | Workbook sheet selector, rows, empty sheet and truncated-content state. | Finite fixture sheets; no Excel execution. |
| Modern Word document | Native document rendering for the staged fixture. | A deliberately broken template produces its native error. Legacy `.doc` and unsupported kinds can be download-only. |
| Missing/unavailable document | Native error plus any supported download fallback. | A named 404 is intentional failure, not an excuse to fabricate a preview. |

When writing a download assertion, capture the download event/response and inspect the intended filename and bytes where the story needs it. A toolbar screenshot or click alone establishes neither completed download nor valid format. Preview close/back controls return to the picker or chat without silently changing selected files. Reopening a saved attachment should resolve the same descriptor, rather than a new item looked up solely by display name.

## Saved file grounding and deletion

Sending with ready files stores normalized descriptors on the human message and supplies them to the finite answer renderer. In ordinary/manual sends, the selected model is resolved before the file-answer override, which builds authored summaries from the catalog rather than project instructions or uploaded bytes. Exact `send.reply` bypasses that override and uses the supplied exact reply; author its file references explicitly. A sentence saying “two files” does not prove two persisted associations. Read back `GET /api/chat/get-chat-session/<id>` and the session-files route, then assert both saved descriptors and visible attachment names/answer content.

After reload, the composer attachment tray is empty but the saved human attachments remain. Regenerating uses those saved human files even with an empty composer, and preserves their preview/citation associations. Historical citations/source panels and saved visual messages can still display after the corresponding recent-file library item is deleted.

The row trash calls `DELETE /api/user/projects/file/<id>` immediately: unlike project/chat deletion, this user-file action has no confirmation dialog. An in-flight spinner can require `settle: 0` to capture. Association with an assistant or project blocks deletion with the native error toast, preserving the catalog record. Project associations are live; assistant protection comes from seeded `assistant_names`, not a recomputation of current persona `user_file_ids`. To demonstrate assistant-only protection, first unlink the project through its native UI; otherwise the project guard explains the failure. Removing a composer chip is not unlinking an assistant or project. The mock guard behavior is narrower than a full production permission system.

Keep transitions and page reload retain successful uploads and deletions. A fresh reset restores the seed catalog and removes generated uploads. This is distinct from saved-message history: do not assert that deleting a library item erases old chat attachments, nor that resetting only the current route clears the catalog.

## Project home, creation and instructions

`/app?projectId=<id>` is the project home. A project sidebar button is labeled by its title. The detail title `.opal-content-xl [title="<title>"]` enters the `.opal-content-xl-input` editor; Enter commits and Escape cancels. Sidebar **Project options** → **Rename Project** uses `.opal-sidebar-tab input`. Both rename the same project record, so demonstrate readback from the other surface rather than treating them as separate names.

The Projects heading's add control opens `input[name="projectName"]`. Empty or whitespace-only names keep submission disabled; Cancel creates nothing. Creating calls `POST /api/user/projects/create?name=<name>` and opens the new empty project. Discover the new ID from its URL. A just-created project's pre-chat screen can lack the model selector; its first answer uses the saved viewer default, after which the ordinary chat model UI is available. Do not invent a pre-chat selector.

**Set Instructions** opens `textarea[name="instructions"]`; **Save Instructions** calls `POST /api/user/projects/<id>/instructions`. Cancel leaves the saved text unchanged; saving an empty value clears it to null. This metadata persists and is returned to native project consumers; do not claim it changes real LLM behavior unless the authored reply explicitly models it.

Collapsing a project via its native chevron (including keyboard Enter when focused) changes the sidebar view, not the chat's membership or selected project. Collapsed project chats do not suddenly become Recents. Project counts, active selection and its detail list should agree after navigation.

## Project file membership

Project **View All** opens its own file view with filename search. The eye previews, while the other row action unlinks through `DELETE /api/user/projects/<project-id>/files/<file-id>`. The card's **Remove** likewise removes the project association; it does not delete the global file. Assert that the item disappears from the project and still appears in the ordinary library.

**Add Files** opens the shared full-library picker. Selecting an existing file posts the project association, and unselecting removes it. New native uploads/drop add a catalog record and attach it to that project through the project callback. Wait for processing before opening it or starting a chat. A global file-delete attempt while still linked to a project is blocked; the project picker is not the same as that global delete action.

A project chat retains its project ID, instructions and selected file references in the local mock. Demonstrate intended reference behavior through the actual saved file associations and authored reply. Merely seeing a file card on the project home is not proof the next answer used it.

## Project chat membership

A chat's own options menu → **Move to Project** opens a searchable project menu. An unmatched search can offer **Create <name>** with that text prefilled. The back control returns to the root menu. Moving a custom-agent chat can show a warning: Escape/Cancel leave it in place; **Confirm Move** commits. The `move-custom-agent-do-not-show` checkbox suppresses later warnings in browser-local preference state, not in the project record.

A committed move posts to `/api/user/projects/<id>/move_chat_session`; **Remove from project** posts to `/api/user/projects/remove_chat_session`, returning the chat to Recents. Native pointer dragging a chat onto a project or back to Recents exercises the same membership mutation. A DOM reordering without a successful drop is not a move. Use intermediate pointer steps and a visible drop target; avoid hitting the row's menu or collapse control.

Opening a moved chat uses `/app?chatId=<id>` and the same chat engine/tree, not a copied conversation. Deleting the chat through its confirmation calls the ordinary chat deletion route and removes it from both project and global chat consumers. Deleting a project through its own confirmation calls `DELETE /api/user/projects/<id>`: file links and project membership disappear, chats return to Recents, and global files survive. Deleting all projects yields an empty project tree, not an empty chat/file store.

## Project search, folded sidebar and reset

With a folded sidebar, `[data-testid="AppSidebar/projects"]` opens `ProjectsPopover`; its search, row and new-project controls are native alternatives to expanded sidebar rows. Search can match project names and contained chat titles. The Search Chats **Projects** filter has an interactive threshold: the historical script creates a fourth project because three seeded projects leave only the heading/noninteractive presentation. Data quantity is a prerequisite, not a selector bug.

Browser-local collapse/search state and backend membership are different lifetimes. Rename, instructions, created/deleted projects, file membership and chat membership persist through reload and keep transitions. A fresh backend reset restores the seeded project tree and memberships, discards generated projects, and restores catalog state; reset the browser context as well when proving default collapsed/expanded behavior. A robust reset story dirties names, instructions, file links and chat membership separately, then asserts each returned to its seed rather than only checking the page title.
