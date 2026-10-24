import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runScript } from "./runner.mjs";

test("runner restores scoped cursor visibility and appearance while preserving manual toggles", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-runner-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the reset request. */ }
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const events = [], actions = [];
  let url = "about:blank", visibleCursor;
  const page = {
    on() {},
    async route() {},
    async goto(next) { url = next; events.push(["goto", next]); },
    url() { return url; },
    async waitForLoadState() {},
    async waitForFunction() {},
    async waitForTimeout(ms) { events.push(["wait", ms]); },
    async evaluate(fn, value) {
      if (typeof fn === "string") events.push(["eval", fn]);
      else if (value?.look) visibleCursor = value;
    },
    async screenshot() {},
    mouse: { async move(x, y) { events.push(["move", x, y]); } },
    keyboard: { async press(key) { events.push(["press", key, structuredClone(visibleCursor)]); } },
  };
  const context = { async addCookies() {}, async addInitScript() {}, async newPage() { return page; }, async close() {} };
  const browser = { async newContext() { return context; } };
  const m = { name: "example", dir, fixturesDir: path.join(dir, "fixtures"), outDir: path.join(dir, "out"), ports: { mock: server.address().port, web: 3100 }, runner: {} };
  const script = {
    name: "directed",
    cursor: { screenshots: true, look: { fill: "#0B5CFF" } },
    scenes: [
      { id: "opening", steps: [
        { id: "navigate", goto: "/app?chatId=existing-session" },
        { id: "hide", presentation: { cursor: false }, press: "Enter" },
        { id: "red", presentation: { cursor: { look: { fill: "#ff0000" } } }, press: "Control+K" },
        { id: "restored", press: "Escape" },
      ] },
      { id: "hidden", presentation: { cursor: false }, steps: [{ id: "scene-hidden", press: "Enter" }] },
      { id: "manual", steps: [
        { id: "off", cursor: false },
        { id: "still-off", press: "Enter" },
        { id: "on", cursor: true },
        { id: "visible", press: "Enter" },
      ] },
    ],
  };
  const result = await runScript(m, null, browser, { script, live: { async after({ timeline }) { actions.push(structuredClone(timeline.actions.at(-1))); } } });
  assert.deepEqual(result.problems, []);
  assert.equal(actions.find((action) => action.step_id === "hide").presentation.cursor.enabled, false);
  assert.equal(actions.find((action) => action.step_id === "red").presentation.cursor.look.fill, "#ff0000");
  assert.equal(actions.find((action) => action.step_id === "restored").presentation.cursor.look.fill, "#0B5CFF");
  assert.equal(actions.find((action) => action.step_id === "scene-hidden").presentation.cursor.enabled, false);
  assert.equal(actions.find((action) => action.step_id === "still-off").presentation.cursor.enabled, false);
  assert.equal(actions.find((action) => action.step_id === "visible").presentation.cursor.enabled, true);
  const presses = events.filter(([op]) => op === "press");
  assert.equal(presses[0][2].hide, true);
  assert.equal(presses[1][1], "Control+K");
  assert.equal(presses[1][2].look.fill, "#ff0000");
  assert.equal(presses[2][2].look.fill, "#0B5CFF");
  assert.equal(presses[3][2].hide, true);
  assert.equal(presses[4][2].hide, true);
  assert.equal(presses[5][2].hide, false);
});
