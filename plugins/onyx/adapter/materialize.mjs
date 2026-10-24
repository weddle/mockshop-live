// Onyx materialization: runs the per-entity modules in a fixed order over one shared context. Order matters: later modules read
// maps (people, sources, documents) that earlier ones fill, and `project` must run after every entity it snapshots.
import { builtEdition } from "../../../core/build.mjs";
import { contentRefs, refRoots } from "../../../core/content.mjs";
import fs from "node:fs";
import path from "node:path";
import { fail, ids, own, readRoutes, validateApp, writeYaml } from "./shared.mjs";
import * as people from "./people.mjs";
import * as settings from "./settings.mjs";
import * as teams from "./teams.mjs";
import * as connectors from "./connectors.mjs";
import * as documents from "./documents.mjs";
import * as llm from "./llm.mjs";
import * as plugins from "./plugins.mjs";
import * as craft from "./craft.mjs";
import * as billing from "./billing.mjs";
import * as tier from "./tier.mjs";
import * as state from "./state.mjs";
import * as project from "./project.mjs";
import * as replies from "./replies.mjs";
import * as agents from "./agents.mjs";
import * as conversations from "./conversations.mjs";
import * as bodies from "./bodies.mjs";

export const ENTITIES = { people, settings, teams, connectors, documents, llm, plugins, craft, billing, tier, state, project, replies, agents, conversations, bodies };

export function materialize(content, { m, script, outputDir, overlays = script.overlays || [] }) {
  // World and viewer switches materialize into a fresh subdirectory; modules such as state.mjs write into it directly.
  fs.mkdirSync(outputDir, { recursive: true });
  const app = content.apps?.onyx || {};
  const schemaInput = validateApp(app, script);
  const number = ids(script);
  const inputs = [schemaInput];
  const routes = readRoutes(path.join(m.fixturesDir, "base"), inputs);
  // Edition overlays and worlds may state /settings sparsely: settings.mjs completes them from this single base object.
  const baseSettings = routes["GET /settings"];
  const edition = m.editions?.[builtEdition(m) || m.edition]?.fixtures;
  for (const overlay of new Set([...(edition ? [edition] : []), ...overlays])) {
    if (!/^edition-[\w-]+$/.test(overlay)) fail("overlays", `fictional overlay ${overlay} must be explicit world/content data`, script);
    Object.assign(routes, readRoutes(path.join(m.fixturesDir, overlay), inputs));
  }
  Object.assign(routes, structuredClone(app.fixtures || {}));
  for (const field of ["people", "teams", "sources", "documents", "conversations"]) for (const key of Object.keys(app[field] || {})) {
    if (!own(content[field] || {}, key)) fail(`apps.onyx.${field}.${key}`, `unknown shared ${field} key`, script);
  }
  const ctx = { m, content, app, script, outputDir, routes, inputs, number, baseSettings, sourceMap: {}, docMap: {}, agentMap: {}, conversationMap: {} };
  for (const entity of Object.values(ENTITIES)) entity.derive(ctx);
  const { project: projectRoutes, sourceMap, docMap, agentMap, conversationMap, reply } = ctx;
  const compiledRoutes = projectRoutes(routes);
  writeYaml(path.join(outputDir, "00-world.yaml"), compiledRoutes);
  // Key -> ID map of every referenceable entity ({{agents.<key>.id}}); the runner-only state API (handlers-state.mjs) resolves keys with it.
  const entityIds = Object.fromEntries(Object.entries(refRoots(content, contentRefs(m))).map(([root, entities]) => [root, Object.fromEntries(Object.entries(entities).map(([key, entity]) => [key, entity.id]))]));
  fs.writeFileSync(path.join(outputDir, "entities.json"), JSON.stringify(entityIds));
  return { routes: compiledRoutes, sourceMap, docMap, agentMap, conversationMap, reply, content, inputs };
}
