// Settings: GET /settings (company identity + sparse apps.onyx.settings overrides) and /enterprise-settings branding.

export function derive(ctx) {
  const { content, app, routes, baseSettings } = ctx;
  // The company identity always comes from the shared company; `version` is not stored here (derived at serve time from plugin.yaml).
  routes["GET /settings"] = { ...baseSettings, ...routes["GET /settings"], company_name: content.company?.name || null, company_description: content.company?.description || null, ...app.settings };
  if (routes["GET /enterprise-settings"] && !routes["GET /enterprise-settings"].__status && content.company?.name) routes["GET /enterprise-settings"].application_name = content.company.name;
}
