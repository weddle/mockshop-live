// Time helpers. Two kinds of time in Mockshop:
//  - Records (reports, logs, manifests, notes): absolute ISO 8601 with the local offset, e.g. 2026-10-09T07:10:00-04:00.
//    Zone = $MOCKSHOP_TZ, default America/New_York.
//  - Demo times (what the mocked UI shows): stay relative ("22 minutes ago"). Fixture templates like {{ago:2h}}
//    resolve against the demo anchor = the start of the script/recording, so a re-run shows the same relative times.
const TZ = process.env.MOCKSHOP_TZ || "America/New_York";

// Absolute timestamp for records: local wall time + numeric offset (seconds precision; ms optional).
export function isoLocal(d = new Date(), { ms = false } = {}) {
  const date = d instanceof Date ? d : new Date(d);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const off = Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = off < 0 ? "-" : "+", a = Math.abs(off);
  const frac = ms ? `.${String(date.getMilliseconds()).padStart(3, "0")}` : "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${frac}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

// Seconds from a start instant (ms epoch) -> number with 0.01 s precision, for offsets from video start.
export const offsetS = (t, t0) => Math.round((t - t0) / 10) / 100;
