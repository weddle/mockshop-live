// Billing. World section: billing. Not derived yet: implement derive() when billing cases move out of /mockshop/* routes.
import { rejectUnderived } from "./shared.mjs";

export const sections = ["billing"];

export function derive({ app, script }) {
  rejectUnderived(app, sections, script);
}
