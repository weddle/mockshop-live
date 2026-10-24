// Script compilation: validates locators, turns high-level steps (send, state.world/sidebar/connectors/agent/model) into executable steps,
// and selects the compiled overlay. World materialization lives in materialize.mjs and the per-entity modules.
import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { loadContent, contentRefs } from "../../../core/content.mjs";
import { builtEdition } from "../../../core/build.mjs";
import { labels, own, entries, digest, plain, fail, writeYaml } from "./shared.mjs";
import { materialize } from "./materialize.mjs";

export function compile(content, { m, script, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const current = materialize(content, { m, script, outputDir });
  let active = current, activeOverlays = script.overlays || [];
  const steps = [], inputs = [...current.inputs], origins = {}, snapshots = new Map();
  const editionOverlay = m.editions?.[builtEdition(m) || m.edition]?.fixtures;
  const authoredEditions = (values) => values.filter((value) => value !== editionOverlay);
  const overlay = (dir) => path.relative(m.fixturesDir, dir).split(path.sep).join("/");
  const add = (step, suffix, operation) => { const { send, state, ...metadata } = step; steps.push({ ...metadata, ...(state?.cursor !== undefined && metadata.cursor === undefined ? { cursor: state.cursor } : {}), id: `${step.id}--${suffix}`, author_id: step.author_id || step.id, ...operation }); };
  const checkLocator = (value, field) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\/admin\/connector\/([a-z_]+)\/(\d+)(?=[/?#"' ]|$)/g)) {
        const source = Object.values(active.sourceMap).find((s) => !s.unsupported && (s.id === Number(match[2]) || s.connector.id === Number(match[2])));
        if (source && source.row.source !== match[1]) fail(field, `explicit connector locator uses ${match[1]}, but source ${source.source.name} now uses ${source.row.source}; update the locator`, script);
      }
      for (const source of Object.values(active.sourceMap).filter((s) => !s.unsupported)) for (const [vendor, label] of entries(labels)) {
        if (vendor !== source.row.source && [" – ", " — ", " - "].some((separator) => value.includes(`${label}${separator}${source.source.name}`)))
          fail(field, `explicit ${label} label for source ${source.key} conflicts with ${source.row.source}; update the locator`, script);
      }
    } else if (value && typeof value === "object") for (const [key, child] of entries(value)) checkLocator(child, `${field}.${key}`);
  };
  for (const step of script.steps || []) {
    for (const field of ["goto", "click", "wait", "wait_gone", "hover", "focus", "scroll"]) if (own(step, field)) checkLocator(step[field], `steps.${step.id}.${field}`);
    if (step.send !== undefined) {
      const send = step.send;
      if (!plain(send) || typeof send.text !== "string") fail(`steps.${step.id}.send`, "expected {text, reply}", script);
      for (const key of Object.keys(send)) if (!["text", "reply", "wait", "beats"].includes(key)) fail(`steps.${step.id}.send.${key}`, "unsupported send option", script);
      const beats = send.beats || ["submitted", "answer-complete"];
      const preparedReply = { ...active.reply(send.reply, `steps.${step.id}.send.reply`), turn: step.author_id || step.id, question: send.text };
      // The turn is available only in the world active at this exact point in the script.
      writeYaml(path.join(active.outputDir || outputDir, "chat", `turn-${digest(preparedReply.turn).slice(0, 24)}.yaml`), preparedReply);
      add(step, "arm", { state: { keep: true, resetChats: false, turn: preparedReply.turn } });
      add(step, "focus", { click: { selector: "#onyx-chat-input-textbox" } });
      add(step, "type", { type: { selector: "#onyx-chat-input-textbox", value: send.text } });
      add(step, "submit", { click: { selector: "#onyx-chat-input-send-button" } });
      if (beats.includes("submitted")) add(step, "submitted", { mark: "submitted" });
      // The last completed message may be the previous reply. Check the newest message wrapper instead;
      // live wrappers use optimistic IDs until reload, not the backend's persistent message ID.
      add(step, "complete", { eval: `(async () => { const until = Date.now() + 60000; while (Date.now() < until) { const r = await fetch('/api/mockshop/turn/' + ${JSON.stringify(encodeURIComponent(preparedReply.turn))}); if (!r.ok) throw new Error('Prepared reply status is unavailable'); const value = await r.json(); const latest = Array.from(document.querySelectorAll('[id^="message-"]')).at(-1); if (value.status === 'complete' && latest?.querySelector('[data-testid="onyx-ai-message"]')) return; if (value.status === 'stopped') throw new Error('Prepared reply was interrupted'); await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Prepared reply did not finish rendering'); })()` });
      if (beats.includes("answer-complete")) { add(step, "settled", { settle: 600 }); add(step, "answer-complete", { mark: "answer-complete" }); }
      if (send.wait) add(step, "answer", { wait: send.wait });
      continue;
    }
    if (!step.state) { steps.push(step); continue; }
    const state = step.state;
    // Viewer switch: the active world with apps.onyx.viewer set to another shared person, compiled once per person like a world switch,
    // so /me, the role and everything derived from the viewer (group-restricted providers, ownership) change together.
    if (own(state, "viewer")) {
      for (const key of Object.keys(state)) if (!["viewer", "keep", "resetChats", "cursor"].includes(key))
        fail(`steps.${step.id}.state.${key}`, "put other state in a separate step after the viewer switch", script);
      if (typeof state.viewer !== "string" || !own(active.content.people || {}, state.viewer)) fail(`steps.${step.id}.state.viewer`, `unknown person ${state.viewer}`, script);
      const viewed = { ...active.content, apps: { ...active.content.apps, onyx: { ...active.content.apps?.onyx, viewer: state.viewer } } };
      const signature = digest(JSON.stringify({ viewed, editionOverlay, overlays: authoredEditions(activeOverlays) })).slice(0, 16);
      const isInitialWorld = isDeepStrictEqual(viewed, content) && isDeepStrictEqual(authoredEditions(activeOverlays), authoredEditions(script.overlays || []));
      const target = isInitialWorld ? outputDir : path.join(outputDir, `world-${signature}`);
      if (isInitialWorld) active = current;
      else {
        if (!snapshots.has(signature)) snapshots.set(signature, { ...materialize(viewed, { m, script: { ...script, overlays: activeOverlays }, outputDir: target }), outputDir: target });
        active = snapshots.get(signature);
      }
      inputs.push(...active.inputs);
      const { viewer: ignored, ...rest } = state;
      steps.push({ ...step, state: { ...rest, overlays: [overlay(target)], keep: state.keep ?? true, resetChats: state.resetChats ?? false } });
      continue;
    }
    if (state.world) {
      for (const key of Object.keys(state)) if (!["world", "overlays", "keep", "resetChats", "cursor"].includes(key))
        fail(`steps.${step.id}.state.${key}`, "put screen controls in a separate step after the whole-world switch", script);
      const declaring = step.origin?.file || script._resolved?.file || script._resolved?.source;
      if (!declaring) fail(`steps.${step.id}.state.world`, "source file is required for relative world paths", script);
      const world = path.resolve(path.dirname(declaring), state.world);
      const loaded = loadContent(world, { refs: contentRefs(m) });
      const selectedOverlays = state.overlays || script.overlays || [];
      activeOverlays = selectedOverlays;
      const signature = digest(JSON.stringify({ world, inputs: loaded.inputs, editionOverlay, overlays: authoredEditions(selectedOverlays) })).slice(0, 16);
      const isInitialWorld = isDeepStrictEqual(loaded.content, content) && isDeepStrictEqual(authoredEditions(selectedOverlays), authoredEditions(script.overlays || []));
      const target = isInitialWorld ? outputDir : path.join(outputDir, `world-${signature}`);
      if (isInitialWorld) active = current;
      else {
        if (!snapshots.has(signature)) snapshots.set(signature, { ...materialize(loaded.content, { m, script: { ...script, overlays: selectedOverlays, _resolved: { ...script._resolved, contentOrigins: loaded.origins } }, outputDir: target }), outputDir: target });
        active = snapshots.get(signature);
      }
      inputs.push(...loaded.inputs, ...active.inputs); Object.assign(origins, loaded.origins);
      const { world: ignored, ...rest } = state;
      steps.push({ ...step, state: { ...rest, overlays: [overlay(target)], keep: state.keep ?? true, resetChats: state.resetChats ?? false } });
      continue;
    }
    const keys = ["sidebar", "connectors", "agent", "model"].filter((key) => own(state, key));
    const allowed = new Set([...keys, "overlays", "keep", "resetChats", "turn", "screen", "cursor"]);
    for (const key of Object.keys(state)) if (!allowed.has(key)) fail(`steps.${step.id}.state.${key}`, "unsupported Onyx screen state", script);
    if (!keys.length) { steps.push(step); continue; }
    for (const key of ["overlays", "turn", "screen"]) if (own(state, key))
      fail(`steps.${step.id}.state.${key}`, "do not mix raw runtime controls with keyed screen selections", script);
    const screen = {};
    for (const [field, catalog, select] of [["sidebar", active.conversationMap, (v) => v], ["connectors", active.sourceMap, (v) => v.unsupported ? null : v.id]]) if (own(state, field)) {
      if (!Array.isArray(state[field])) fail(`steps.${step.id}.state.${field}`, "expected an ordered list of entity keys", script);
      screen[field] = state[field].map((key) => { if (!own(catalog, key) || select(catalog[key]) == null) fail(`steps.${step.id}.state.${field}`, `unsupported or missing entity ${key}`, script); return select(catalog[key]); });
      if (new Set(screen[field]).size !== screen[field].length) fail(`steps.${step.id}.state.${field}`, "duplicate screen items", script);
    }
    if (own(state, "agent")) {
      if (state.agent !== null && !own(active.agentMap, state.agent)) fail(`steps.${step.id}.state.agent`, `unknown agent ${state.agent}`, script);
      screen.agent = state.agent === null ? 0 : active.agentMap[state.agent];
    }
    if (own(state, "model")) {
      const name = active.content.apps?.onyx?.models?.[state.model]?.name || state.model;
      if (name === null) screen.model = null;
      else {
        const provider = active.routes["GET /admin/llm/provider"]?.providers?.find((p) => p.model_configurations.some((v) => v.name === name && v.is_visible !== false));
        const model = provider?.model_configurations.find((v) => v.name === name && v.is_visible !== false);
        if (!model) fail(`steps.${step.id}.state.model`, `unknown or hidden model ${state.model}`, script);
        screen.model = `${provider.name}__${provider.provider}__${model.name}__mc:${model.id}`;
      }
    }
    add(step, "state", { state: { keep: state.keep ?? true, resetChats: state.resetChats ?? false, screen } });
    const agentQuery = own(screen, "agent") ? `u.searchParams.set('agentId', ${JSON.stringify(String(screen.agent))});` : "";
    add(step, "refresh", { eval: `(() => { const u = new URL(location.href); ${agentQuery} document.documentElement.dataset.mockshopReloading = 'true'; location.replace(u.href); })()` });
    add(step, "unloaded", { wait_gone: { selector: 'html[data-mockshop-reloading="true"]', timeout: 30000 } });
    add(step, "ready", { wait: { selector: "body", timeout: 30000 } });
  }
  return { overlays: [overlay(outputDir)], steps, inputs, origins };
}
