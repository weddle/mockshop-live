# Authentication, conditional routes and browser extension

Authentication and provider examples use finite fictional local handlers. They never authorize real identities, deliver email, validate a real API key or complete a third-party OAuth exchange. Read [backend authentication](backend-auth.md) for stage payloads, issued-token registries, cookie behavior and callback response schemas. Native route/edition prerequisites cannot be manufactured by changing a fixture alone.

## Authentication state and entry routes

Anonymous-auth scripts explicitly stage a logged-out member state with `POST /api/mockshop/auth-anonymous/stage`, commonly `{ "mode": "logged-out" }`, and arrange `/api/me` to return 401. This clears the mock's runner authentication cookie through its handler. Writing `document.cookie` cannot clear native HTTP-only cookies. Distinct staged profiles cover mixed password/SSO, SSO-only, auto-SSO, first-user and multitenant UI branches. A route that redirects an already logged-in viewer is working normally, not a reason to patch out the guard.

Native routes include `/auth/login`, `/auth/signup`, `/auth/join`, `/auth/create-account`, `/auth/forgot-password`, `/auth/reset-password`, verification/waiting routes, and `/auth/error`. Follow actual native links where route spelling matters; the coverage index retains source navigation operands. Logged-in members are redirected from login/signup/join/verification/waiting back to `/app`. Forgotten-password UI additionally depends on the compiled forgotten-password feature flag; the supported builds must enable it. Edition requirements in a script describe a physical compatible frontend, not a mock header pretending to be that edition.

## Password login, signup and join

Login's email/password test IDs and **Sign In** submit form-encoded `POST /api/auth/login` with `username` and `password`. Empty/invalid fields have native validation/disabled states. The finite handler accepts only the explicitly configured fictional demo credentials, sets the mock member cookie, and redirects to the ordinary app. Wrong credentials produce the native error; no real password database is checked.

**Forgot password** requires a valid nonempty email in the relevant native entry flow. **Sign up** opens a two-field email/password form: this pin has no name or confirm-password fields on signup. Test short passwords, duplicate/email errors, query-string email prefill and successful registration as separate branches. `POST /api/auth/register` records a pending unverified fictional account and a mailbox link; it does not send email. Join reuses native email/password validation and prefilled email. A team/invitation name is not rendered merely because a seed contains one, and the corpus does not establish an invitation-selection backend.

`/auth/create-account` is an explanatory page with native bullets, **Create New Organization** leading to same-origin registration/signup (enabled by the local same-origin redirect patch), and a Sign in link. It is not a real organization provisioning service. Join has no team selector, Cancel or footer control in this pinned flow; do not invent them from another auth page.

## Recovery, verification and the fake mailbox

**Forgot password** posts `/api/auth/forgot-password`; known email produces a local issued reset token, while missing/invalid/error cases produce native errors. The reset form's `password` and `confirmPassword` inputs enforce minimum length and matching values before `POST /api/auth/reset-password`. A success token must have been issued in the same mock state; a plausible-looking string is not enough. Success toggles the mock's finite completion flag and redirects with a transient toast. It does not store or change a real secret.

Verification uses `POST /api/auth/verify` with a locally issued token; success marks the fictional user verified and clears the unverified cookie. Missing/invalid tokens expose the native error/resend flow. **Get new verification email** and the waiting page's native **here** button post `/api/auth/request-verify-token`; resend count/mailbox entries change. The waiting page has no invented Back/Cancel control. A verified member returns to `/app`; a logged-out viewer returns to login according to the native guard.

`GET /api/mockshop/auth-anonymous/messages` is the intentionally fake mailbox. Local `/api/mockshop/auth-anonymous/email-link/<verify|reset|join>` links redirect to the finite issued native route. Read the actual issued link; do not construct a token or call the success endpoint to substitute for the UI operation being demonstrated. Resetting the backend removes issued-token/mailbox state unless kept; resetting a browser context separately removes cookies/session storage.

