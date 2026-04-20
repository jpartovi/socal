// Timezone formatting helpers. Pure TS — no Convex imports, no "use node"
// directive — so this module is cheap to import from anywhere (tools, prompt
// builder, queries) and trivially unit-testable.

// Format a UTC millisecond timestamp as ISO 8601 in the given IANA timezone,
// e.g. `isoInZone(ts, "America/Los_Angeles")` → "2026-04-19T12:30:00-07:00".
// When the timezone is missing/empty, falls back to UTC ("...Z") so callers
// never have to branch.
//
// Implementation note: we extract the zone-local Y/M/D/H/M/S via Intl, then
// recover the numeric offset by reading those components "as if UTC" and
// subtracting the real instant. This avoids parsing `timeZoneName` strings
// (which vary across runtimes: "GMT-7", "GMT-07:00", etc.).
export function isoInZone(ms: number, timeZone?: string): string {
  if (!timeZone) return new Date(ms).toISOString();
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const offsetMinutes = Math.round((asIfUtc - d.getTime()) / 60000);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${formatOffset(offsetMinutes)}`;
}

/**
 * Calendar date YYYY-MM-DD in the given IANA zone for this instant.
 * For all-day display: use the event's start instant; for an exclusive end
 * instant from Google, use `endMs - 1` to get the inclusive last day.
 */
export function localDateOnlyInZone(ms: number, timeZone?: string): string {
  const d = new Date(ms);
  if (!timeZone) return d.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "Z";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
