// People: shared people -> Onyx user DTOs (/me, user lists), viewer selection and ID mapping.
import { own, entries, uuid, fail } from "./shared.mjs";

export function derive(ctx) {
  const { content, app, script, routes, groups } = ctx;
  const people = content.people || {};
  const viewerKey = app.viewer ?? Object.keys(people)[0];
  if (viewerKey && !own(people, viewerKey)) fail("apps.onyx.viewer", `unknown person ${viewerKey}`, script);
  const personMap = new Map(), personIds = new Map();
  for (const [key, person] of entries(people)) {
    const id = app.people?.[key]?.id || uuid("people", key);
    if (personIds.has(id)) fail(`apps.onyx.people.${key}.id`, `ID ${id} collides with ${personIds.get(id)}`, script);
    personIds.set(id, key);
    personMap.set(key, { id, email: person.email || `${key}@${content.company?.domain || "workspace.example"}`, name: person.name });
  }
  const personDto = (key) => {
    if (!personMap.has(key)) fail(`people.${key}`, "unknown person", script);
    return personMap.get(key);
  };
  const user = routes["GET /me"] || {};
  if (viewerKey && !user.__status) {
    const p = people[viewerKey], view = personDto(viewerKey);
    const role = app.fixtures?.["GET /me"]?.role ?? app.people?.[viewerKey]?.role ?? "basic";
    const admin = role === "admin";
    routes["GET /me"] = { ...user, role, is_admin: admin, is_superuser: admin, is_cloud_superuser: false,
      effective_permissions: admin ? ["admin", "basic"] : ["basic"], admin_capabilities: admin ? ["admin"] : [],
      ...app.fixtures?.["GET /me"], id: view.id, email: view.email,
      personalization: { ...user.personalization, name: p.name, role: p.title || "" } };
  }
  if (!own(app.fixtures || {}, "GET /users")) routes["GET /users"] = Object.keys(people).map(personDto);
  if (!own(app.fixtures || {}, "GET /manage/users")) routes["GET /manage/users"] = { accepted: Object.keys(people).map(personDto), invited: [], slack_users: [], accepted_pages: Object.keys(people).length ? 1 : 0, invited_pages: 0, slack_users_pages: 0 };
  if (!own(app.fixtures || {}, "GET /manage/users/accepted/all")) routes["GET /manage/users/accepted/all"] = Object.keys(people).map((key) => ({
    ...personDto(key), personal_name: people[key].name, account_type: "STANDARD",
    is_admin: (key === viewerKey ? routes["GET /me"]?.role : app.people?.[key]?.role) === "admin",
    is_active: true, password_configured: true, is_scim_synced: false, craft_enabled: false,
    created_at: "{{ago:30d}}", updated_at: "{{ago:1d}}", last_active: "{{ago:1h}}", groups: [],
  }));
  Object.assign(ctx, { people, viewerKey, personMap, personIds, personDto });
}
