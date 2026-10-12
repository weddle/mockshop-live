# Agents, onboarding and user preferences

Use [backend user state](backend-user.md) for DTOs and mutable-store ownership, [backend chat](backend-chat.md) for model use, and [backend admin](backend-admin.md) for privileged counterparts. This guide records native control semantics from the full script corpus. UI permission visibility is not proof that every local mock route enforces production authorization.

## Agent gallery and editor

`[data-testid="AppSidebar/more-agents"]` opens `/app/agents`. **All Agents** and **Your Agents** are separate catalog views. **Search agents** searches the visible catalog, including label metadata; **Everyone** (creator) and **All Actions** filters create removable chips. Stage enough varied owners/actions to make filtering meaningful. A no-match result is different from a truly empty agent seed.

Opening a card displays the agent viewer. **More Info**, Fold/Expand Actions & Tools and the description/knowledge lists are read-only views of persona metadata. **Start Chat** enters `/app?agentId=<id>`, selects that agent and may pin it. Pins persist via `PATCH /api/user/pinned-assistants` with `ordered_assistant_ids`; an app navigation should agree with the gallery pin state. The built-in Assistant may remain when all nonbuilt-in cards are removed.

`[data-testid="AgentsPage/new-agent-button"]` opens `/app/agents/create`. The native form has name, description, instructions and `starter_messages.0` fields, plus knowledge/document sets and actions. **Create** posts `/api/persona`; **Save** on `/app/agents/edit/<id>` patches that persona. New agents are private and owned by the current viewer unless an explicit sharing operation changes them. The returned agent ID, not a guessed allocator value, drives the next route. Cancel can leave a browser-held creation draft; explicitly overwrite fields when opening a supposedly fresh form in the same context.

A form's knowledge/actions selection changes metadata used by native catalogs and the authored chat context. It does not provision a real retrieval source or execute an external action. The admin editor uses this same form with `?admin=true`; its feature/list controls are covered in [admin agent curation](script-admin.md#admin-agent-curation).

## Agent sharing, ownership and deletion

| Native control/context | Operation and committed state | Result, cancel behavior and boundary |
| --- | --- | --- |
| Agent **Share** modal | `PATCH /api/persona/<id>/share` saves public scope, user/group shares and permission levels. | Empty search intentionally has no suggestions; type a case-insensitive user name/email or group. Selecting a chip is a draft; Save commits. Cancel/reopen must retain only prior saved shares. |
| Share permission choice **View & Chat** / **Editor** | Changes the corresponding share's level. | Scope the row; a same-label selector outside it can alter another recipient. Group resource pickers may be fixture-only on the admin side; see backend cross-read limits. |
| Share **Copy link** | Browser clipboard write of the local agent link. | Does not change access scope. Clipboard permission and a copy success icon matter. |
| Owner row → transfer dialog | `POST /api/persona/<id>/transfer-ownership`. | Agents accept user or group ownership; skill ownership is different. Back/Cancel preserves the original owner. |
| **Remove my access** | `DELETE /api/persona/<id>/share/me`. | Removes this viewer's share and updates accessible catalog views. It is not global deletion. |
| Agent **Delete** → confirmation | `DELETE /api/persona/<id>`. | Deletes the local persona and removes relevant native catalog/pin consumers. Cancel leaves it intact. |

The old share-picker example only opened/searched a picker; it did not demonstrate saving access. The later sharing/ownership/self-access scripts contain those mutations and readbacks. Do not promote a picker screenshot to permission persistence evidence. The Extras mock's share/delete routes do not provide complete production-grade root permission enforcement; author the correct native viewer/role and describe the actual boundary.

## Agent labels, avatars and analytics

In the editor, **Add labels** plus Enter creates a label through `POST /api/persona/labels`; saving the agent attaches chosen labels. `aria-label="Remove <label>"` removes the chip, and Save persists the association. Label creation and attaching it to a persona are separate writes.

The avatar control (legacy `.h-30.w-30`) opens a grid: default avatar, alternate native icons, and **Upload Image** are distinct branches. Upload targets the real file input and `POST /api/admin/persona/upload-image`; the mock stores a synthetic image identifier/representation, not arbitrary image processing. Save commits the avatar reference; `GET /api/persona/<id>/avatar` supplies the rendered consumer. Selecting default again removes a custom avatar only after Save. Use an actual native image/file fixture and check the reopened editor/gallery rather than just the selected tile.

