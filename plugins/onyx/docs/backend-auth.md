# Authentication, anonymous and conditional flows

[API map](../API-MAP.md) · [Runtime/edition/locale](backend-runtime.md) · [Admin users/SSO](backend-admin.md)

Owners: `handlers-auth-anonymous.mjs` and `handlers-user-conditional.mjs`. These are local fictional **form-state machines**, not real password/session/email/OAuth/SSO services. Source-derived contract; no account or identity-provider verification was performed.

## Identity ownership and required content

Auth routes return `false` when `GET /mockshop/auth-anonymous/staging.enabled !== true`, allowing fixture/fallback dispatch. Neutral base has staging disabled. Conditional routes have their own enabled flag. A fixture `/me` 401 envelope is preserved by root before normal user decoration, so use the supported Auth mode machine when demonstrating transitions rather than an unconditionally unauthorized fixture that masks them.

Auth content `GET /mockshop/auth-anonymous/content` must supply:

| Fields | Meaning |
|---|---|
| `label,email,join_email,error_email,name,guest_name,team` | Explicit fictional cast. Primary email initially registered; join_email can be newly registered. |
| `demo_input,verify_token,reset_token,anonymous_path` | Fixed harmless comparison strings only; never real passwords/tokens. |
| `authorize_delay_ms` | Delay before local authorize outcome. |
| `auth_profiles` | Named overrides merged into raw `/auth/type`; native metadata fields e.g. multi_tenant,password_auth_enabled,sso_providers,has_users. Mixed profile's providers specifically supply discover response. |
| `messages` | `login_error,register_error,email_error,verify_error,reset_error,password_error,authorize_error,discovery_error,verify_subject,reset_subject`. Human text is authored here. |

Staging optional `mode` defaults logged-out; `impersonation_superuser:true` makes primary-email member display `is_cloud_superuser:true`. Other mode fields are written through stage endpoint, not arbitrary fixture query parameters.

Lazy Auth `run={mode,email,registered:Set([content.email]),mailbox:[],verifyIssued:false,resetIssued:false,resetComplete:false,verified:false,emailFailure:false,authProfile:null,authorizeOutcome:"redirect",discoveryOutcome:"providers"}`. Fresh or world-change reset clears; same-world keep retains. Cookie on transition:
`fastapiusersauth=mockshop-local-demo; Path=/; SameSite=Lax`; logout uses empty value plus `Max-Age=0`; responses also `cache-control:no-store`. Cookie is neither an OAuth access token nor proof of authorization. Normal runner baseline sets its own synthetic cookie; backend reset by itself does not clear browser cookies.

Root applies `currentUser()` **last** to `/me`:

| Mode | `/me` projection |
|---|---|
| logged-out | `__status:401,__body:{detail:"Unauthorized",simulated:true,label},__headers` clearing cookie |
| anonymous | ID `mockshop-workshop-visitor`, is_anonymous_user:true, password_configured:false, guest name |
| unverified | ID `mockshop-workshop-learner`, is_verified:false, member-name defaults |
| member | Same learner ID, is_verified:true, password_configured:true |

All enabled nonlogged-out modes use selected fictional email, is_active:true, role:basic, account_type:STANDARD, is_admin/is_superuser:false, is_group_manager:false, admin_capabilities:[], effective_permissions:[basic], team_name, tenant_info:null. Saved personalization overlays win over fictional name defaults. Registered email identity is not joined into Admin Users automatically. `GET /settings` forces anonymous_user_enabled:true when enabled, then later admin settings override may win; `/auth/type` still follows its own metadata.

## Exact Auth operations

Except noted statuses/redirects, success200 with `{simulated:true,label,...}`. Error helper adds same metadata to `{detail:content.messages[key]}`, normally400.

