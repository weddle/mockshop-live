// #34: native conditional UI staging only; no provider, credential store or identity engine.
// Auth69 owns identity/cookies; this module retains only finite fictional receipts.
export default function createUserConditional(core, { stageMember }) {
  const content = () => core.fixture("GET", "/mockshop/user-conditional/content");
  const enabled = () => core.data("state")?.user_conditional?.staging?.enabled === true;
  const webOrigin = `http://127.0.0.1:${core.plugin.ports.web}`;
  let run;
  const reset = (body = {}) => { if (!body.keep) run = undefined; };
  const local = () => run ||= { callbacks: {}, consents: {}, retryRecovered: false, impersonated: false, passwordChanged: false };
  const fake = (extra = {}) => ({ simulated: true, label: content().label, ...extra });
  const scoped = (handle) => async (ctx) => enabled() ? handle(ctx) : false;
  const pause = async (milliseconds = 0) => { if (milliseconds) await new Promise((resolve) => setTimeout(resolve, milliseconds)); };
  const fail = (ctx, status, detail) => ctx.send(status, { detail, ...fake() });
  // Only native local return paths from editable fixtures, never an external host.
  const destination = (path) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
      throw new Error("Conditional fixture return target must be a same-origin path");
    const target = new URL(path, webOrigin);
    if (target.origin !== webOrigin) throw new Error("Conditional fixture return target changed origin");
    return target;
  };
  const callback = (kind) => scoped(async (ctx) => {
    const s = local(), c = content(), entry = c.callbacks[kind].cases[ctx.query.code];
    if (ctx.query.state !== c.callback_state || !entry) return fail(ctx, 400, c.messages.callback_invalid);
    await pause(entry.delay_ms);
    if (entry.status !== 200) return ctx.send(entry.status, { ...entry.body, ...fake() });
    const receipt = { ...c.callbacks[kind].receipt, ...fake() };
    receipt.redirect_url = destination(receipt.redirect_url).pathname;
    s.callbacks[kind] = true;
    ctx.send(200, receipt, { "cache-control": "no-store" });
  });
  return {
    reset,
    routes: [
      { method: "GET", path: "/mockshop/user-conditional/receipts", handle: scoped((ctx) => ctx.send(200, fake(local()), { "cache-control": "no-store" })) },
      ...["federated", "mcp/oauth", "oauth-config"].map((kind) => ({ method: "POST", path: `/${kind}/callback`, handle: callback(kind) })),
      { method: "GET", path: "/oauth-provider/consent", handle: scoped(async (ctx) => {
        const s = local(), c = content(), entry = c.consent.requests[ctx.query.request];
        if (!entry) return fail(ctx, 404, c.messages.consent_unavailable);
        await pause(entry.delay_ms);
        if (entry.status !== 200 && !(entry.retry_once && s.retryRecovered)) {
          if (entry.retry_once) s.retryRecovered = true;
          return fail(ctx, entry.status, c.messages.consent_unavailable);
        }
        ctx.send(200, { ...c.consent.info, redirect_origin: webOrigin }, { "cache-control": "no-store" });
      }) },
      { method: "POST", path: "/oauth-provider/consent", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local(), c = content(), entry = c.consent.requests[b.request_id];
        if (!entry || (entry.status !== 200 && !(entry.retry_once && s.retryRecovered)) || b.csrf_token !== c.consent.info.csrf_token || !["allow", "deny"].includes(b.decision))
          return fail(ctx, 400, c.messages.consent_unavailable);
        await pause(entry.submit_delay_ms);
        if (entry.submit_failure) return fail(ctx, 400, c.messages.consent_failed);
        const target = destination(c.consent.return_path);
        target.searchParams.set("conditional_decision", b.decision);
        s.consents[b.request_id] = b.decision;
        ctx.send(200, { redirect_url: target.toString(), ...fake() }, { "cache-control": "no-store" });
      }) },
      { method: "POST", path: "/tenants/impersonate", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local(), c = content();
        await pause(c.form_delay_ms);
        if (b.email !== c.impersonate_email || ctx.req.headers.authorization !== `Bearer ${c.demo_key}`)
          return fail(ctx, 400, c.messages.impersonate_failed);
        const headers = stageMember(b.email);
        if (!headers) return fail(ctx, 400, c.messages.impersonate_failed);
        s.impersonated = true;
        ctx.send(200, fake({ email: b.email }), headers);
      }) },
      { method: "POST", path: "/password/change-password", handle: scoped(async (ctx) => {
        const b = await ctx.body(), s = local(), c = content();
        await pause(c.form_delay_ms);
        // Compare only fixed fictional placeholders and retain a boolean, never submitted passwords.
        if (b.old_password !== (s.passwordChanged ? c.new_demo_input : c.old_demo_input) || b.new_password !== c.new_demo_input)
          return fail(ctx, 400, c.messages.password_failed);
        s.passwordChanged = true;
        ctx.send(200, fake({ password_changed: true }));
      }) },
    ],
  };
}