`/ee/agents/stats/<id>` reads `GET /api/analytics/assistant/<id>/stats`. Presets **1D**, **7D**, **1M**, **3M** and custom calendar select an inclusive date range over finite seeded daily rows. The summary and chart can be populated or empty; hover exposes native series tooltips. **Back** returns to the originating agent view. There is no live analytics collector/export asserted by these scripts.

## Onboarding, empty states and branding

Onboarding is on `/app`, not a separate route. **Let's Go** → **Your name** → **Next** saves personalization. Provider choices then expose native provider-specific forms; fourteen form families are represented in the corpus, but opening them does not mean configuring all fourteen. The complete path saves one fictional provider configuration, finishes setup and sets `localStorage['onyx:onboardingCompleted:' + viewer.id]`. A connected-provider card's **Edit LLM providers** navigates to admin configuration; it does not reopen that provider's initial onboarding form. Member onboarding can be name-only; Enter/save confirmation is the native completion.

An empty-user seed can hide existing chats, pins, notifications and nonbuilt-in agents while leaving the built-in Assistant. A no-agent admin sees **Re-enable Default Chat** (settings) and **Configure New Agent** (catalog/editor); a member lacks those repair controls. Select the role and default-assistant settings deliberately. Hiding a card in a screenshot is not the same as removing its server record.