| Native action / route | Input | Actual mutation / output |
|---|---|---|
| Stage UI state: `POST /mockshop/auth-anonymous/stage` | `{mode?,email?,email_failure?,auth_profile?,authorize_outcome?,discovery_outcome?}` | Only mode logged-out/unverified/member/anonymous; email primary/join; boolean email_failure; null or known profile; authorize redirect/missing/failure; discovery providers/empty/failure accepted. Unknown choices ignored. Returns `{mode,...fake}` with cookie reflecting mode. Does not clear registered/mailbox flags. |
| Read auth metadata: `GET /auth/type` | — | Raw seed + selected profile; does not infer metadata from Admin SSO/security saves. |
| OAuth/SSO entry: `GET /auth/oauth/authorize`, `GET /mockshop/auth-anonymous/authorize/:provider` | `?redirect=true` optional | Waits authorize_delay_ms; destination always same-origin `/auth/error?error=access_denied`. redirect=true returns302 Location before outcome check. Otherwise failure→400 authorize_error; missing→fake object with no authorization_url; redirect→`{authorization_url,...fake}`. No successful real OAuth login. |
| Discovery: `POST /auth/sso/discover` | `{email}` | Staged failure400; otherwise only exact primary email + providers outcome returns `content.auth_profiles.mixed.sso_providers`; all others `{providers:[]}`. No domain discovery service. |
| Login: `POST /auth/login` | Native URL-encoded `{username,password}` or equivalent JSON | Lowercases username, checks registered set and exact demo_input; mismatch400 login_error. Sets email/member, returns fake receipt + cookie. Password not stored. |
| Signup/join: `POST /auth/register` | `{email,password,...}` | Lowercases email; only primary/join allowed, password fixed; errors400. Already registered400 `{detail:"REGISTER_USER_ALREADY_EXISTS",...fake}`. Adds email, selects unverified if current auth_type.requires_verification else member;201 projected user + cookie. |
| Account Not Found CTA: `GET /register` | — |302 same-origin `/auth/signup`; patch0004 changes upstream account-creation link to `/api/register` rather than remote registration service. |
| Send verification email: `POST /auth/request-verify-token` | `{email}` | emailFailure or unregistered→400 email_error. Sets verifyIssued, appends mailbox entry;202 `{message:verify_subject,...fake}`. No delivery. |
| Verify: `POST /auth/verify` | `{token}` | Exact token + issued flag required400; sets verified:true,verifyIssued:false,mode:logged-out;200 `{verified:true,...fake}` + cleared cookie. |
| Forgot Password: `POST /auth/forgot-password` | `{email}` | emailFailure/error_email/nonfictional email→400; primary/join only; sets resetIssued,resetComplete:false; appends mailbox entry;202 `{message:reset_subject,...fake}`. Does not require email registered. |
| Reset Password: `POST /auth/reset-password` | `{token,password}` | Exact issued token required400 reset_error; wrong password400 `{detail:{code:"RESET_PASSWORD_INVALID_PASSWORD",reason:password_error},...fake}`. Success resetComplete:true,resetIssued:false,mode:logged-out, cleared cookie. Still no stored credential; future login still compares demo_input. |
| Logout: `POST /auth/logout` | — | mode logged-out, cookie cleared; fake receipt. |
| Anonymous entry: `POST /tenants/anonymous-user` | `?anonymous_user_path=<content.anonymous_path>` | Mismatch400 register_error; sets mode anonymous, returns `{anonymous_user_path,...fake}` + cookie. Existing selected email remains. |
| Local mailbox: `GET /mockshop/auth-anonymous/messages` | — | `{mode,messages:mailbox,verified,reset_complete,...fake}`, no-store. Mailbox rows `{kind,email,subject,href,simulated,label}`. |
| Open local email: `GET /mockshop/auth-anonymous/email-link/:kind` | `kind=join|verify|reset` | join→302 `/auth/join?email=<join>&team=<team>&next=%2Fapp` even without issue. verify/reset require corresponding issued flag, else404;302 native `/auth/verify-email?token=...` or `/auth/reset-password?token=...`. Unknown kind404 email_error. |

The local email link does not consume a token; successful POST verify/reset does. Stage member can bypass native login for another scene but is explicitly UI staging, not evidence signup/verification was performed. Forgot/reset native pages require build flag `NEXT_PUBLIC_FORGOT_PASSWORD_ENABLED=true` (manifest sets it for every edition). Cloud/SSO UI also has native metadata/edition gates; changing an API seed alone cannot bypass compiled gates.

`POST /auth/refresh` is a separate neutral `{}` fixture-only no-op; it does not extend Auth state. `GET /tenants/anonymous-user` is also a static `{}` fixture, distinct from enabled POST.

## Conditional flows

`GET /mockshop/user-conditional/staging.enabled:true` activates these routes. Content `/mockshop/user-conditional/content`:

- `label,callback_state,demo_key,impersonate_email,old_demo_input,new_demo_input,form_delay_ms`.
- `messages:{callback_invalid,consent_unavailable,consent_failed,impersonate_failed,password_failed}`.
- `callbacks` keyed exactly `federated`, `oauth-config`, `mcp/oauth`, each `{receipt,cases:{<code>:{status,delay_ms?,body?}}}`.
- `consent:{return_path,info:{client_name,redirect_origin,account_email,workspace_name,scopes,csrf_token},requests:{<opaque request>:{status,delay_ms?,submit_delay_ms?,submit_failure?,retry_once?}}}`.

Neutral base includes blank case skeletons with status0 and placeholder opaque requests. They are **not usable enabled flows**; populate real HTTP status/receipt/detail values before enabling. Lazy local state `{callbacks:{},consents:{},retryRecovered:false,impersonated:false,passwordChanged:false}`; same reset policy as Auth. It stores receipts/booleans, not a second identity/credential engine.

### Callback APIs

| Exact route | Request and response |
|---|---|
| `POST /federated/callback` | Query `?code=<case>&state=<callback_state>`; success receipt normally `{source,redirect_url,simulated,label}`. |
| `POST /oauth-config/callback` | Same query; receipt `{service_name,redirect_url,simulated,label}`. |
| `POST /mcp/oauth/callback` | Same query; receipt `{success,server_id,server_name,message,redirect_url,simulated,label}`. This route precedes other handlers and is independent from admin `/admin/mcp/oauth/connect`. |