## SSO, referral and auth errors

Provider-choice screens consume the native auth-type DTO. SSO-only hides the password form/footer; mixed mode retains it. Provider buttons disable while authorization is pending. `GET /api/auth/oauth/authorize` and local auth-stage variants return a local fictional authorize/denied-callback URL, not a real identity-provider session. Separate failure, missing-URL and redirect responses produce separate UI states. The native Google link is a link, not a clickable text substitute.

Multitenant SSO discovery exposes `sso-email` and **Continue**, posting `/api/auth/sso/discover`: no matching tenant, request error and found provider are different results. The referral selector is driven by multitenant metadata rather than the compiled Cloud flag. Its native options include search, friend, LinkedIn, Twitter, Hacker News, Reddit, YouTube, podcast, blog, advertisements and other; selection writes a browser referral cookie. Enumerating those options does not establish translated UI coverage.

`/auth/error?error=<code>` displays finite error branches. Corpus codes include OAuth account-exists, bad-login, `access_denied`, `login_required`, `consent_required`, `interaction_required`, `invalid_scope`, `server_error`, and `temporarily_unavailable`. Stale-token/state cases (`ACCESS_TOKEN_DECODE_ERROR`, already-expired and invalid-OAuth-state variants) have a native first-visit login restart guarded by session storage; the second visit remains on the error page with **Return to Login**. First-user auto-signup and sole-SSO auto-redirect also have return/loop guards. Do not remove their storage marker and then call the resulting loop a backend failure.

Cloud support copy and the genuine Cloud Google-denied callback require a physically `enterprise-cloud` build. Its production CSP upgrades insecure requests, and absolute callback behavior requires loopback TLS with a trusted certificate. Disabling CSP or ignoring TLS errors would change the test, not satisfy that prerequisite. Native support `mailto:` is an external handoff; the mock does not send support email. Self-hosted copy is intentionally different.

## Anonymous guest chat

`/anonymous/<configured-path>` posts `/api/tenants/anonymous-user?anonymous_user_path=<path>`, sets the finite anonymous cookie and enters ordinary `/app` chat. Invalid paths return 400 and the native signup/error recovery. **Log In** and **Continue as guest** navigate through their actual modal/entry flow; do not replace it with a fabricated guest UI.

Anonymous chats use the same composer, model/action menus, sources, file handling, edit/regenerate branches, feedback and stop engine as member chats. A smaller profile is a permission/metadata prerequisite, not a second mock chat implementation. Keep transitions can retain anonymous sessions and mailbox/state flags. A fresh backend plus new runner context restores seed conversations, drops generated guest turns and resets auth cookie/storage state. The two reset scripts distinguish same-context backend reset from a fresh-context run; neither is interchangeable with merely clicking New Chat.

## Conditional password and impersonation

The settings **Change Password** control appears only when the source DTO says `password_configured: true`. It opens current/new/confirm inputs. Required/minimum/matching booleans disable **Update**; not every invalid state has a visible validation sentence in this pin. `POST /api/password/change-password` returns finite pending/error/success and updates a mock flag only. With `password_configured: false`, the control is absent; do not add it through a demo overlay.

`/auth/impersonate` has a native superuser guard. Logged-out and ordinary members must remain protected. Its required email and deliberately fictional API-key field submit a Bearer request to `POST /api/tenants/impersonate`; success narrowly changes the mock viewer/email and native settings readback. It is not a real administrative credential, tenant access grant or security bypass. State that boundary when showing the form.

## Provider callbacks

