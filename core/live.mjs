// `mockshop live <plugin>`: stdio JSON-lines control of one browser session, using the same step vocabulary as script YAML.
//   stdin : one JSON object per line: a step ({"click":{"text":"Sources"}}) or a command ({"cmd":"save","path":"x.yaml"}).
//   stdout: one JSON object per line: {"ready":...}, then one result per input line. (Other output goes to stderr.)
// The session runs through the normal runner (runScript) with a step stream fed from stdin, so every step behaves exactly
// as it does in a script file, and the accepted steps can be exported as a script validated by core/validate.mjs.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import YAML from "yaml";
import { launchBrowser, runScript } from "./runner.mjs";
import { check, scriptSchema, validateScript } from "./validate.mjs";

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

export async function runLive(m, { clip = false, force = false, name = "live", save = null, locale = null } = {}) {
  const accepted = [];                     // steps that ran ok, in order (the exported script)
  const meta = { id: undefined, lastProblems: 0 };
  let ended = false;
  const schema = scriptSchema();
  const stepSchema = { $ref: "#/$defs/step" };

  function exportScript(file) {
    const sc = { name, title: `Live session on ${m.name}`, steps: accepted };
    const text = YAML.stringify(sc, { lineWidth: 0 });
    const v = validateScript(sc, m);
    if (file) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, `# Exported by \`mockshop live ${m.name}\`\n${text}`); }
    return { ok: v.ok, path: file ? path.resolve(file) : undefined, steps: accepted.length, errors: v.errors, warnings: v.warnings, ...(file ? {} : { yaml: text }) };
  }

  // Step stream: reads stdin lines; handles commands and invalid steps itself, yields valid steps to the runner.
  async function* steps() {
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { out({ ok: false, error: `bad JSON: ${e.message}` }); continue; }
      const { id, ...body } = msg;
      meta.id = id;
      if (body.cmd) {
        if (body.cmd === "save") out({ id, cmd: "save", ...exportScript(body.path || save || path.join(m.outDir, "live", `${name}.yaml`)) });
        else if (body.cmd === "export") out({ id, cmd: "export", ...exportScript(null) });
        else if (body.cmd === "end") { ended = true; break; }
        else out({ id, ok: false, error: `unknown cmd "${body.cmd}" (save, export, end)` });
        continue;
      }
      const errors = check(stepSchema, body, schema);
      if (errors.length) { out({ id, ok: false, error: "invalid step", errors }); continue; }
      yield body;
    }
    ended = true;
  }

  const live = {
    async after({ i, op, arg, step, page, shots, outDir, problems, error, timeline }) {
      let shot = null;
      if (op === "shot" && !error && typeof shots.at(-1) === "string") shot = shots.at(-1);
      else {
        shot = path.join(outDir, `step-${String(i).padStart(3, "0")}.png`);
        await page.screenshot({ path: shot }).catch(() => { shot = null; });
      }
      const fresh = problems.slice(meta.lastProblems); meta.lastProblems = problems.length;
      if (!error) accepted.push(step);
      const a = timeline?.actions.at(-1);
      out({ id: meta.id, ok: !error, step: i, op, url: page.url(), screenshot: shot ? path.resolve(shot) : null,
        ...(a ? { t_ms: a.start_ms, ...(a.target_box ? { target_box: a.target_box } : {}) } : {}),
        ...(error ? { error: error.message.split("\n")[0] } : {}), ...(fresh.length ? { problems: fresh } : {}) });
    },
  };

  const browser = await launchBrowser();
  try {
    out({ ready: true, plugin: m.name, session: name, out_dir: path.join(m.outDir, clip ? "clips" : name), clip, ops: Object.keys(schema.$defs.step.properties) });
    const r = await runScript(m, null, browser, { clip, force, live, locale, steps: steps(), script: { name, continue_on_error: true } });
    if (save) exportScript(save);
    // A clip with a failed step (or strict problem) is not published: no shots, previous output unchanged, take kept in `evidence`.
    out({ done: true, shots: r.shots, problems: r.problems, ...(r.evidence ? { evidence: r.evidence } : {}) });
  } finally { await browser.close(); }
  return 0;
}
