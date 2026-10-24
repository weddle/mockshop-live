// World state flags (apps.onyx.state.<area>.<flag>, schema-validated by validateApp). Handlers read them per request through
// core.data("state"), which layers <overlay>/state.json files; the runner reads state.browser to seed web storage. Always written so
// the file exists for every compiled world ({} when the world sets no flags).
import fs from "node:fs";
import path from "node:path";

export const sections = ["state"];

export function derive({ app, outputDir }) {
  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(app.state || {}, null, 2));
}
