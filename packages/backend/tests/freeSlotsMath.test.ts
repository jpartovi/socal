import { describe, expect, it } from "vitest";
import {
  computeGroupFreeSlots,
  complementInWindow,
  eventsToBusyIntervals,
  expandIntervalsByPadding,
  filterByMinDuration,
  mergeIntervals,
} from "../convex/agentCore/freeSlotsMath";

const MIN = 60 * 1000;

describe("eventsToBusyIntervals", () => {
  it("drops all-day events", () => {
    const rows = [
      { event: { start: 0, end: 100, allDay: true, summary: "x" } },
      { event: { start: 200, end: 300, allDay: false, summary: "y" } },
    ];
    expect(eventsToBusyIntervals(rows)).toEqual([{ start: 200, end: 300 }]);
  });
});

describe("expandIntervalsByPadding", () => {
  it("merges nearby events when padding bridges the gap (15m)", () => {
    // Two 1-minute meetings at T+10m and T+20m, 9m apart; 15m padding each
    // side merges into one block (starts at T+10m-15m = T-5m).
    const a = 10 * MIN;
    const b = 20 * MIN;
    const p = 15 * MIN;
    const expanded = expandIntervalsByPadding(
      [
        { start: a, end: a + MIN },
        { start: b, end: b + MIN },
      ],
      p,
    );
    const merged = mergeIntervals(expanded);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start).toBe(a - p);
    expect(merged[0]!.end).toBe(b + MIN + p);
  });
});

describe("computeGroupFreeSlots", () => {
  it("returns full window when no events", () => {
    const w0 = 1000;
    const w1 = 2000;
    const free = computeGroupFreeSlots([[]], w0, w1, 0, 0);
    expect(free).toEqual([{ start: w0, end: w1 }]);
  });

  it("drops gaps shorter than slotDurationMinutes", () => {
    const w0 = 0;
    const w1 = 60 * MIN;
    const free = computeGroupFreeSlots(
      [[{ start: 0, end: 45 * MIN, allDay: false }]],
      w0,
      w1,
      0,
      60 * MIN,
    );
    expect(free).toEqual([]);
  });

  it("intersects free time across two users (union of busies, then invert)", () => {
    const w0 = 0;
    const w1 = 4 * 60 * MIN;
    const free = computeGroupFreeSlots(
      [
        [{ start: 0, end: 60 * MIN, allDay: false }],
        [{ start: 60 * MIN, end: 120 * MIN, allDay: false }],
      ],
      w0,
      w1,
      0,
      15 * MIN,
    );
    expect(free).toEqual([{ start: 120 * MIN, end: 240 * MIN }]);
  });

  it("ignores all-day for slot finding", () => {
    const w0 = 0;
    const w1 = 120 * MIN;
    const free = computeGroupFreeSlots(
      [[{ start: 0, end: 120 * MIN, allDay: true }]],
      w0,
      w1,
      0,
      60 * MIN,
    );
    expect(free).toEqual([{ start: 0, end: 120 * MIN }]);
  });

  it("90 min raw gap fits 60 min min slot with 15 min padding (60 min free after expand)", () => {
    const w0 = 0;
    const w1 = 200 * MIN;
    const p = 15 * MIN;
    // Busy 0–30m and 120–150m → 90m gap 30m–120m; after padding, free 45m–105m = 60m.
    const free = computeGroupFreeSlots(
      [
        [
          { start: 0, end: 30 * MIN, allDay: false },
          { start: 120 * MIN, end: 150 * MIN, allDay: false },
        ],
      ],
      w0,
      w1,
      p,
      60 * MIN,
    );
    expect(free).toEqual([{ start: 45 * MIN, end: 105 * MIN }]);
  });

  it("59.5m free after expand still passes 60m min (leniency slack for long slots)", () => {
    const w0 = 0;
    const w1 = 200 * MIN;
    const p = 15 * MIN;
    // Raw gap 89.5m so expanded free = 59.5m — just under 60; 60s slack recovers 60m-class fits.
    const t1195m = 119.5 * 60 * 1000;
    const free = computeGroupFreeSlots(
      [
        [
          { start: 0, end: 30 * MIN, allDay: false },
          { start: t1195m, end: t1195m + 30 * MIN, allDay: false },
        ],
      ],
      w0,
      w1,
      p,
      60 * MIN,
    );
    expect(free).toHaveLength(1);
    expect(free[0]!.end - free[0]!.start).toBe(59.5 * 60 * 1000);
  });
});

describe("complementInWindow", () => {
  it("yields two gaps when busy is in the middle", () => {
    const w0 = 0;
    const w1 = 100;
    const free = complementInWindow(
      mergeIntervals([{ start: 40, end: 60 }]),
      w0,
      w1,
    );
    expect(free).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });
});

describe("filterByMinDuration", () => {
  it("removes short intervals", () => {
    expect(
      filterByMinDuration(
        [
          { start: 0, end: 10 },
          { start: 20, end: 100 },
        ],
        15,
      ),
    ).toEqual([{ start: 20, end: 100 }]);
  });
});
