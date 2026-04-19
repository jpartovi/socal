export type CalendarView =
  | "agenda"
  | "day"
  | "3day"
  | "4day"
  | "week"
  | "month";

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

export function startOfWeek(d: Date): Date {
  // Sunday-start, matching Google Calendar's default.
  const out = startOfDay(d);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

export function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function numDaysFor(view: CalendarView): number {
  switch (view) {
    case "day":
      return 1;
    case "3day":
      return 3;
    case "4day":
      return 4;
    case "week":
      return 7;
    default:
      return 0;
  }
}

// The [start, end) window the given view + anchor needs. Used both to drive
// the Convex query and to lay out the UI.
export function rangeFor(
  view: CalendarView,
  anchor: Date,
): { start: Date; end: Date } {
  if (view === "month") {
    const monthStart = startOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    const end = addDays(gridStart, 42); // 6 weeks
    return { start: gridStart, end };
  }
  if (view === "agenda") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 30) };
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  const n = numDaysFor(view);
  const start = startOfDay(anchor);
  return { start, end: addDays(start, n) };
}

export function stepFor(view: CalendarView): { unit: "day" | "month"; n: number } {
  switch (view) {
    case "month":
      return { unit: "month", n: 1 };
    case "week":
      return { unit: "day", n: 7 };
    case "day":
      return { unit: "day", n: 1 };
    case "3day":
      return { unit: "day", n: 3 };
    case "4day":
      return { unit: "day", n: 4 };
    case "agenda":
      return { unit: "day", n: 7 };
  }
}

export function navigate(
  view: CalendarView,
  anchor: Date,
  direction: 1 | -1,
): Date {
  const { unit, n } = stepFor(view);
  return unit === "month" ? addMonths(anchor, n * direction) : addDays(anchor, n * direction);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function titleFor(view: CalendarView, anchor: Date): string {
  if (view === "month") {
    return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  if (view === "agenda") {
    return `Upcoming from ${anchor.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`;
  }
  if (view === "week") {
    return `Week ${isoWeek(startOfWeek(anchor))}`;
  }
  const start = startOfDay(anchor);
  const end = addDays(start, numDaysFor(view) - 1);
  return rangeLabel(start, end);
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7,
  );
}

function rangeLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const s = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const e = end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${s} – ${e}, ${end.getFullYear()}`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Extract a short tz name like "PDT" / "EST" for the given date. Forces
// en-US so we get named abbreviations ("EDT") instead of the user locale's
// "GMT-4" style. Falls back to the browser label, then to the IANA id.
export function shortTimeZoneLabel(date = new Date()): string {
  const preferred = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  if (preferred && !preferred.startsWith("GMT")) return preferred;
  const localized = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  return localized ?? preferred ?? deviceTimeZone();
}

export function formatDayHeader(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
