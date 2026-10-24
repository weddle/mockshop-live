// Teams: shared teams -> user groups and admin group seeds.
import { entries } from "./shared.mjs";

export function derive(ctx) {
  const { content, app, routes, number, personDto, groups } = ctx;
  const teams = [];
  for (const [key, team] of entries(content.teams)) {
    const mapping = app.teams?.[key] || {}, id = number("teams", key, mapping.id);
    const seed = routes["GET /manage/admin/user-group"]?.find((group) => group.id === id) || {};
    const row = { id, cc_pairs: [], document_sets: [], personas: [], is_up_to_date: true, is_up_for_deletion: false,
      is_default: false, incognito_enabled: false, permissions: { manage: true, manage_members: true, delete: true, edit_permissions: true, edit_token_limits: true },
      ...seed, name: team.name, users: (team.members || []).map((person) => ({ id: personDto(person).id, email: personDto(person).email })),
      manager_ids: mapping.managers ? mapping.managers.map((person) => personDto(person).id) : seed.manager_ids || [] };
    teams.push(row);
  }
  if (teams.length) {
    routes["GET /manage/admin/user-group"] = teams;
    routes["GET /manage/user-groups/minimal"] = teams.map(({ id, name }) => ({ id, name }));
    const groupSeeds = routes["GET /mockshop/admin-groups/seeds"];
    groupSeeds.groups = teams.map((team) => ({ cc_pair_ids: [], document_set_ids: [], agent_ids: [], enabled_permissions: [], token_limits: [],
      ...groupSeeds.groups.find((group) => group.id === team.id), id: team.id, name: team.name, manager_ids: team.manager_ids }));
    groupSeeds.resource_permissions = teams[0].permissions;
  }
}
