// Runner-only state API plumbing shared by the mock server (writes the secret) and the runner (reads it, then calls the API).
import fs from "node:fs";
import path from "node:path";

// One secret per mock port, so concurrent mocks of one checkout (MOCKSHOP_PORT_OFFSET) never overwrite each other's.
export const stateTokenFile = (m) => path.join(m.logsDir, `state-api.${m.ports.mock}.token`);

// Reader for one run: read("/agents/guest-ops") -> parsed body, undefined on 404, throws on anything else.
export function stateReader(m) {
  const base = `http://127.0.0.1:${m.ports.mock}/__mockshop/state`;
  return async (statePath) => {
    const file = stateTokenFile(m);
    if (!fs.existsSync(file)) throw new Error(`state API token ${file} is missing: the mock was not started from this checkout`);
    const res = await fetch(`${base}${statePath}`, { headers: { "x-mockshop-runner": fs.readFileSync(file, "utf8") } });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`state API ${statePath} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
}
