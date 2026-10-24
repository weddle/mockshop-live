// #69: local fictional form staging only. No password storage, email, provider or session engine.
// Parent composes routes first, currentUser LAST over its existing /me transform, and reset(body).
export default function createAuthAnonymousHandlers(core, options = {}) {
  const flags = () => core.data("state")?.auth_anonymous;
  // A world's state.auth_anonymous.content is sparse: it deep-merges over the seeded content (objects merge, anything else replaces),
  // so a capability variant only states the identities/messages it needs.
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => (isObject(a) && isObject(b) ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, k in b ? merge(a[k], b[k]) : a[k]])) : b);
  const content = () => merge(core.fixture("GET", "/mockshop/auth-anonymous/content"), flags()?.content || {});
  const staging = () => flags()?.staging || {};
  const enabled = () => staging().enabled === true;
  const webOrigin = options.webOrigin || `http://127.0.0.1:${core.plugin.ports.web}`;
  const cookie = (clear = false) => ({
    "set-cookie": `fastapiusersauth=${clear ? "" : "mockshop-local-demo"}; Path=/; SameSite=Lax${clear ? "; Max-Age=0" : ""}`,
    "cache-control": "no-store",
  });
  let run;
  const reset = (body = {}) => { if (!body.keep) run = undefined; };
  const local = () => run ||= {
    mode: staging().mode || "logged-out", email: content().email,
    registered: new Set([content().email]), mailbox: [], verifyIssued: false,
    resetIssued: false, resetComplete: false, verified: false, emailFailure: false,
    authProfile: null, authorizeOutcome: "redirect", discoveryOutcome: "providers",
  };
  const fake = (extra = {}) => ({ simulated: true, label: content().label, ...extra });
  const error = (ctx, key, status = 400) => ctx.send(status, { detail: content().messages[key], ...fake() });
  const emailLink = (kind) => `/api/mockshop/auth-anonymous/email-link/${kind}`;
  const issue = (kind, email) => {
    const s = local();
    s[kind === "verify" ? "verifyIssued" : "resetIssued"] = true;
    if (kind === "reset") s.resetComplete = false;
    s.mailbox.push(fake({ kind, email, subject: content().messages[`${kind}_subject`], href: emailLink(kind) }));
  };
  const scoped = (handle) => async (ctx) => enabled() ? handle(ctx) : false;
  const authType = () => ({
    ...core.fixture("GET", "/auth/type"),
    ...(content().auth_profiles?.[local().authProfile] || {}),
  });
  const authorize = async (ctx) => {
    const destination = `${webOrigin}/auth/error?error=access_denied`;
    await new Promise((resolve) => setTimeout(resolve, content().authorize_delay_ms));
    if (ctx.query.redirect === "true") return ctx.send(302, fake(), { location: destination, "cache-control": "no-store" });
    if (local().authorizeOutcome === "failure") return error(ctx, "authorize_error");
    ctx.send(200, local().authorizeOutcome === "missing" ? fake() : fake({ authorization_url: destination }));
  };
  // Fictional identity names are defaults; the existing settings owner's saved edits win.
  const currentUser = (val, savedPersonalization = {}) => {
    if (!enabled()) return val;
    const s = local();
    if (s.mode === "logged-out") return { __status: 401, __body: { detail: "Unauthorized", ...fake() }, __headers: cookie(true) };
    // Preserve settings/onboarding decoration from the parent; replace only this fake identity.
    return { ...val, id: s.mode === "anonymous" ? "mockshop-workshop-visitor" : "mockshop-workshop-learner",
      email: s.email, is_active: true, is_verified: s.mode !== "unverified", is_anonymous_user: s.mode === "anonymous",
      role: "basic", account_type: "STANDARD", is_admin: false, is_superuser: false,
      is_cloud_superuser: staging().impersonation_superuser === true && s.mode === "member" && s.email === content().email,
      is_group_manager: false, admin_capabilities: [], effective_permissions: ["basic"],
      password_configured: s.mode !== "anonymous", team_name: content().team, tenant_info: null,
      personalization: { ...val?.personalization,
        name: s.mode === "anonymous" ? content().guest_name : content().name, ...savedPersonalization },
    };
  };
  // Conditional34 reuses this sole fake member identity and cookie, never a second session store.
  const stageMember = (email) => {
    if (!enabled() || (email !== content().email && email !== content().join_email)) return null;
    const s = local();
    s.mode = "member";
    s.email = email;
    return cookie();
  };
  return {
    currentUser,
    stageMember,
    reset,
    transform: {
      "GET /me": currentUser,
      "GET /settings": (val) => enabled() ? { ...val, anonymous_user_enabled: true } : val,
    },
    routes: [
      // Clearing the runner's synthetic cookie must happen in the browser through /api, not a new harness.
      { method: "POST", path: "/mockshop/auth-anonymous/stage", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local();
        if (["logged-out", "unverified", "member", "anonymous"].includes(b.mode)) s.mode = b.mode;
        if (b.email === content().email || b.email === content().join_email) s.email = b.email;
        if (typeof b.email_failure === "boolean") s.emailFailure = b.email_failure;
        if (b.auth_profile === null || Object.hasOwn(content().auth_profiles, b.auth_profile)) s.authProfile = b.auth_profile;
        if (["redirect", "missing", "failure"].includes(b.authorize_outcome)) s.authorizeOutcome = b.authorize_outcome;
        if (["providers", "empty", "failure"].includes(b.discovery_outcome)) s.discoveryOutcome = b.discovery_outcome;
        ctx.send(200, fake({ mode: s.mode }), cookie(s.mode === "logged-out"));
      }) },
      // Source-authored metadata choices and local authorize outcomes only; never contact an IdP.
      { method: "GET", path: "/auth/type", handle: scoped((ctx) => ctx.send(200, authType())) },
      { method: "GET", path: "/mockshop/auth-anonymous/authorize/:provider", handle: scoped(authorize) },
      { method: "GET", path: "/auth/oauth/authorize", handle: scoped(authorize) },
      { method: "POST", path: "/auth/sso/discover", handle: scoped(async (ctx) => {
        const b = await ctx.body();
        if (local().discoveryOutcome === "failure") return error(ctx, "discovery_error");
        const providers = local().discoveryOutcome === "empty" || b.email !== content().email
          ? [] : content().auth_profiles.mixed.sso_providers;
        ctx.send(200, { providers });
      }) },
      { method: "GET", path: "/mockshop/auth-anonymous/messages", handle: scoped((ctx) => {
        const s = local();
        ctx.send(200, fake({ mode: s.mode, messages: s.mailbox, verified: s.verified, reset_complete: s.resetComplete }), { "cache-control": "no-store" });
      }) },
      { method: "GET", path: "/mockshop/auth-anonymous/email-link/:kind", handle: scoped((ctx) => {
        const kind = ctx.params.kind, s = local();
        if (kind === "join") return ctx.send(302, fake(), {
          location: `${webOrigin}/auth/join?email=${encodeURIComponent(content().join_email)}&team=${encodeURIComponent(content().team)}&next=%2Fapp`,
          "cache-control": "no-store",
        });
        if (kind !== "verify" && kind !== "reset") return error(ctx, "email_error", 404);
        if (!s[kind === "verify" ? "verifyIssued" : "resetIssued"]) return error(ctx, "email_error", 404);
        const route = kind === "verify" ? "verify-email" : "reset-password";
        ctx.send(302, fake(), { location: `${webOrigin}/auth/${route}?token=${encodeURIComponent(content()[`${kind}_token`])}`, "cache-control": "no-store" });
      }) },
      // Native Account Not Found uses /api/register after approved narrow patch0004; never an org service.
      { method: "GET", path: "/register", handle: scoped((ctx) => ctx.send(302, fake(), {
        location: `${webOrigin}/auth/signup`, "cache-control": "no-store",
      })) },
      { method: "POST", path: "/auth/login", handle: scoped(async (ctx) => {
        const body = await ctx.body();
        const b = body._raw == null ? body : Object.fromEntries(new URLSearchParams(body._raw));
        const s = local(), email = String(b.username || "").toLowerCase();
        if (!s.registered.has(email) || b.password !== content().demo_input) return error(ctx, "login_error");
        s.email = email; s.mode = "member";
        ctx.send(200, fake(), cookie());
      }) },
      { method: "POST", path: "/auth/register", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local(), email = String(b.email || "").toLowerCase();
        if (email !== content().email && email !== content().join_email) return error(ctx, "register_error");
        if (b.password !== content().demo_input) return error(ctx, "password_error");
        if (s.registered.has(email)) return ctx.send(400, { detail: "REGISTER_USER_ALREADY_EXISTS", ...fake() });
        s.registered.add(email); s.email = email;
        s.mode = authType().requires_verification ? "unverified" : "member";
        ctx.send(201, currentUser(core.fixture("GET", "/me")), cookie());
      }) },
      { method: "POST", path: "/auth/request-verify-token", handle: scoped(async (ctx) => {
        const b = await ctx.body();
        if (local().emailFailure || !local().registered.has(b.email)) return error(ctx, "email_error");
        issue("verify", b.email);
        ctx.send(202, fake({ message: content().messages.verify_subject }));
      }) },
      { method: "POST", path: "/auth/verify", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local();
        if (b.token !== content().verify_token || !s.verifyIssued) return error(ctx, "verify_error");
        s.verified = true; s.verifyIssued = false; s.mode = "logged-out";
        ctx.send(200, fake({ verified: true }), cookie(true));
      }) },
      { method: "POST", path: "/auth/forgot-password", handle: scoped(async (ctx) => {
        const b = await ctx.body();
        if (local().emailFailure || b.email === content().error_email) return error(ctx, "email_error");
        // Stage links only for fictional workshop addresses; never accept real recipient data.
        if (b.email !== content().email && b.email !== content().join_email) return error(ctx, "email_error");
        issue("reset", b.email);
        ctx.send(202, fake({ message: content().messages.reset_subject }));
      }) },
      { method: "POST", path: "/auth/reset-password", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local();
        if (b.token !== content().reset_token || !s.resetIssued) return error(ctx, "reset_error");
        if (b.password !== content().demo_input) return ctx.send(400, {
          detail: { code: "RESET_PASSWORD_INVALID_PASSWORD", reason: content().messages.password_error }, ...fake(),
        });
        s.resetComplete = true; s.resetIssued = false; s.mode = "logged-out";
        ctx.send(200, fake({ reset_complete: true }), cookie(true));
      }) },
      { method: "POST", path: "/auth/logout", handle: scoped((ctx) => {
        local().mode = "logged-out";
        ctx.send(200, fake(), cookie(true));
      }) },
      { method: "POST", path: "/tenants/anonymous-user", handle: scoped((ctx) => {
        if (ctx.query.anonymous_user_path !== content().anonymous_path) return error(ctx, "register_error");
        local().mode = "anonymous";
        ctx.send(200, fake({ anonymous_user_path: content().anonymous_path }), cookie());
      }) },
    ],
  };
}
