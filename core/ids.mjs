// Stable entity identity. An ID is a pure function of <namespace>:<collection>:<key>, never of declaration order, so adding or
// reordering entities in a world changes no other entity's ID. An explicit `id:` in the world always wins over the derived value.
import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest("hex");

// Non-negative integer in [1000, 2_000_001_000): clear of built-in IDs (0, 1, ...) that Onyx assigns natively.
export const stableNumber = (namespace, collection, key) => parseInt(digest(`${namespace}:${collection}:${key}`).slice(0, 8), 16) % 2000000000 + 1000;

export const stableUuid = (namespace, collection, key) => {
  const h = digest(`${namespace}:${collection}:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export const stableId = (type, namespace, collection, key) => (type === "uuid" ? stableUuid : stableNumber)(namespace, collection, key);
