import assert from "node:assert/strict";
import test from "node:test";
import { setPluginVars, tmpl } from "./fixtures.mjs";

test("{{plugin.*}} resolves from the values the server sets and leaves unknown names literal", () => {
  setPluginVars({ "plugin.ref": "v9.9.9" });
  assert.equal(tmpl('{"version":"{{plugin.ref}}","other":"{{plugin.nope}}"}'), '{"version":"v9.9.9","other":"{{plugin.nope}}"}');
});
