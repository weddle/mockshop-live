// Helpers shared by the per-entity adapter modules.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { check } from "../../../core/validate.mjs";
import { fileURLToPath } from "node:url";
import { stableNumber, stableUuid } from "../../../core/ids.mjs";

export const vendors = new Set(["confluence", "notion", "google_drive", "github", "slack", "jira", "zendesk", "file", "web", "salesforce", "zoom", "sharepoint", "gmail", "teams", "outlook", "gitlab"]);
export const labels = { confluence: "Confluence", notion: "Notion", google_drive: "Google Drive", github: "GitHub", slack: "Slack", jira: "Jira", zendesk: "Zendesk", file: "Files", web: "Web", salesforce: "Salesforce", zoom: "Zoom", sharepoint: "SharePoint", gmail: "Gmail", teams: "Teams", outlook: "Outlook", gitlab: "GitLab" };
export const own = (v, k) => Object.hasOwn(v, k);
export const entries = (v) => Object.entries(v || {});
export const digest = (v) => createHash("sha256").update(v).digest("hex");
export const uuid = (kind, key) => stableUuid("onyx", kind, key);
export const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const fileKey = (key) => /^[\w.-]+$/.test(key) && key !== "." && key !== "..";
export function fail(field, message, script) {
  const origins = script?._resolved?.contentOrigins || {};
  let key = field.replace(/\[(\d+)\]/g, ".$1");
  while (key && !origins[key]) key = key.replace(/\.?[^.]+$/, "");
  const origin = script?.steps?.find((step) => field.startsWith(`steps.${step.id}.`))?.origin || origins[key] || {};
  const file = origin.file || script?._resolved?.file || script?._resolved?.source || "Onyx content";
  const line = origin.line || 1;
  const error = new Error(`${file}:${line} ${field}: ${message}`);
  error.errors = [{ file, line, field, message }];
  throw error;
}
export function ids(script) {
  const used = new Map();
  return (kind, key, explicit) => {
    const id = explicit ?? stableNumber("onyx", kind, key);
    if (!Number.isSafeInteger(id) || id < 0) fail(`apps.onyx.${kind}.${key}.id`, "expected a non-negative safe integer", script);
    const identity = `${kind}:${id}`;
    if (used.has(identity) && used.get(identity) !== key) fail(`apps.onyx.${kind}.${key}.id`, `ID ${id} collides with ${used.get(identity)}`, script);
    used.set(identity, key);
    return id;
  };
}
export function readRoutes(dir, inputs) {
  if (!fs.existsSync(dir)) return {};
  const routes = {};
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = path.join(dir, name), bytes = fs.readFileSync(file);
    inputs.push({ file, hash: digest(bytes) });
    const doc = YAML.parse(bytes.toString("utf8"), { merge: true, maxAliasCount: -1 });
    for (const [key, value] of entries(doc)) if (/^(GET|POST|PUT|PATCH|DELETE|ANY) \/\S*$/.test(key)) routes[key] = value;
  }
  return routes;
}
export function urlFor(vendor, key, domain) {
  const host = domain || "workspace.example";
  const part = encodeURIComponent(key);
  if (vendor === "file") return null;
  const paths = { confluence: `/wiki/spaces/KNOWLEDGE/pages/${part}`, notion: `/${part}`, github: `/knowledge/blob/main/${part}`, slack: `/archives/knowledge/${part}`, google_drive: `/document/d/${part}/edit`, jira: `/browse/${part}`, zendesk: `/hc/articles/${part}`, sharepoint: `/sites/knowledge/${part}` };
  return `https://${vendor.replaceAll("_", "-")}.${host}${paths[vendor] || `/documents/${part}`}`;
}
export function checkUrl(url, vendor, field, script, expectedVendor) {
  if (url == null) return;
  let parsed;
  try { parsed = new URL(url); } catch { fail(field, "expected an absolute http(s) URL", script); }
  if (!["https:", "http:"].includes(parsed.protocol)) fail(field, "only http(s) URLs are supported", script);
  if (expectedVendor && expectedVendor !== vendor) fail(field, `explicit URL/configuration belongs to ${expectedVendor}, but source vendor is ${vendor}; remove or replace the explicit value`, script);
  const host = parsed.hostname, p = parsed.pathname;
  const inferred = /notion\./.test(host) ? "notion" : /slack\./.test(host) ? "slack" : /github\./.test(host) ? "github" : /docs\.google\./.test(host) ? "google_drive" : /\/wiki(?:\/|$)/.test(p) ? "confluence" : /\/browse\//.test(p) ? "jira" : null;
  if (inferred && inferred !== vendor) fail(field, `URL identifies ${inferred}, not ${vendor}; remove it to derive a ${vendor} URL`, script);
}
export function writeYaml(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false })); }
export function validateApp(app, script) {
  const file = fileURLToPath(new URL("../world.schema.json", import.meta.url));
  const bytes = fs.readFileSync(file), schema = JSON.parse(bytes);
  const errors = check(schema, app);
  if (errors.length) fail(`apps.onyx.${errors[0].path}`, errors[0].message, script);
  for (const route of Object.keys(app.fixtures || {})) if (!/^(GET|POST|PUT|PATCH|DELETE|ANY) \/\S*$/.test(route)) fail(`apps.onyx.fixtures.${route}`, "expected an Onyx fixture route key", script);
  return { file, hash: digest(bytes) };
}
// World sections the schema declares for an area before its adapter derivation exists: fail loudly instead of silently ignoring data.
export function rejectUnderived(app, sections, script) {
  for (const section of sections) if (own(app, section)) fail(`apps.onyx.${section}`, "this world section is declared in world.schema.json but the adapter does not derive it yet", script);
}