| Native route | Operation and prerequisites | Visible result / limitations |
| --- | --- | --- |
| `/federated/oauth/callback` | `POST /api/federated/callback` with actual code/state query data. | Missing/canceled, validation, missing client-secret, OAuth and generic failures; delayed processing and receipt/countdown return; **Back to Chat**. No live federated OAuth. |
| `/mcp/oauth/callback` | `POST /api/mcp/oauth/callback`. | Expired state, timeout, exchange/server/generic errors; successful receipt has `server_id`, `server_name`, `message`, `redirect_url`; Continue/automatic local return. No external tool authorization. |
| `/oauth-config/callback` | `POST /api/oauth-config/callback`. | Missing/canceled/body/generic errors, pending state, service receipt and local countdown return. This is separate from MCP and personal connectors. |
| Local personal-connector connect landing | Read-only GET, explicit fake-connect POST. | Only the POST mutates connected status; prefetching/opening the landing must not connect. |
| Craft connection callback | Craft-specific finite connection response. | See [Craft app connections](script-craft.md#app-connections-and-callbacks); not interchangeable with these callbacks. |

Wait for the pending state when documenting it, then the receipt/error. A scheduled countdown can navigate before a screenshot; capture deliberately or use its real immediate-return control. Do not swallow a failed provider response and claim a working connection.

## OAuth consent and protected states

`/oauth-provider/authorize?request=<id>` requires the finite request identifier (the corpus uses valid 43-character cases). `GET /api/oauth-provider/consent` returns a local client name and scopes. **Allow access** and **Deny** post the same route with `request_id`, `csrf_token` and `decision`, then navigate to a local result receipt. The buttons disable while pending; staged failures preserve their native disabled/error behavior rather than automatically retrying.

Protected branches matter: 401 goes to sign-in with a preserved `next`, 403 is forbidden, 404 is unavailable with no Retry, and a staged 503 exposes native Retry which can recover once. Missing/invalid request IDs follow the native not-found/login behavior. Logged-out protection must be exercised through the native route, not a screenshot of a member's consent dialog. These local disclosures/receipts do not implement real OAuth token issuance or third-party authorization.

## New-tab extension surface

`/nrf` is the new-tab surface over the same chat engine. Its settings button is the pinned `.absolute.top-0.end-0.p-4 button`; switching the new-tab preference off opens a confirmation. **Cancel** preserves it; **Turn Off** updates the native `localStorage` preference (the source uses a `useOnyx…` key). Backend fresh reset does not clear this browser key. Background/theme and user preferences share their normal stores; the extension is not a second user profile. `user-prompt` query data prefills the native composer.

The extension model picker supports search/no matches, **Add Model** and removable local model chips via `.interactive-foreground-icon`. Multiple selected labels are not proof of parallel real model execution. **Internal Search** opens native action/source controls; search-mode behavior is the same finite retrieval contract as [chat search](script-chat.md#search-mode-and-filters). File upload/preview uses the same catalog and native inputs.

With no configured provider, the composer is disabled and **Setup LLM** navigates to the real admin route. Logged-out entry uses the native protected/blank-login flow; there is no invented extension-specific login form. The corpus identifies native frontend patches needed for pointer/branch parity; a physical Community build lacking them cannot be certified by staging Enterprise metadata.

## Side-panel trust, turns and reset

`/nrf/side-panel` has compact **New Chat**/**Open Onyx** controls and no Settings button. **Read This Tab** moves from off to a waiting/reading state and can be disabled until the native flow resets it. Its message bridge checks both a `chrome-extension://` origin and `event.source === window.parent`. Direct HTTP-page `postMessage` is expected to be rejected. `PATCH /api/mockshop/browser-extension/context` can stage fictional tab context for the backend, but that is **not proof that the trusted-parent bridge accepted a message**.

A genuine bridge demonstration needs a disposable local extension parent with only the intended localhost permission. Do not spoof origin checks, install a live extension, or claim trusted-parent success from direct script dispatch. The historical corpus records this distinction explicitly.

Finite `POST /api/mockshop/browser-extension/outcome` with `{ "fail": true }` yields the native error packet/stacktrace; **Regenerate** recovers through a subsequent finite answer. Stop retains a partial answer, and edit/branch controls must use the native controller/callback implementation rather than replacing rendered message text. Reset clears backend staged tab/error/chat state; clearing the browser context separately restores new-tab preferences and trust-related client state.
