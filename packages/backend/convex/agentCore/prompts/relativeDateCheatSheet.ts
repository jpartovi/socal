// Pure TS — maps colloquial relative dates to concrete ranges for the agent.

import {
  isoInZone,
  localDateOnlyInZone,
  zonedWallClockToUtcMillis,
} from "../../timezone";

export type RelativeDateCheatSheetContext = {
  nowIso: string;
  userTimeZone?: string;
};

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function addDaysToYmd(ymd: string, delta: number): string {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Monday = 0 … Sunday = 6 (Python `weekday()`). */
function mondayBasedWeekday(ymd: string): number {
  const { y, m, d } = parseYmd(ymd);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (jsDay + 6) % 7;
}

function hourInZone(ms: number, timeZone: string | undefined): number {
  if (!timeZone) return new Date(ms).getUTCHours();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

function formatDate(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const abbr = DAY_ABBR[(jsDay + 6) % 7];
  return `${abbr} ${m}/${d}/${String(y).slice(-2)}`;
}

function formatDateRange(
  startYmd: string,
  endYmd: string,
  tz: string | undefined,
): string {
  const { y: sy, m: sm, d: sd } = parseYmd(startYmd);
  const { y: ey, m: em, d: ed } = parseYmd(endYmd);
  const startMs = zonedWallClockToUtcMillis(tz, sy, sm, sd, 0, 0, 0);
  const endMs = zonedWallClockToUtcMillis(tz, ey, em, ed, 23, 59, 59);
  return `(${isoInZone(startMs, tz)} to ${isoInZone(endMs, tz)})`;
}

function formatDayRange(ymd: string, tz: string | undefined): string {
  return formatDateRange(ymd, ymd, tz);
}

export function buildRelativeDatesCheatSheet(
  ctx: RelativeDateCheatSheetContext,
): string {
  const nowMs = Date.parse(ctx.nowIso);
  const tz = ctx.userTimeZone;
  const today = localDateOnlyInZone(nowMs, tz);
  const currentHour = hourInZone(nowMs, tz);
  const isEarlyMorning = currentHour < 4;
  const todayWd = mondayBasedWeekday(today);
  const isWeekday = todayWd < 5;

  const items: string[] = [];
  items.push("RELATIVE DATES CHEAT SHEET:");

  items.push(`- "today": ${formatDate(today)} ${formatDayRange(today, tz)}`);

  let tomorrowDate: string;
  let tomorrowNote: string;
  if (isEarlyMorning) {
    tomorrowDate = today;
    tomorrowNote =
      " (NOTE: Assuming user hasn't slept yet this night)";
  } else {
    tomorrowDate = addDaysToYmd(today, 1);
    tomorrowNote = "";
  }
  items.push(
    `- "tomorrow": ${formatDate(tomorrowDate)} ${formatDayRange(tomorrowDate, tz)}${tomorrowNote}`,
  );

  let dayAfterDate: string;
  let dayAfterNote: string;
  if (isEarlyMorning) {
    dayAfterDate = addDaysToYmd(today, 1);
    dayAfterNote =
      " (NOTE: Assuming user hasn't slept yet this night)";
  } else {
    dayAfterDate = addDaysToYmd(tomorrowDate, 1);
    dayAfterNote = "";
  }
  items.push(
    `- "day after tomorrow" / "day after next": ${formatDate(dayAfterDate)} ${formatDayRange(dayAfterDate, tz)}${dayAfterNote}`,
  );

  for (let i = 0; i < 7; i++) {
    const dayName = WEEKDAY_NAMES[i];
    // Euclidean modulo — JS `%` keeps negatives; Python `%` does not.
    let daysAhead = ((i - todayWd) % 7 + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    const nextDate = addDaysToYmd(today, daysAhead);
    items.push(
      `- "${dayName}": ${formatDate(nextDate)} ${formatDayRange(nextDate, tz)}`,
    );
  }

  let thisWeekStart: string;
  let thisWeekEnd: string;
  let thisWeekendSat: string;
  let thisWeekendSun: string;
  let nextWeekStart: string;
  let nextWeekEnd: string;
  let nextWeekendSat: string;
  let nextWeekendSun: string;

  if (isWeekday) {
    const daysSinceMonday = todayWd;
    thisWeekStart = addDaysToYmd(today, -daysSinceMonday);
    thisWeekEnd = addDaysToYmd(thisWeekStart, 4);

    let daysUntilSaturday = (5 - todayWd) % 7;
    if (daysUntilSaturday === 0) daysUntilSaturday = 7;
    thisWeekendSat = addDaysToYmd(today, daysUntilSaturday);
    thisWeekendSun = addDaysToYmd(thisWeekendSat, 1);

    nextWeekStart = addDaysToYmd(thisWeekStart, 7);
    nextWeekEnd = addDaysToYmd(nextWeekStart, 4);

    nextWeekendSat = addDaysToYmd(thisWeekendSat, 7);
    nextWeekendSun = addDaysToYmd(nextWeekendSat, 1);
  } else {
    let daysUntilMonday = (7 - todayWd) % 7;
    if (daysUntilMonday === 0) daysUntilMonday = 7;
    thisWeekStart = addDaysToYmd(today, daysUntilMonday);
    thisWeekEnd = addDaysToYmd(thisWeekStart, 4);

    if (todayWd === 5) {
      thisWeekendSat = today;
      thisWeekendSun = addDaysToYmd(today, 1);
    } else {
      thisWeekendSat = addDaysToYmd(today, -1);
      thisWeekendSun = today;
    }

    nextWeekStart = addDaysToYmd(thisWeekStart, 7);
    nextWeekEnd = addDaysToYmd(nextWeekStart, 4);

    nextWeekendSat = addDaysToYmd(thisWeekendSat, 7);
    nextWeekendSun = addDaysToYmd(nextWeekendSat, 1);
  }

  items.push(
    `- "this week": ${formatDate(thisWeekStart)} - ${formatDate(thisWeekEnd)} ${formatDateRange(thisWeekStart, thisWeekEnd, tz)}`,
  );
  items.push(
    `- "this weekend": ${formatDate(thisWeekendSat)} - ${formatDate(thisWeekendSun)} ${formatDateRange(thisWeekendSat, thisWeekendSun, tz)}`,
  );
  items.push(
    `- "next week": ${formatDate(nextWeekStart)} - ${formatDate(nextWeekEnd)} ${formatDateRange(nextWeekStart, nextWeekEnd, tz)}`,
  );
  items.push(
    `- "next weekend": ${formatDate(nextWeekendSat)} - ${formatDate(nextWeekendSun)} ${formatDateRange(nextWeekendSat, nextWeekendSun, tz)}`,
  );

  for (let i = 0; i < 7; i++) {
    const dayName = WEEKDAY_NAMES[i];
    let nextXDate: string;
    if (i < 5) {
      nextXDate = addDaysToYmd(nextWeekStart, i);
    } else if (i === 5) {
      nextXDate = nextWeekendSat;
    } else {
      nextXDate = nextWeekendSun;
    }
    items.push(
      `- "next ${dayName}": ${formatDate(nextXDate)} ${formatDayRange(nextXDate, tz)}`,
    );
  }

  const weekAfterNextStart = addDaysToYmd(nextWeekStart, 7);
  const weekAfterNextEnd = addDaysToYmd(weekAfterNextStart, 4);
  items.push(
    `- "week after next": ${formatDate(weekAfterNextStart)} - ${formatDate(weekAfterNextEnd)} ${formatDateRange(weekAfterNextStart, weekAfterNextEnd, tz)}`,
  );

  const weekendAfterNextSat = addDaysToYmd(nextWeekendSat, 7);
  const weekendAfterNextSun = addDaysToYmd(weekendAfterNextSat, 1);
  items.push(
    `- "weekend after next": ${formatDate(weekendAfterNextSat)} - ${formatDate(weekendAfterNextSun)} ${formatDateRange(weekendAfterNextSat, weekendAfterNextSun, tz)}`,
  );

  return items.join("\n");
}
