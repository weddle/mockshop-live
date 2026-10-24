import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "core", "cli.mjs");
const PLUGIN = `helpprobe${randomUUID().replaceAll("-", "")}`;

// A throwaway plugin whose mock and web port is a local server counting every request: help must neither contact it
// nor modify the existing output tree. Each process owns a unique plugin/output namespace.
async function probe(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockshop-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hits = [];
  const server = http.createServer((request, response) => { hits.push(`${request.method} ${request.url}`); response.end("{}"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const plugin = path.join(dir, "plugins", PLUGIN);
  fs.mkdirSync(path.join(plugin, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), `name: ${PLUGIN}\nports: { mock: ${port}, web: ${port} }\n`);
  fs.writeFileSync(path.join(plugin, "scripts", "x.yaml"), "steps:\n  - goto: /\n");
  const outDir = path.join(ROOT, "out", PLUGIN);
  fs.mkdirSync(path.join(outDir, "clips"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "clips", "x.mp4"), "existing clip must not change");
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const snapshot = () => Object.fromEntries(fs.readdirSync(outDir, { recursive: true }).sort().map((entry) => {
    const file = path.join(outDir, entry);
    return [entry, fs.statSync(file).isDirectory() ? null : fs.readFileSync(file).toString("base64")];
  }));
  const before = snapshot();
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, MOCKSHOP_PORT_OFFSET: undefined, MOCKSHOP_PLUGIN_PATH: path.join(dir, "plugins"), MOCKSHOP_PLUGIN: PLUGIN }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("error", reject);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  return { run, hits, untouched: () => assert.deepEqual(snapshot(), before, `${outDir} changed`) };
}

test("help anywhere on the command line prints usage without resolving targets, contacting servers or writing output", async (t) => {
  const { run, hits, untouched } = await probe(t);
  for (const args of [
    ["--help"],
    ["help"],
    ["clip", `${PLUGIN}/x`, "--force", "-h"],
    ["--plugin", PLUGIN, "up", "--help"],
    ["live", "--clip", "--force", "--locale", "en", "-h"],
    ["shot", "--profile", "--help"],
  ]) {
    const r = await run(args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stdout, /^Mockshop: /, args.join(" "));
    assert.equal(r.stderr, "", args.join(" "));
  }
  assert.deepEqual(hits, []);
  untouched();
});

test("-h taken as a known option's value is that value, not a help request", async (t) => {
  const { run, hits, untouched } = await probe(t);
  const plugin = await run(["--plugin", "-h", "pin"]);
  assert.equal(plugin.status, 1);
  assert.doesNotMatch(plugin.stdout, /Mockshop: /);
  assert.match(plugin.stderr, /unknown plugin "-h"/);
  const at = await run(["explain", "missing.timeline.json", "--at", "-h"]);
  assert.equal(at.status, 1);
  assert.doesNotMatch(at.stdout, /Mockshop: /);
  assert.match(at.stderr, /invalid clip time: -h/);
  assert.deepEqual(hits, []);
  untouched();
});
