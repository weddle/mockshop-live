// Sparse workspace settings (registry module, area: world).
// Fixtures hold ONE full base object (fixtures/base/10-settings.yaml). Edition overlays state only what they change, so the base
// fills in everything else here. Runs before the core composition (negative order) so Extras/Auth/Admin transforms see a complete object.
// The app version is not handled here: the base fixture carries `{{plugin.ref}}`, resolved from plugin.yaml upstream.ref by core/fixtures.mjs.
import fs from "node:fs";
import path from "node:path";

export const order = -100;

export default function createWorldSettings(core) {
  const baseDir = path.join(core.plugin.fixturesDir, "base");
  let cached = { file: null, mtime: 0, value: null };
  // The base object lives in whichever base/*.yaml declares `GET /settings`; re-read when that file changes (fixtures hot-reload).
  const baseSettings = () => {
    if (!cached.file) {
      cached.file = fs.readdirSync(baseDir).sort().map((f) => path.join(baseDir, f))
        .find((f) => /\.ya?ml$/.test(f) && /^GET \/settings:/m.test(fs.readFileSync(f, "utf8")));
      if (!cached.file) throw new Error(`no base fixture declares GET /settings in ${baseDir}`);
    }
    const mtime = fs.statSync(cached.file).mtimeMs;
    if (mtime !== cached.mtime) cached = { ...cached, mtime, value: core.parseYaml(cached.file)["GET /settings"] };
    return cached.value;
  };
  return {
    transform: {
      "GET /settings": (value) => (value?.__status ? value : { ...baseSettings(), ...value }),
    },
  };
}
