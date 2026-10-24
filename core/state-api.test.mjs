import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stateReader, stateTokenFile } from "./state-api.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the state API is runner-only: it needs the per-process secret, is read-only, and maps plugin answers to 200/404/400", { timeout: 20000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-state-api-"));
  const name = `teststate${randomUUID().replaceAll("-", "")}`;
  const plugin = path.join(dir, name);
  fs.mkdirSync(path.join(plugin, "fixtures", "base"), { recursive: true });
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), `name: ${name}\nports:\n  mock: ${port}\nmock:\n  handlers: handlers.mjs\n`);
  fs.writeFileSync(path.join(plugin, "handlers.mjs"), `export default () => ({ state: async (parts) => {
    if (parts[0] === "bad") throw Object.assign(new Error("unknown state collection"), { status: 400 });
    if (parts[0] === "things" && parts[1] === "one") return { id: 1, tags: ["x"] };
    return undefined;
  } });`);
  const child = spawn(process.execPath, [path.join(root, "core/server.mjs"), name], {
    cwd: root, env: { ...process.env, MOCKSHOP_PORT_OFFSET: undefined, MOCKSHOP_PLUGIN_PATH: dir }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(root, "logs", name), { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server readiness timed out: ${output}`)), 8000);
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${output}`)); });
    child.stderr.on("data", (d) => { output += d; });
    child.stdout.on("data", (d) => { output += d; if (output.includes("mock backend on")) { clearTimeout(timeout); resolve(); } });
  });
  const m = { name, logsDir: path.join(root, "logs", name), ports: { mock: port } };
  const url = `http://127.0.0.1:${port}/__mockshop/state/things/one`;
  const token = fs.readFileSync(stateTokenFile(m), "utf8");
  const get = (p, headers = {}, method = "GET") => fetch(`http://127.0.0.1:${port}/__mockshop/state/${p}`, { method, headers });

  assert.equal((await fetch(url)).status, 403, "no secret: refused (this is what the page sees through the /api proxy)");
  assert.equal((await fetch(url, { headers: { "x-mockshop-runner": "guess" } })).status, 403);
  const ok = await fetch(url, { headers: { "x-mockshop-runner": token } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: 1, tags: ["x"] });
  assert.equal((await get("things/none", { "x-mockshop-runner": token })).status, 404);
  const unknown = await get("bad", { "x-mockshop-runner": token });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).detail, /unknown state collection/);
  assert.equal((await get("things/one", { "x-mockshop-runner": token }, "POST")).status, 405);

  const read = stateReader(m);
  assert.deepEqual(await read("/things/one"), { id: 1, tags: ["x"] });
  assert.equal(await read("/things/none"), undefined, "a 404 is an absent entity");
  await assert.rejects(read("/bad"), /failed \(400\)/);
});

test("stateReader says so when the mock was not started from this checkout", async () => {
  const m = { name: "absent", logsDir: path.join(os.tmpdir(), `no-such-${randomUUID()}`), ports: { mock: 1 } };
  await assert.rejects(stateReader(m)("/x"), /state API token .* is missing/);
});
