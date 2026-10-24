import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Isolated external plugin: exercise the real HTTP control plane without native assets.
test("theme HTTP validation preserves state on errors and distinguishes keep, clear and fresh reset", { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-theme-http-"));
  const name = `testtheme${randomUUID().replaceAll("-", "")}`;
  const plugin = path.join(dir, name);
  fs.mkdirSync(path.join(plugin, "fixtures", "base"), { recursive: true });
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), `name: ${name}\nports:\n  mock: ${port}\n`);
  const child = spawn(process.execPath, [path.join(root, "core/server.mjs"), name], {
    cwd: root,
    env: { ...process.env, MOCKSHOP_PORT_OFFSET: undefined, MOCKSHOP_PLUGIN_PATH: dir }, // the test picks its own free port; an inherited offset would move it
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(root, "logs", name), { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`theme server readiness timed out: ${output}`)), 5000);
    const finish = (error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
    child.on("error", finish);
    child.once("exit", (code, signal) => finish(new Error(`theme server exited ${code ?? signal}: ${output}`)));
    child.stderr.on("data", data => { output += data; });
    child.stdout.on("data", data => {
      output += data;
      if (output.includes(`mock backend on http://127.0.0.1:${port}`)) finish();
    });
  });
  const url = `http://127.0.0.1:${port}/__mockshop/state`;
  const get = async () => (await fetch(url)).json();
  const post = async (body, expected = 200) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, expected);
    return response.json();
  };
  assert.equal((await get()).theme, null);
  assert.equal((await post({ theme: "dark" })).theme, "dark");
  for (const theme of ["sepia", "", false, [], {}]) {
    await post({ theme, strict: true }, 400);
    const state = await get();
    assert.equal(state.theme, "dark");
    assert.equal(state.strict, false);
  }
  assert.equal((await post({ keep: true })).theme, "dark");
  assert.equal((await post({ keep: true, theme: null })).theme, null);
  assert.equal((await post({ theme: "light" })).theme, "light");
  assert.equal((await post({})).theme, null);
});
