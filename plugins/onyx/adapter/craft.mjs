// Craft. World section: craft. Not derived yet: implement derive().
import { rejectUnderived } from "./shared.mjs";

export const sections = ["craft"];

export function derive({ app, script }) {
  rejectUnderived(app, sections, script);
}