Enterprise branding comes from enterprise settings: application/team name, logo, header/greeting, disclaimer and help content. A required first-visit notice is a blocking native dialog: select its required acknowledgement checkbox, then **Start**. Acknowledgement is stored in browser-local consent keys, not reset solely by a backend keep flag. A published announcement is a separate native popup/banner. See [admin theme and consent](script-admin.md#theme-consent-and-announcements) for writes and persistence.

## Notifications and banners

`#onyx-user-dropdown` → **Notifications** opens the native list, with read/unread/pinned groups according to staged metadata. Hover a notification to reveal mark-read/dismiss actions. Opening a target navigates and `POST /api/notifications/<id>/dismiss` marks that item dismissed; **Mark all** posts `/api/notifications/dismiss-all`. `GET /api/notifications/summary` supplies counts. A warning banner has **Next**, **Previous**, **View**, and **Dismiss** controls; View and Dismiss are not synonymous.

These operations mutate the local notification store and survive navigation/keep. The corpus notes an SWR consumer caveat: the header badge can remain stale until reload while the list/read groups already reconcile. Do not claim every counter refreshes instantly or patch the DOM to force agreement. A fresh seed reset restores notifications, while browser-local notice acknowledgement remains a separate concern.

## General settings, language and background

`/app/settings` redirects to the General page. Name and role fields save through `PATCH /api/user/personalization` on the native commit interaction (Enter/blur as appropriate). Color Mode updates `PATCH /api/user/theme-preference`; selecting a chat background updates `/api/user/chat-background` and the theme expected by that background. **Cloud**, **Hills**, **Plants**, **Mountains**, **Night**, and **None** are immediate choices: there is no Save/Cancel transaction. None clears the background to null while retaining the current theme. Verify the chat CSS/wallpaper consumer as well as the selected tile.

The **Display language** input offers nine native endonyms. Escape cancels an open picker; choosing the current language is the native `defaultOption` no-op. A different choice patches `/api/user/language`, sets the native HTTP-only `NEXT_LOCALE` cookie and refreshes the router. `document.cookie` cannot assert or clear that HTTP-only cookie. The corpus covers an English→Spanish transition and a fresh-context English restoration; it does not establish that every control in every locale is translated. A source-derived nine-option inventory is not a nine-locale acceptance matrix. Use stable test IDs in locale-independent steps and explicit localized labels only when locale is intentional.

## Chat preferences and memories

| Setting/control | Backend write or lifetime | Native behavior to author |
| --- | --- | --- |
| **Default Model** input | `PATCH /api/user/default-model` | Future chats inherit it. Existing chat alternate models and old answer attribution remain unchanged. |
| Auto-scroll | `PATCH /api/auto-scroll` | Persists a viewer preference; test a consumer with enough conversation content to scroll. |
| Collapse pasted content | `PATCH /api/paste-as-tile?paste_as_tile=<bool>` | Affects native paste representation, not uploaded-byte parsing. |
| Temperature override and default | `PATCH /api/temperature-override-enabled?temperature_override_enabled=<bool>` and `PATCH /api/temperature-default` | Controls require the corresponding user flag; model capability/reasoning mode may constrain temperature. |
| Reasoning effort | `PATCH /api/reasoning-effort-default` | Requires the staged reasoning capability and selected model's allowed range. |
| Smooth Streaming | Native browser cookie | Not a backend preference/reset domain. |
| Voice auto-send/playback/speed | `PATCH /api/voice/settings` | Local preference metadata; no real microphone, transcription or TTS service is implied. |
| Personal instructions | `PATCH /api/user/personalization` on blur | Reopen to distinguish committed text from a still-focused draft. |
| Use memories / Update memories | Same personalization route with `use_memories` / `enable_memory_tool` | These flags are independent. With both off, Add can temporarily remain stale; turn Update on before authoring the add flow. |
| Memory textarea and row edit/remove | Personalization `user_preferences` | Enter commits a memory; editing/removing a specific line mutates that stored list. No real conversational memory extraction is demonstrated. |

## Prompt shortcuts

**Use Prompt Shortcuts** patches `/api/shortcut-enabled?shortcut_enabled=<bool>`. The native shortcut label (for example Summarize) and long instruction placeholder form a row. Complete a new row and blur to `POST /api/input_prompt`; editing an existing row uses PATCH, and its remove control DELETE. An incomplete draft produces the native validation error and must not overwrite a previously saved prompt. The trailing empty row is intentional, not a phantom saved record. Reopen settings and inspect the composer shortcut consumer to demonstrate persistence rather than only input text.

## Access tokens and gateway

Accounts/API settings **New Access Token** uses a required name, expiry (including seven days, a year, or no expiry) and scope selection. Limited scope cannot mint an empty-scope token; selecting a write scope locks its implied read scope, such as Chat Write → Chat Read. `POST /api/user/pats` returns a **fictional one-time token**. The subsequent list/reload exposes metadata, never that token again. **Copy Token** keeps its label and changes its icon; do not wait for invented “Copied” text. A token row's Delete action opens **Revoke** confirmation and DELETEs `/api/user/pats/<id>`.

The LLM Gateway settings tab is edition/permission gated (Business+, eligible `CREATE_USER_API_KEYS` scope); Community redirects to General rather than rendering a fake tab. Copy controls expose the local `/api/gateway/v1` base URL and selected provider/model identifier. **New Token** creates a PAT in the same store with LLM Gateway Use scope. This documents token metadata and the mock gateway surface, not access to real provider inference, billing or secret generation. The admin enable switch is in [admin preferences](script-admin.md#chat-preferences-and-gateway).

## Connected apps and personal connectors

The connected-apps page requires `oauth_provider_enabled` and an authenticated member. Its grant list uses the local OAuth-provider grant store; Disconnect opens a confirmation, Cancel preserves the grant, and confirm DELETEs `/api/oauth-provider/grants/<id>`. The empty state is a native result of deleting the local grant. It does not revoke a real third-party token or implement an authorization server.

Personal connector cards are distinct from organization connector/credential pairs. Vendor/name metadata is read-only where the native UI supplies no editor. Gmail Disconnect deletes `/api/federated/<id>/oauth`. Connect first navigates to the local `/mockshop/personal-connectors/<id>/connect` landing: the GET is read-only and safe from prefetch side effects. Only its explicit **Connect fake…** POST marks the local connector connected and redirects to settings. A landing-page screenshot is not a successful OAuth connection. See [callback contracts](script-auth-extension.md#provider-callbacks) for finite receipts and errors.

## Usage and spending display

`GET /api/user/usage` returns finite date-filtered rows and catalog prices. Date presets/custom calendar are local React state; leaving and reopening the page resets the selected date UI rather than saving a viewer preference. Future dates are disabled and a reversed custom range is normalized by the native flow. Model expansion needs more than three model rows; an unknown model remains unpriced rather than inventing a cost. Changing the default model can change the relevant catalog price display, but this is not an invoice or real usage metering. Backend user/admin docs distinguish this user view from group/user budget metadata and report fixtures.
