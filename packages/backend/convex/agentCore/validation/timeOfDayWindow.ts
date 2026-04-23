// Time-of-day windows for activity keywords. Pure TS (no Convex).
//
// The agent's system prompt already states that e.g. "dinner" should land in
// 6pm–9pm, but in practice the model occasionally emits 3pm dinners or 4am
// coffees because those rules are buried in a long prompt. This validator
// turns the rule into a hard constraint: propose_event_creation rejects any
// option whose summary matches an activity keyword and whose local start
// time falls outside the allowed window. The agent then retries with a
// corrected time.
//
// Windows mirror what the prompt describes so the model and the validator
// agree. Keyword matching uses word boundaries to avoid false positives
// (e.g. "running" shouldn't match "run" but "dinner" should match "birthday
// dinner").

type Window = readonly [startMinutes: number, endMinutes: number];

type Activity = {
  keywords: string[];
  label: string;
  windows: Window[];
};

// Order matters: more specific / later-evening activities come first so that
// an ambiguous summary like "post-dinner drinks" matches "drinks" (10pm ok)
// before it matches "dinner" (10pm rejected).
const ACTIVITIES: Activity[] = [
  {
    keywords: ["drinks", "cocktail", "cocktails", "happy hour", "beer", "wine", "bar"],
    label: "drinks",
    windows: [[17 * 60, 22 * 60]],
  },
  {
    keywords: ["dinner", "supper"],
    label: "dinner",
    windows: [[18 * 60, 21 * 60]],
  },
  {
    keywords: ["breakfast"],
    label: "breakfast",
    windows: [[7 * 60, 10 * 60]],
  },
  {
    keywords: ["brunch"],
    label: "brunch",
    windows: [[10 * 60, 13 * 60]],
  },
  {
    keywords: ["lunch"],
    label: "lunch",
    // 11:30am–2:30pm. Wider than the classic lunch window because busy users
    // often can't carve 12–1pm out of a packed mid-day; 2pm lunches are
    // normal and we don't want the validator bouncing them.
    windows: [[11 * 60 + 30, 14 * 60 + 30]],
  },
  {
    keywords: ["coffee", "tea", "espresso", "latte", "cappuccino"],
    label: "coffee/tea",
    windows: [[8 * 60, 16 * 60]],
  },
  {
    keywords: ["workout", "gym", "yoga", "pilates", "crossfit", "lift weights"],
    label: "workout",
    windows: [
      [6 * 60, 9 * 60],
      [17 * 60, 20 * 60],
    ],
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchActivity(summary: string): Activity | null {
  const lower = summary.toLowerCase();
  for (const a of ACTIVITIES) {
    for (const kw of a.keywords) {
      const re = new RegExp(`\\b${escapeRe(kw)}\\b`, "i");
      if (re.test(lower)) return a;
    }
  }
  return null;
}

// Minutes-since-midnight for a UTC ms timestamp as observed in the given
// IANA timezone. Falls back to UTC when no zone is supplied so callers don't
// have to branch.
function localMinutesOfDay(ms: number, timeZone: string | undefined): number {
  if (!timeZone) {
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function formatMin(min: number): string {
  const h24 = Math.floor(min / 60);
  const mm = min % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "am" : "pm";
  return mm === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

/**
 * Returns a tool-readable error describing the violation, or null when the
 * summary doesn't match any tracked activity or the time sits inside the
 * allowed window.
 */
export function timeOfDayWindowError(
  summary: string,
  start: number,
  userTimeZone: string | undefined,
): string | null {
  const activity = matchActivity(summary);
  if (activity === null) return null;
  const mins = localMinutesOfDay(start, userTimeZone);
  const inside = activity.windows.some(([a, b]) => mins >= a && mins < b);
  if (inside) return null;
  const windowsLabel = activity.windows
    .map(([a, b]) => `${formatMin(a)}–${formatMin(b)}`)
    .join(" or ");
  return (
    `Time-of-day check: "${summary}" starts at ${formatMin(mins)} local, but ${activity.label} belongs in ${windowsLabel}. ` +
    `Pick a start time inside the window and retry the whole batch. ` +
    `If the user EXPLICITLY asked for an off-hours ${activity.label} (e.g. "dinner at 3pm"), set timeOfDayOverride: true — ` +
    `otherwise fix the time. Do not relabel the event to dodge this check.`
  );
}
