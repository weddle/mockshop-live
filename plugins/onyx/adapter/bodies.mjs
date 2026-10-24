// History and source bodies: apps.onyx.history / apps.onyx.source_bodies verbatim files.
import fs from "node:fs";
import path from "node:path";
import { entries, fileKey, fail, writeYaml } from "./shared.mjs";

export function derive(ctx) {
  const { app, script, outputDir, project } = ctx;
  for (const [id, history] of entries(app.history)) {
    if (!fileKey(id)) fail(`apps.onyx.history.${id}`, "unsafe history ID", script);
    writeYaml(path.join(outputDir, "history", `${id}.yaml`), project(history));
  }
  for (const [id, body] of entries(app.source_bodies)) {
    if (!fileKey(id) || typeof body !== "string") fail(`apps.onyx.source_bodies.${id}`, "expected safe source ID and text body", script);
    fs.mkdirSync(path.join(outputDir, "sources"), { recursive: true }); fs.writeFileSync(path.join(outputDir, "sources", `${id}.md`), body);
  }
}
