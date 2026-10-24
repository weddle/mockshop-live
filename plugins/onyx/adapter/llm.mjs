// LLM area: apps.onyx.llm_providers -> GET /llm/provider, GET /admin/llm/provider, GET /llm/persona/:id/providers and the v5 routing/cost routes.
// One world entity per provider. IDs are order-independent: an explicit `id:` wins, else a stable hash of the key (providers:
// number("llm_providers", key); model configurations: number("llm_models", "<provider>/<model>")).
// An absent `llm_providers` leaves the neutral base fixtures (fixtures/base/50-llm.yaml) in place; `{}` or `null` means "no providers".
// A world layered over another world drops an inherited provider by naming its key as `null` (merging never deletes), and the whole
// inherited section by setting `llm_providers: null`.
import { entries, fail, own } from "./shared.mjs";

const ROUTES = ["GET /llm/provider", "GET /admin/llm/provider", "GET /llm/persona/:id/providers"];
const PURPOSES = { text: "default_text", vision: "default_vision", chat_naming: "default_chat_naming", craft: "default_craft" };
const DISPLAY = { openai: "OpenAI", anthropic: "Anthropic", ollama_chat: "Ollama", portkey: "Portkey", bedrock: "Amazon Bedrock", vertex_ai: "Gemini",
  azure: "Azure OpenAI", openrouter: "OpenRouter", litellm_proxy: "LiteLLM", lm_studio: "LM Studio", bifrost: "Bifrost", openai_compatible: "OpenAI Compatible",
  vercel_ai_gateway: "Vercel AI Gateway", nebius_tokenfactory: "Nebius Token Factory" };
