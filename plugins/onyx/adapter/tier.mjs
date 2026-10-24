// Tier. World section: tier (community | business | enterprise). Not derived yet: implement derive() to feed /settings.tier.
import { rejectUnderived } from "./shared.mjs";

export const sections = ["tier"];

export function derive({ app, script }) {
  rejectUnderived(app, sections, script);
}
