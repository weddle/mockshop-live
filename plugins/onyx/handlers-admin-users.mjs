// Native Users UX only. No email, authentication, directory or durable storage writes.
export default function createAdminUsersHandlers(core, composition = {}) {
  let accepted, invited, pending;
  const seeds = () => {
    accepted ??= structuredClone(core.fixture("GET", "/manage/users/accepted/all") || []);
    invited ??= structuredClone(core.fixture("GET", "/manage/users/invited") || []);
    pending ??= structuredClone(core.fixture("GET", "/tenants/users/pending") || []);
    core.state.adminGroupMembers ??= {};
  };
  // A composed Groups factory supplies its real catalog; standalone Users uses existing fixtures.
  const groups = () => composition.listGroups ? composition.listGroups() :
    core.fixture("GET", "/manage/admin/user-group") || [];
  const acceptedUsers = () => {
    seeds();
    for (const user of accepted) {
      if (Object.hasOwn(core.state.adminCraftEnabled || {}, user.email))
        user.craft_enabled = core.state.adminCraftEnabled[user.email];
    }
    return accepted;
  };
  const getUser = (identity) => {
    const users = acceptedUsers();
    const direct = users.find((u) => u.id === identity || u.email === identity);
    if (direct) return direct;
    // base50's legacy u1 and the current Maya UUID identify the same fictional email.
    const alias = (core.fixture("GET", "/manage/admin/user-group") || [])
      .flatMap((g) => g.users || []).find((u) => u.id === identity);
    return alias ? users.find((u) => u.email === alias.email) : undefined;
  };
  const members = (group) => {
    seeds();
    return (core.state.adminGroupMembers[group.id] ?? group.users ?? []).map((member) => {
      const user = getUser(member.id) || getUser(member.email);
      return user ? { ...member, id: user.id, email: user.email } : member;
    });
  };
  const belongs = (user, group) => members(group).some((m) => m.id === user.id || m.email === user.email);
  const rows = () => acceptedUsers().map((user) => ({ ...user, groups: groups().filter((g) => belongs(user, g))
    .map(({ id, name }) => ({ id, name })) }));
  const userList = (value) => Array.isArray(value) ? rows() : {
    ...value, accepted: rows(), invited,
    accepted_pages: accepted.length ? 1 : 0, invited_pages: invited.length ? 1 : 0,
  };
  const counts = () => {
    seeds();
    const account_type_counts = {}, status_counts = { active: 0, inactive: 0 };
    for (const user of accepted) {
      account_type_counts[user.account_type] = (account_type_counts[user.account_type] || 0) + 1;
      status_counts[user.is_active ? "active" : "inactive"]++;
    }
    return { account_type_counts, status_counts };
  };
  const metadata = () => core.fixture("GET", "/manage/users/mock-feedback");
  const userWrite = (path, method, edit) => ({ method, path, async handle(ctx) {
    seeds();
    const body = await ctx.body();
    const user = accepted.find((u) => u.email === body.user_email);
    if (!user) return ctx.send(404, { detail: "Fictional user not found." });
    edit(user, body);
    ctx.send(200, {});
  } });
  return {
    // These readers expose this module's actual in-run Users, not a second store.
    acceptedUsers,
    getUser,
    listGroups: groups,
    groupMembers: members,
    reset(body = {}) {
      if (!body.keep) { accepted = invited = pending = undefined; core.state.adminGroupMembers = {}; }
    },
    routes: [
      { method: "GET", path: "/manage/users/accepted/all", handle(ctx) { ctx.send(200, rows()); } },
      { method: "GET", path: "/manage/users", handle(ctx) {
        seeds(); ctx.send(200, userList(core.fixture("GET", "/manage/users")));
      } },
      { method: "GET", path: "/manage/users/invited", handle(ctx) { seeds(); ctx.send(200, invited); } },
      { method: "GET", path: "/tenants/users/pending", handle(ctx) { seeds(); ctx.send(200, pending); } },
      { method: "GET", path: "/manage/users/counts", handle(ctx) { ctx.send(200, counts()); } },
      { method: "PUT", path: "/manage/admin/users", async handle(ctx) {
        seeds();
        const { emails = [] } = await ctx.body(), added = [];
        for (const email of emails) {
          if (!invited.some((u) => u.email === email) && !accepted.some((u) => u.email === email)) {
            invited.push({ email });
            added.push(email);
          }
        }
        ctx.send(200, { ...metadata(), invited: added });
      } },
      { method: "PATCH", path: "/manage/admin/remove-invited-user", async handle(ctx) {
        seeds(); const body = await ctx.body();
        invited = invited.filter((u) => u.email !== body.user_email);
        ctx.send(200, {});
      } },
      { method: "POST", path: "/tenants/users/invite/approve", async handle(ctx) {
        seeds(); const { email } = await ctx.body();
        pending = pending.filter((u) => u.email !== email);
        if (!invited.some((u) => u.email === email)) invited.push({ email });
        ctx.send(200, metadata());
      } },
      userWrite("/manage/admin/deactivate-user", "PATCH", (u) => { u.is_active = false; }),
      userWrite("/manage/admin/activate-user", "PATCH", (u) => { u.is_active = true; }),
      userWrite("/manage/admin/users/admin-access", "PATCH", (u, body) => { u.is_admin = body.is_admin; }),
      userWrite("/manage/admin/delete-user", "DELETE", (u) => {
        accepted = accepted.filter((row) => row.id !== u.id);
        for (const group of groups()) core.state.adminGroupMembers[group.id] = members(group)
          .filter((m) => m.id !== u.id && m.email !== u.email);
      }),
      { method: "POST", path: "/password/reset_password", async handle(ctx) {
        seeds(); const { user_email } = await ctx.body();
        const user = accepted.find((u) => u.email === user_email);
        if (!user) return ctx.send(404, { detail: "Fictional user not found." });
        ctx.send(200, { user_id: user.id, new_password: metadata().reset_password, simulated: true });
      } },
      { method: "GET", path: "/manage/users/download", handle(ctx) {
        ctx.send(200, "email,account_type,is_admin,is_active\n" + rows().map((u) =>
          [u.email, u.account_type, u.is_admin, u.is_active].join(",")).join("\n"), { "content-type": "text/csv" });
      } },
      { method: "POST", path: "/manage/admin/user-group/:id/add-users", async handle(ctx) {
        seeds(); const { user_ids = [] } = await ctx.body();
        if (composition.ownsGroupWrites) return false;
        const group = groups().find((g) => g.id === Number(ctx.params.id));
        if (!group) return ctx.send(404, { detail: "Fictional group not found." });
        const list = [...members(group)];
        for (const id of user_ids) {
          const user = getUser(id);
          if (user && !list.some((m) => m.id === user.id || m.email === user.email))
            list.push({ id: user.id, email: user.email });
        }
        core.state.adminGroupMembers[group.id] = list;
        ctx.send(200, {});
      } },
      // Combined {user_ids, cc_pair_ids} is owned by handlers-admin-groups (#60).
      { method: "PATCH", path: "/manage/admin/user-group/:id", async handle(ctx) {
        const body = await ctx.body();
        if (composition.ownsGroupWrites) return false;
        if (!Array.isArray(body.user_ids) || Object.keys(body).some((k) => k !== "user_ids")) return false;
        seeds(); const group = groups().find((g) => g.id === Number(ctx.params.id));
        if (!group) return ctx.send(404, { detail: "Fictional group not found." });
        core.state.adminGroupMembers[group.id] = body.user_ids.map(getUser).filter(Boolean)
          .map(({ id, email }) => ({ id, email }));
        ctx.send(200, {});
      } },
    ],
    transform: {
      "GET /manage/users/accepted/all": () => rows(),
      "GET /manage/users/invited": () => { seeds(); return invited; },
      "GET /tenants/users/pending": () => { seeds(); return pending; },
      "GET /manage/users/counts": () => counts(),
      "GET /manage/users": (value) => { seeds(); return userList(value); },
      "GET /manage/admin/user-group": (value) => {
        seeds();
        return value.map((g) => ({ ...g, users: members(g) }));
      },
    },
  };
}