// Onyx labels the models of these built-in providers with the provider as their vendor.
const VENDOR = { openai: "openai", anthropic: "anthropic" };
const SECRET = "mock-only-not-a-secret";
const humanize = (id) => id.split(/[_-]/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
const clone = (value) => structuredClone(value);
const list = (value) => value || [];

function modelRow(provider, key, model, id) {
  const efforts = model.reasoning_efforts;
  const vendor = own(model, "vendor") ? model.vendor : VENDOR[provider.provider];
  return { id, name: model.name ?? key, display_name: model.display_name ?? model.name ?? key, is_visible: model.visible ?? true,
    max_input_tokens: model.max_input_tokens ?? null, supports_image_input: model.supports_image_input ?? false,
    supports_reasoning: model.supports_reasoning ?? Boolean(efforts?.length),
    ...(efforts ? { supported_reasoning_efforts: efforts } : {}),
    ...(own(model, "reasoning_effort_max") ? { reasoning_effort_max: model.reasoning_effort_max } : {}),
    ...(own(model, "reasoning_effort_default") ? { reasoning_effort_default: model.reasoning_effort_default } : {}),
    ...(own(model, "temperature_default") ? { temperature_default: model.temperature_default } : {}),
    ...(own(model, "recommended") ? { is_recommended_default: model.recommended } : {}),
    ...(vendor ? { vendor } : {}) };
}

export function derive(ctx) {
  const { app, script, routes, number } = ctx;
  if (!own(app, "llm_providers")) return;
  for (const route of ROUTES) if (own(app.fixtures || {}, route)) fail(`apps.onyx.fixtures.${route}`, "provider routes are derived from apps.onyx.llm_providers; remove the raw fixture (use `llm_providers: {}` for no providers)", script);
  const agentId = (key, field) => {
    if (own(app.agents || {}, key)) return number("agents", key, app.agents[key]?.id);
    if (key === "default") return 0;
    return fail(field, `unknown agent ${key}`, script);
  };
  const teamId = (key, field) => {
    if (!own(ctx.content.teams || {}, key)) fail(field, `unknown team ${key}`, script);
    return number("teams", key, app.teams?.[key]?.id);
  };

  const providers = [];
  const holders = Object.fromEntries(Object.keys(PURPOSES).map((purpose) => [purpose, []]));
  for (const [key, spec] of entries(app.llm_providers)) {
    if (app.llm_providers[key] === null) continue;
    const at = `apps.onyx.llm_providers.${key}`;
    const id = number("llm_providers", key, spec.id);
    const groups = list(spec.groups).map((team) => teamId(team, `${at}.groups`));
    const personas = list(spec.agents).map((agent) => agentId(agent, `${at}.agents`));
    const provider = { key, spec, id, name: spec.name ?? DISPLAY[spec.provider] ?? humanize(spec.provider), provider: spec.provider, groups, personas, models: [], byKey: {} };
    provider.public = spec.public ?? (!groups.length && !personas.length);
    provider.display = spec.provider_display_name ?? DISPLAY[spec.provider] ?? humanize(spec.provider);
    for (const [modelKey, model] of entries(spec.models)) {
      const row = modelRow(spec, modelKey, model, number("llm_models", `${key}/${modelKey}`, model.id));
      if (provider.models.some((other) => other.row.name === row.name)) fail(`${at}.models.${modelKey}`, `provider ${key} already has a model named ${row.name}`, script);
      const entry = { key: modelKey, model, row };
      provider.models.push(entry);
      provider.byKey[modelKey] = entry;
      const purposes = model.default === true ? ["text"] : list(model.default);
      for (const purpose of purposes) holders[purpose].push({ provider, entry, field: `${at}.models.${modelKey}.default` });
    }
    providers.push(provider);
  }

  const defaultProviders = providers.filter((p) => p.spec.default);
  if (defaultProviders.length > 1) fail(`apps.onyx.llm_providers.${defaultProviders[1].key}.default`, `only one provider can be the default (also ${defaultProviders[0].key})`, script);
  // The default provider's own default model answers every purpose no model claims explicitly (except craft).
  const fallback = defaultProviders[0] && (holders.text.find((h) => h.provider === defaultProviders[0])?.entry || defaultProviders[0].models[0]);
  const defaults = {};
  for (const [purpose, field] of Object.entries(PURPOSES)) {
    if (holders[purpose].length > 1) fail(holders[purpose][1].field, `${field} is also claimed by ${holders[purpose][0].provider.key}`, script);
    const holder = holders[purpose][0] || (purpose !== "craft" && fallback ? { provider: defaultProviders[0], entry: fallback } : null);
    defaults[field] = holder ? { provider_id: holder.provider.id, model_name: holder.entry.row.name } : null;
  }

  const adminRow = (p, models = p.models) => ({ id: p.id, name: p.name, provider: p.provider,
    api_key: p.spec.api_key ?? (p.spec.api_key_set ? SECRET : null), api_base: p.spec.api_base ?? null, api_version: p.spec.api_version ?? null,
    custom_config: p.spec.custom_config ?? null, is_public: p.public, is_auto_mode: p.spec.auto_mode ?? false, groups: p.groups, personas: p.personas,
    deployment_name: p.spec.deployment_name ?? null, model_configurations: models.map((m) => m.row), next_model_configuration_offset: null });
  const publicRow = (p) => ({ id: p.id, name: p.name, provider: p.provider, provider_display_name: p.display,
    model_configurations: p.models.map((m) => m.row), next_model_configuration_offset: null });
  const catalog = (rows) => clone({ providers: rows, ...defaults });

  routes["GET /admin/llm/provider"] = catalog(providers.map((p) => adminRow(p)));
  routes["GET /llm/provider"] = catalog(providers.map(publicRow));
  // Providers restricted to agents are listed only for those agents; handlers-save-controls.mjs applies the same rule to its live catalog.
  routes["GET /llm/persona/:id/providers"] = catalog(providers.filter((p) => p.public).map(publicRow));
  for (const persona of new Set(providers.flatMap((p) => p.personas))) {
    routes[`GET /llm/persona/${persona}/providers`] = catalog(providers.filter((p) => p.public || p.personas.includes(persona)).map(publicRow));
  }

  deriveV5(ctx, providers, adminRow);
  ctx.entityIds ||= {};
  ctx.entityIds.llm_providers = Object.fromEntries(providers.map((p) => [p.key, p.id]));
}

// v5.0.0-beta.2: router models (Auto mode), the model-routing setting and cost overrides. Absent `v5` data leaves the base fixtures alone.
function deriveV5(ctx, providers, adminRow) {
  const { routes, script } = ctx;
  const withV5 = providers.filter((p) => p.spec.v5);
  if (!withV5.length) return;
  const modelOf = (p, key, field) => p.byKey[key] || fail(`apps.onyx.llm_providers.${p.key}.v5.${field}`, `unknown model ${key} of provider ${p.key}`, script);
  routes["GET /admin/llm/router-models"] = clone(withV5.flatMap((p) => {
    const models = list(p.spec.v5.router_models).map((key) => modelOf(p, key, "router_models"));
    return models.length ? [adminRow(p, models)] : [];
  }));
  const routing = withV5.find((p) => p.spec.v5.routing && Object.keys(p.spec.v5.routing).length);
  if (routing) {
    const { enabled = true, model } = routing.spec.v5.routing;
    routes["GET /admin/llm/model-routing"] = { model_routing_enabled: enabled, model_routing_model_configuration_id: model == null ? null : modelOf(routing, model, "routing.model").row.id };
  }
  const costs = withV5.flatMap((p) => Object.values(p.spec.v5.cost_overrides || {}).map(clone));
  if (costs.length) routes["GET /admin/cost-overrides"] = costs;
}
