// Pure interval math for get_free_slots (no Convex).

/** Half-open [start, end) in epoch ms. */
export type MsInterval = { start: number; end: number };

export function eventsToBusyIntervals(
  rows: Array<{ event: { start: number; end: number; allDay?: boolean } }>,
): MsInterval[] {
  return rows
    .filter((r) => r.event.allDay !== true)
    .map((r) => ({ start: r.event.start, end: r.event.end }));
}

export function expandIntervalsByPadding(
  intervals: MsInterval[],
  paddingMs: number,
): MsInterval[] {
  if (paddingMs <= 0) {
    return intervals.map((i) => ({ start: i.start, end: i.end }));
  }
  return intervals.map((i) => ({
    start: i.start - paddingMs,
    end: i.end + paddingMs,
  }));
}

/**
 * Merges overlapping or touching half-open intervals.
 */
export function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MsInterval[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const x = sorted[i]!;
    if (x.start <= cur.end) {
      cur.end = Math.max(cur.end, x.end);
    } else {
      out.push(cur);
      cur = { ...x };
    }
  }
  out.push(cur);
  return out;
}

/** Union of several interval sets: concatenate and merge. */
export function unionIntervalSets(sets: MsInterval[][]): MsInterval[] {
  return mergeIntervals(sets.flat());
}

/**
 * Clips every interval to [windowStart, windowEnd), drops empty clips, merges.
 */
export function clipIntervalsToWindow(
  intervals: MsInterval[],
  windowStart: number,
  windowEnd: number,
): MsInterval[] {
  if (windowEnd <= windowStart) return [];
  const clipped: MsInterval[] = [];
  for (const iv of intervals) {
    const s = Math.max(iv.start, windowStart);
    const e = Math.min(iv.end, windowEnd);
    if (s < e) clipped.push({ start: s, end: e });
  }
  return mergeIntervals(clipped);
}

/**
 * `busy` must be merged. Returns maximal free sub-intervals of [windowStart, windowEnd).
 */
export function complementInWindow(
  busy: MsInterval[],
  windowStart: number,
  windowEnd: number,
): MsInterval[] {
  if (windowEnd <= windowStart) return [];
  const sorted = mergeIntervals(
    busy.filter((i) => i.start < i.end && i.end > windowStart && i.start < windowEnd),
  );
  const free: MsInterval[] = [];
  let cursor = windowStart;
  for (const b of sorted) {
    const blockStart = Math.max(b.start, windowStart);
    const blockEnd = Math.min(b.end, windowEnd);
    if (blockStart >= windowEnd) break;
    if (cursor < blockStart) {
      free.push({ start: cursor, end: blockStart });
    }
    cursor = Math.max(cursor, blockEnd);
    if (cursor >= windowEnd) return free;
  }
  if (cursor < windowEnd) {
    free.push({ start: cursor, end: windowEnd });
  }
  return free;
}

/**
 * @param slackMs — Optional length tolerance (e.g. calendar-source rounding) so
 *   a 60 min slot is not dropped when the free window is 59:59. Only applied
 *   when the caller passes it; `computeGroupFreeSlots` uses slack for 60+ min
 *   minimums so a 90 min raw gap (→ 60 min after 15+15 padding) still fits.
 */
export function filterByMinDuration(
  intervals: MsInterval[],
  minDurationMs: number,
  slackMs = 0,
): MsInterval[] {
  if (minDurationMs <= 0) return intervals;
  return intervals.filter(
    (i) => i.end - i.start + slackMs >= minDurationMs,
  );
}

/** 60+ minute min slots: absorb sub-minute boundary noise from synced events. */
const MIN_SLOT_LENIENCY_SLACK_MS = 60_000;

/**
 * `schedules[i]` = that user's events (start/end/allDay) in the search window.
 * Drops all-day; applies padding per timed event; unions busy across users;
 * returns free windows inside [windowStart, windowEnd) at least `minSlotDurationMs`.
 */
function busyIntervalsForUser(
  events: Array<{ start: number; end: number; allDay?: boolean }>,
  paddingMs: number,
): MsInterval[] {
  const timed = events.filter((e) => e.allDay !== true);
  const raw = timed.map((e) => ({ start: e.start, end: e.end }));
  return mergeIntervals(expandIntervalsByPadding(raw, paddingMs));
}

export function computeGroupFreeSlots(
  schedules: Array<Array<{ start: number; end: number; allDay?: boolean }>>,
  windowStart: number,
  windowEnd: number,
  paddingMs: number,
  minSlotDurationMs: number,
): MsInterval[] {
  if (windowEnd <= windowStart) return [];

  const perUser = schedules.map((events) => busyIntervalsForUser(events, paddingMs));
  const busyUnion = unionIntervalSets(perUser);
  const busyInWindow = clipIntervalsToWindow(busyUnion, windowStart, windowEnd);
  const free = complementInWindow(busyInWindow, windowStart, windowEnd);
  const slack =
    minSlotDurationMs >= 60 * 60 * 1000 ? MIN_SLOT_LENIENCY_SLACK_MS : 0;
  return filterByMinDuration(free, minSlotDurationMs, slack);
}
