import assert from "node:assert/strict";
import fs from "node:fs";
import { check } from "../core/validate.mjs";

const schema = JSON.parse(fs.readFileSync(new URL("./scenario.schema.json", import.meta.url), "utf8"));
const errorsFor = (step) => check(schema.$defs.step, step, schema);

const valid = [
  ["existing point move", { move: [900, 300] }],
  ["existing text move", { move: "Sources" }],
  ["existing locator move", { move: { selector: "#send" } }],
  ["documented move wrapper and hold", { move: { to: [900, 300], hold: 400 } }],
  ["move wrapper without hold", { move: { to: [900, 300] } }],
  ["move wrapper with zero hold", { move: { to: [900, 300], hold: 0 } }],
  ["move wrapper with text target", { move: { to: "Sources", hold: 400 } }],
  ["move wrapper with locator target", { move: { to: { role: "button", name: "Sources" }, hold: 400 } }],
  ["move wrapper with inline and step-level cursor", { move: { to: [900, 300], hold: 400, cursor: "spring_settle" }, cursor: false }],
  ["inline cursor on shot", { shot: { name: "here", cursor: { ripple: 0.35 } } }],
  ["inline cursor on card", { card: { title: "Demo", cursor: true } }],
  ["inline cursor on state", { state: { overlays: [], cursor: false } }],
  ["inline cursor on mark", { mark: { name: "here", cursor: "spring_settle" } }],
  ["inline cursor on keyframe", { keyframe: { name: "here", cursor: {} } }],
  ["cursor-only step", { cursor: { style: "spring_settle" } }],
  ["cursor-only with only", { cursor: false, only: "shot" }],
  ["cursor-only with at", { cursor: true, at: 12.5 }],
  ["cursor-only with both modifiers", { cursor: "spring_settle", only: "clip", at: "1:02.5" }],
  ["existing op with cursor and modifiers", { click: { selector: "#send" }, cursor: {}, only: "clip", at: "1500ms" }],
];

// Locator-based op objects retain their existing required locator/value fields.
for (const op of ["click", "hover", "move", "fill", "type", "wait", "wait_gone", "scroll"]) {
  const arg = { selector: "#send", cursor: { style: "spring_settle" } };
  if (op === "fill" || op === "type") arg.value = "hello";
  valid.push([`inline cursor on ${op}`, { [op]: arg }]);
}
for (const cursor of [true, false, "spring_settle", {}]) {
  valid.push([`inline cursor value ${JSON.stringify(cursor)}`, { click: { selector: "#send", cursor }, cursor: {} }]);
}

const invalid = [
  ["move wrapper missing to", { move: { hold: 400 } }],
  ["move wrapper short point", { move: { to: [900], hold: 400 } }],
  ["move wrapper long point", { move: { to: [900, 300, 0] } }],
  ["move wrapper nonnumeric point", { move: { to: [900, "300"] } }],
  ["move wrapper missing locator base", { move: { to: { name: "Sources" } } }],
  ["move wrapper unknown locator field", { move: { to: { selector: "#send", typo: true } } }],
  ["move wrapper invalid target", { move: { to: 900 } }],
  ["move wrapper string hold", { move: { to: [900, 300], hold: "400" } }],
  ["move wrapper negative hold", { move: { to: [900, 300], hold: -1 } }],
  ["move wrapper unknown field", { move: { to: [900, 300], typo: true } }],
  ["move wrapper mixed with direct locator", { move: { to: [900, 300], selector: "#send" } }],
  ["inline cursor does not supply locator", { click: { cursor: {} } }],
  ["inline cursor does not permit locator typo", { hover: { selector: "#send", cursor: {}, typo: true } }],
  ["inline cursor preserves locator modifier types", { click: { selector: "#send", cursor: {}, nth: "0" } }],
  ["inline cursor does not supply fill value", { fill: { selector: "#send", cursor: {} } }],
  ["inline cursor does not supply type value", { type: { selector: "#send", cursor: {} } }],
  ["inline cursor does not supply shot name", { shot: { cursor: {} } }],
  ["inline cursor does not permit shot typo", { shot: { name: "here", cursor: {}, typo: true } }],
  ["inline cursor does not permit card typo", { card: { title: "Demo", cursor: {}, typo: true } }],
  ["inline cursor does not supply state overlays", { state: { cursor: {} } }],
  ["inline cursor does not supply marker name", { mark: { cursor: {} } }],
  ["inline cursor invalid type", { click: { selector: "#send", cursor: 1 } }],
  ["cursor-only invalid only", { cursor: {}, only: "video" }],
  ["cursor-only invalid at", { cursor: {}, at: {} }],
  ["cursor-only unknown field", { cursor: {}, typo: true }],
  ["modifier-only is not a cursor op", { only: "clip", at: 12.5 }],
  ["empty step is not a cursor op", {}],
  ["cursor-only invalid cursor type", { cursor: [] }],
  ["cursor with two browser ops", { click: "Sources", hover: "Sources", cursor: {}, only: "clip", at: 12.5 }],
  ["inline cursor with two browser ops", { click: { selector: "#send", cursor: {} }, shot: "here" }],
];

for (const [name, step] of valid) {
  assert.deepEqual(errorsFor(step), [], `${name}: ${JSON.stringify(step)}`);
}
for (const [name, step] of invalid) {
  assert.ok(errorsFor(step).length > 0, `${name} must be rejected: ${JSON.stringify(step)}`);
}
console.log(`Cursor syntax regressions: ${valid.length} valid and ${invalid.length} invalid witnesses passed.`);
