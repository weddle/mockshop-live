import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { cacheRoot } from "./cache.mjs";

test("MOCKSHOP_PIN_CACHE overrides the pin cache location", () => {
  assert.equal(cacheRoot({ MOCKSHOP_PIN_CACHE: "/tmp/pins", XDG_CACHE_HOME: "/x", HOME: "/h" }), "/tmp/pins");
  assert.equal(cacheRoot({ MOCKSHOP_PIN_CACHE: "rel/pins", HOME: "/h" }), path.resolve("rel/pins"));
});

test("the default is the per-user cache dir: $XDG_CACHE_HOME/mockshop/pins, else ~/.cache/mockshop/pins", () => {
  assert.equal(cacheRoot({ XDG_CACHE_HOME: "/var/cache/me", HOME: "/h" }), "/var/cache/me/mockshop/pins");
  assert.equal(cacheRoot({ HOME: "/h" }), "/h/.cache/mockshop/pins");
  assert.equal(cacheRoot({ XDG_CACHE_HOME: "relative", HOME: "/h" }), "/h/.cache/mockshop/pins");
  assert.equal(cacheRoot({}), path.join(os.homedir(), ".cache", "mockshop", "pins"));
});