Wrong state/unknown case400 callback_invalid. Wait case delay. If status !==200, return exact configured status and `{...case.body,simulated,label}` with no success receipt; errors may use `detail` or `error` according to native consumer. On200, validate redirect_url as **same-origin relative path**: must begin `/`, not `//`, no backslash, resolved origin unchanged. Receipt returns only destination pathname (query stripped), marks callbacks[kind]=true and no-store. Invalid fixture return path throws core500 rather than redirecting externally. Callback success does not itself connect Personal Connectors, MCP or OpenAPI credentials; those stores are separate.

### Consent, impersonation and change-password

| Route / native action | Input → behavior |
|---|---|
| `GET /oauth-provider/consent` | `?request=<opaque seeded ID>`; unknown404 consent_unavailable; delay; configured non200 returned unless retry_once already recovered. First retry_once failure flips one global retryRecovered boolean; later reads succeed with consent.info and redirect_origin forced local web origin. It is not per-request retry tracking. |
| `POST /oauth-provider/consent` | `{request_id,csrf_token,decision:"allow"|"deny"}`; known/status-valid or recovered request + exact CSRF token required, else400. Wait submit_delay_ms; submit_failure400 consent_failed. Save consents[request]=decision; return `{redirect_url:<absolute same-origin return_path + conditional_decision>,simulated,label}`, no-store. No OAuth grant/token created; `/oauth-provider/grants` remains User Settings' separate seeded store. |
| `POST /tenants/impersonate` | `{email}` + header `Authorization: Bearer <demo_key>`; exact configured email/key required400 after form_delay_ms. Calls Auth `stageMember(email)`, which requires Auth enabled and email primary/join; if refused400. Success impersonated:true and Auth member cookie, `{email,simulated,label}`. No real impersonation privileges. |
| `POST /password/change-password` | `{old_password,new_password}`; old must equal old_demo_input until first success, then new_demo_input; new always equals new_demo_input. Mismatch400; otherwise passwordChanged:true, `{password_changed:true,simulated,label}`. No submitted password retained. Auth login/reset still uses its independent demo_input. |
| `GET /mockshop/user-conditional/receipts` | `{callbacks,consents,retryRecovered,impersonated,passwordChanged,simulated,label}`, no-store. |

The conditional handler does not check `/me.is_cloud_superuser` before impersonate; that field stages native visibility, while endpoint validates only explicit fake header/email and Auth availability. Consent decision does not pause/connect actual provider flows. These boundaries must be stated when showing successful buttons.

## Staging recipes without private samples

### Signup → local verify → login

1. In world native fixtures enable Auth staging with mode logged-out, fill content emails/names/demo_input/tokens/messages and `/auth/type.requires_verification:true,password_auth_enabled:true`. Use reserved fictional addresses. Keep primary already registered and join distinct.
2. Navigate native signup and submit join email/demo_input. Expected201 creates unverified identity and cookie; `/me.is_verified:false` drives verify screen.
3. Native resend/request issues local mailbox row; read `/api/mockshop/auth-anonymous/messages`, then use its same-origin `href` to open native verify-email page. No email was sent.
4. Native verify POST clears cookie/logs out; login with same fake input creates member mode. For repeatability fresh backend reset reinitializes registered set and issued flags; browser lifecycle/cookie cleanup is a separate script action.

### Controlled SSO failure variants

Select auth_profile using stage endpoint; author each provider descriptor exactly as native `/auth/type` expects. Set authorize_outcome failure for HTTP400, missing for200 lacking required field, redirect for local access_denied navigation. For native direct redirect query, redirect=true always takes302 path regardless staged failure. Discover only returns mixed profile providers for primary email. Assert actual route/response/error surface, not “SSO authenticated.”

### Callback or consent success/error/retry

Enable Conditional with complete case bodies and allowed local redirect. Author explicit code/status pair for success and each error consumer (`detail` vs `error`), pass exact callback_state in URL, and navigate native callback page. Verify receipts only after UI request. Consent GET failure with retry_once can recover on retry, while submit_failure is a separate POST error. Return_path must be same-origin and successful decision only records a local choice. Reset between independent retry demos because retryRecovered is global.

### Password and impersonation

Fill fictional placeholders; enable Auth staging and select configured member identity; use native form visibility fields. Conditional password success is a boolean receipt; it cannot validate login under a new arbitrary password. Impersonation target must be one of Auth's two allowed emails and correct configured fake key. Never use production bearer keys/passwords to demonstrate these screens.

## Error-policy and persistence caveats

Intentional 400/401/404/500 responses may be expected UI states but are still real responses visible to the runner. Use script expected-error classifications, not blanket suppression or a success fixture in place of the failure. Core strict501 denotes an unimplemented route, distinct from a deliberately staged failure. Browser cookies/localStorage/cache are not reset by backend state alone. State is process-wide, so simultaneous independent auth demos require separate mock instances.
