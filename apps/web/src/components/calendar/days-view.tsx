"use client";

import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";

import { EventPopover } from "@/components/calendar/event-popover";
import {
  addDays,
  formatTime,
  sameDay,
  shortTimeZoneLabel,
  startOfDay,
} from "@/components/calendar/lib";
import type { EventRow } from "@/components/calendar/types";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48; // px per hour in the grid
const DEFAULT_SCROLL_HOUR = 7; // match Google Calendar's default morning anchor
const SNAP_MS = 15 * 60_000;
const DRAG_THRESHOLD_PX = 4;
const MIN_EVENT_MS = 15 * 60_000;

type MoveEventArgs = {
  eventId: Id<"events">;
  start: number;
  end: number;
};

type CreateEventArgs = {
  start: number;
  end: number;
};

type DragState = {
  eventId: string;
  mode: "move" | "resize";
  originalStart: number;
  originalEnd: number;
  pointerStartY: number;
  deltaMs: number;
  active: boolean;
  pointerId: number;
};

type CreateDragState = {
  pointerStartY: number;
  currentOffsetY: number;
  active: boolean;
  pointerId: number;
};

function isWritable(row: EventRow): boolean {
  const r = row.calendar.accessRole;
  return (r === "owner" || r === "writer") && !row.event.allDay;
}

type Positioned = {
  row: EventRow;
  startMs: number;
  endMs: number;
  topPct: number;
  heightPct: number;
  lane: number;
  lanes: number;
  span: number;
};

// Lay out overlapping events in vertical lanes within each day's column.
// Algorithm: greedy lane packing (the smallest lane whose previous event has
// ended), then group events into connected components of transitive overlap
// and, within each component, let every event extend right into any lane no
// overlapping sibling occupies. This mirrors Google Calendar's look and
// keeps rendering consistent across overlap shapes.
function layoutDay(rows: EventRow[], dayStart: Date): Positioned[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 86400_000;

  type Packed = {
    row: EventRow;
    startMs: number;
    endMs: number;
    lane: number;
  };

  const clipped = rows
    .filter((r) => !r.event.allDay)
    .map((r) => {
      const startMs = Math.max(r.event.start, dayStartMs);
      const endMs = Math.min(r.event.end, dayEndMs);
      return endMs > startMs ? { row: r, startMs, endMs } : null;
    })
    .filter((x): x is { row: EventRow; startMs: number; endMs: number } =>
      x !== null,
    )
    .sort((a, b) =>
      a.startMs === b.startMs ? b.endMs - a.endMs : a.startMs - b.startMs,
    );

  const laneEnd: number[] = [];
  const packed: Packed[] = clipped.map((e) => {
    let lane = laneEnd.findIndex((end) => end <= e.startMs);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(e.endMs);
    } else {
      laneEnd[lane] = e.endMs;
    }
    return { row: e.row, startMs: e.startMs, endMs: e.endMs, lane };
  });

  const parent = packed.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      if (packed[j].startMs >= packed[i].endMs) continue;
      if (packed[i].startMs < packed[j].endMs) {
        parent[find(i)] = find(j);
      }
    }
  }

  const compLanes = new Map<number, number>();
  for (let i = 0; i < packed.length; i++) {
    const c = find(i);
    compLanes.set(c, Math.max(compLanes.get(c) ?? 0, packed[i].lane + 1));
  }

  return packed.map((e, i) => {
    const comp = find(i);
    const lanes = compLanes.get(comp) ?? 1;
    let span = 1;
    while (e.lane + span < lanes) {
      const nextLane = e.lane + span;
      const conflict = packed.some(
        (o, j) =>
          j !== i &&
          find(j) === comp &&
          o.lane === nextLane &&
          o.endMs > e.startMs &&
          o.startMs < e.endMs,
      );
      if (conflict) break;
      span++;
    }
    return {
      row: e.row,
      startMs: e.startMs,
      endMs: e.endMs,
      topPct: ((e.startMs - dayStartMs) / 86400_000) * 100,
      heightPct: ((e.endMs - e.startMs) / 86400_000) * 100,
      lane: e.lane,
      lanes,
      span,
    };
  });
}

export function DaysView({
  events,
  anchor,
  numDays,
  onMoveEvent,
  onCreateEvent,
}: {
  events: EventRow[];
  anchor: Date;
  numDays: number;
  onMoveEvent: (args: MoveEventArgs) => void;
  onCreateEvent: ((args: CreateEventArgs) => void) | null;
}) {
  const days: Date[] = [];
  for (let i = 0; i < numDays; i++) {
    days.push(addDays(startOfDay(anchor), i));
  }

  // Bucket timed events only; all-day events render as spanning segments in
  // AllDayRow and must not appear in any day column.
  const eventsByDay = new Map<number, EventRow[]>();
  for (const day of days) eventsByDay.set(day.getTime(), []);
  for (const row of events) {
    if (row.event.allDay) continue;
    const first = startOfDay(new Date(row.event.start));
    const last = startOfDay(new Date(row.event.end - 1));
    let cur = first;
    while (cur.getTime() <= last.getTime()) {
      const list = eventsByDay.get(cur.getTime());
      if (list) list.push(row);
      cur = addDays(cur, 1);
    }
  }

  const tz = shortTimeZoneLabel();
  const columnsStyle: React.CSSProperties = {
    gridTemplateColumns: `48px repeat(${numDays}, 1fr)`,
  };

  // Unified scroll: header and all-day row are sticky inside the same
  // scrolling container as the hour grid, so every grid shares the same inner
  // width — columns line up regardless of scrollbar presence.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border">
      <ScrollableGrid days={days}>
        <div className="sticky top-0 z-30 bg-background">
          <div className="grid border-b bg-muted/30" style={columnsStyle}>
            <div
              className="flex items-end justify-end pb-1 pr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              title={tz}
            >
              {tz}
            </div>
            {days.map((d) => (
              <DayColumnHeader key={d.getTime()} date={d} />
            ))}
          </div>
          <AllDayRow
            days={days}
            events={events}
            columnsStyle={columnsStyle}
          />
        </div>
        <div className="relative grid" style={columnsStyle}>
          <HourLabels />
          {days.map((d) => {
            const rows = eventsByDay.get(d.getTime()) ?? [];
            const positioned = layoutDay(rows, d);
            return (
              <DayColumn
                key={d.getTime()}
                dayStart={d}
                positioned={positioned}
                totalHeightPx={HOUR_HEIGHT * 24}
                onMoveEvent={onMoveEvent}
                onCreateEvent={onCreateEvent}
              />
            );
          })}
        </div>
      </ScrollableGrid>
    </div>
  );
}

function ScrollableGrid({
  days,
  children,
}: {
  days: Date[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Stable key so we only auto-scroll when the visible range changes (not on
  // every render from the now-tick).
  const rangeKey = `${days[0]?.getTime()}-${days.length}`;

  useEffect(() => {
    if (!ref.current) return;
    const today = new Date();
    const todayVisible = days.some((d) => sameDay(d, today));
    const hour = todayVisible
      ? Math.max(0, today.getHours() - 1)
      : DEFAULT_SCROLL_HOUR;
    ref.current.scrollTop = hour * HOUR_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-auto"
    >
      {children}
    </div>
  );
}

function DayColumnHeader({ date }: { date: Date }) {
  const today = sameDay(date, new Date());
  return (
    <div className="flex flex-col items-center border-l px-1 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        className={`text-lg ${
          today ? "text-primary font-semibold" : "text-foreground"
        }`}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

function AllDayRow({
  days,
  events,
  columnsStyle,
}: {
  days: Date[];
  events: EventRow[];
  columnsStyle: React.CSSProperties;
}) {
  const windowStart = days[0].getTime();
  const windowEndExcl = days[days.length - 1].getTime() + 86400_000;

  // One segment per all-day event, clipped to the visible window and mapped
  // to column indices. Google's all-day `end` is exclusive, so the last
  // included day is startOfDay(end - 1).
  const segs = events
    .filter((r) => r.event.allDay)
    .map((r) => {
      const firstMs = Math.max(r.event.start, windowStart);
      const lastMs = Math.min(r.event.end - 1, windowEndExcl - 1);
      if (lastMs < firstMs) return null;
      const startIdx = Math.floor(
        (startOfDay(new Date(firstMs)).getTime() - windowStart) / 86400_000,
      );
      const endIdx = Math.floor(
        (startOfDay(new Date(lastMs)).getTime() - windowStart) / 86400_000,
      );
      return { row: r, startIdx, endIdx };
    })
    .filter(
      (x): x is { row: EventRow; startIdx: number; endIdx: number } =>
        x !== null,
    )
    .sort((a, b) =>
      a.startIdx !== b.startIdx
        ? a.startIdx - b.startIdx
        : b.endIdx - a.endIdx,
    );

  if (segs.length === 0) return null;

  // Greedy lane packing — an event goes in the lowest lane whose prior
  // occupant ended before this one starts.
  const laneEnd: number[] = [];
  const laned = segs.map((s) => {
    let lane = laneEnd.findIndex((e) => e < s.startIdx);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(s.endIdx);
    } else {
      laneEnd[lane] = s.endIdx;
    }
    return { ...s, lane };
  });
  const lanes = laneEnd.length;

  return (
    <div
      className="grid border-b bg-muted/10"
      style={{
        ...columnsStyle,
        gridTemplateRows: `repeat(${lanes}, 22px)`,
      }}
    >
      <div
        className="flex items-start justify-end px-1 py-1 text-[10px] uppercase text-muted-foreground"
        style={{ gridColumn: 1, gridRow: `1 / span ${lanes}` }}
      >
        All day
      </div>
      {laned.map((s) => (
        <EventPopover
          key={`${s.row.event._id}-${s.startIdx}`}
          row={s.row}
        >
          <button
            type="button"
            className="mx-0.5 my-0.5 flex items-center overflow-hidden rounded px-1.5 text-left text-[11px] leading-tight outline-none transition hover:brightness-95 focus-visible:ring-2"
            style={{
              gridColumn: `${2 + s.startIdx} / ${3 + s.endIdx}`,
              gridRow: `${s.lane + 1}`,
              backgroundColor: s.row.calendar.backgroundColor,
              color: s.row.calendar.foregroundColor,
            }}
            title={s.row.event.summary}
          >
            <span className="truncate">{s.row.event.summary}</span>
          </button>
        </EventPopover>
      ))}
    </div>
  );
}

function HourLabels() {
  return (
    <div className="relative" style={{ height: `${HOUR_HEIGHT * 24}px` }}>
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute right-1 text-[10px] text-muted-foreground"
          style={{ top: `${h * HOUR_HEIGHT - 6}px` }}
        >
          {h === 0 ? "" : formatHourLabel(h)}
        </div>
      ))}
    </div>
  );
}

function formatHourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
}

function DayColumn({
  dayStart,
  positioned,
  totalHeightPx,
  onMoveEvent,
  onCreateEvent,
}: {
  dayStart: Date;
  positioned: Positioned[];
  totalHeightPx: number;
  onMoveEvent: (args: MoveEventArgs) => void;
  onCreateEvent: ((args: CreateEventArgs) => void) | null;
}) {
  const isToday = sameDay(dayStart, new Date());
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 86400_000;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<Set<string>>(new Set());
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDragState | null>(null);
  const createDragRef = useRef<CreateDragState | null>(null);

  function snapMsFromOffsetY(offsetY: number): number {
    const clamped = Math.max(0, Math.min(offsetY, totalHeightPx));
    const ms = (clamped / totalHeightPx) * 86400_000;
    return Math.round(ms / SNAP_MS) * SNAP_MS;
  }

  function beginCreate(e: React.PointerEvent<HTMLDivElement>) {
    if (!onCreateEvent) return;
    if (e.button !== 0) return;
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top;
    const state: CreateDragState = {
      pointerStartY: offsetY,
      currentOffsetY: offsetY,
      active: false,
      pointerId: e.pointerId,
    };
    createDragRef.current = state;
    setCreateDrag(state);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }

  function moveCreate(e: React.PointerEvent<HTMLDivElement>) {
    const s = createDragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top;
    if (!s.active && Math.abs(offsetY - s.pointerStartY) < DRAG_THRESHOLD_PX) {
      return;
    }
    const next: CreateDragState = {
      ...s,
      active: true,
      currentOffsetY: offsetY,
    };
    createDragRef.current = next;
    setCreateDrag(next);
  }

  function endCreate(e: React.PointerEvent<HTMLDivElement>) {
    const s = createDragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    createDragRef.current = null;
    setCreateDrag(null);
    if (!s.active || !onCreateEvent) return;
    const aMs = snapMsFromOffsetY(s.pointerStartY);
    const bMs = snapMsFromOffsetY(s.currentOffsetY);
    const startMs = Math.min(aMs, bMs);
    let endMs = Math.max(aMs, bMs);
    if (endMs - startMs < MIN_EVENT_MS) endMs = startMs + MIN_EVENT_MS;
    onCreateEvent({ start: dayStartMs + startMs, end: dayStartMs + endMs });
  }

  function canDrag(row: EventRow): boolean {
    if (!isWritable(row)) return false;
    // Restrict drag to events fully contained within this day for v1.
    return row.event.start >= dayStartMs && row.event.end <= dayEndMs;
  }

  function snapDelta(dy: number): number {
    const raw = (dy / HOUR_HEIGHT) * 3_600_000;
    return Math.round(raw / SNAP_MS) * SNAP_MS;
  }

  function begin(
    e: React.PointerEvent<HTMLElement>,
    row: EventRow,
    mode: "move" | "resize",
  ) {
    if (!canDrag(row)) return;
    const state: DragState = {
      eventId: row.event._id as string,
      mode,
      originalStart: row.event.start,
      originalEnd: row.event.end,
      pointerStartY: e.clientY,
      deltaMs: 0,
      active: false,
      pointerId: e.pointerId,
    };
    dragRef.current = state;
    setDrag(state);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }

  function move(e: React.PointerEvent<HTMLElement>) {
    const s = dragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dy = e.clientY - s.pointerStartY;
    if (!s.active && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    const snapped = snapDelta(dy);
    if (!s.active || snapped !== s.deltaMs) {
      const next: DragState = { ...s, active: true, deltaMs: snapped };
      dragRef.current = next;
      setDrag(next);
    }
  }

  function end(e: React.PointerEvent<HTMLElement>) {
    const s = dragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
    setDrag(null);
    if (!s.active || s.deltaMs === 0) return;
    suppressClickRef.current.add(s.eventId);
    let newStart = s.originalStart;
    let newEnd = s.originalEnd;
    if (s.mode === "move") {
      newStart = s.originalStart + s.deltaMs;
      newEnd = s.originalEnd + s.deltaMs;
    } else {
      newEnd = Math.max(s.originalStart + MIN_EVENT_MS, s.originalEnd + s.deltaMs);
    }
    onMoveEvent({
      eventId: s.eventId as Id<"events">,
      start: newStart,
      end: newEnd,
    });
  }

  const createPreview = (() => {
    if (!createDrag?.active) return null;
    const aMs = snapMsFromOffsetY(createDrag.pointerStartY);
    const bMs = snapMsFromOffsetY(createDrag.currentOffsetY);
    const startMs = Math.min(aMs, bMs);
    let endMs = Math.max(aMs, bMs);
    if (endMs - startMs < MIN_EVENT_MS) endMs = startMs + MIN_EVENT_MS;
    const topPx = (startMs / 86400_000) * totalHeightPx;
    const heightPx = ((endMs - startMs) / 86400_000) * totalHeightPx;
    return { topPx, heightPx, startMs, endMs };
  })();

  return (
    <div
      ref={columnRef}
      className={`relative border-l ${
        onCreateEvent ? "cursor-crosshair" : ""
      }`}
      style={{ height: `${totalHeightPx}px`, touchAction: "none" }}
      onPointerDown={beginCreate}
      onPointerMove={moveCreate}
      onPointerUp={endCreate}
      onPointerCancel={endCreate}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-muted/50"
          style={{ top: `${h * HOUR_HEIGHT}px` }}
        />
      ))}
      {createPreview && (
        <div
          className="pointer-events-none absolute inset-x-1 rounded border-2 border-dashed border-primary/70 bg-primary/20 px-1 py-0.5 text-[11px] font-medium text-primary"
          style={{
            top: `${createPreview.topPx}px`,
            height: `${Math.max(createPreview.heightPx, 14)}px`,
            zIndex: 15,
          }}
        >
          {formatTime(dayStartMs + createPreview.startMs)} –
          {" "}
          {formatTime(dayStartMs + createPreview.endMs)}
        </div>
      )}
      {positioned.map((p) => {
        const widthPct = (p.span / p.lanes) * 100;
        const leftPct = (p.lane / p.lanes) * 100;
        const isDragging =
          drag?.active && drag.eventId === (p.row.event._id as string);
        let topMs = p.startMs;
        let durationMs = p.endMs - p.startMs;
        if (isDragging && drag) {
          if (drag.mode === "move") {
            topMs = p.startMs + drag.deltaMs;
          } else {
            durationMs = Math.max(MIN_EVENT_MS, durationMs + drag.deltaMs);
          }
        }
        const topPx = ((topMs - dayStartMs) / 86400_000) * totalHeightPx;
        const heightPx = Math.max(
          (durationMs / 86400_000) * totalHeightPx,
          14,
        );
        const showStackedTime = heightPx >= 32;
        const showInlineTime = !showStackedTime && heightPx >= 20;
        const writable = canDrag(p.row);
        const showResizeHandle = writable && heightPx >= 24;
        const eventIdStr = p.row.event._id as string;
        const handleClickCapture = (e: React.MouseEvent<HTMLButtonElement>) => {
          if (suppressClickRef.current.has(eventIdStr)) {
            suppressClickRef.current.delete(eventIdStr);
            e.preventDefault();
            e.stopPropagation();
            (e.nativeEvent as Event & {
              stopImmediatePropagation?: () => void;
            }).stopImmediatePropagation?.();
          }
        };
        return (
          <EventPopover
            key={`${dayStart.getTime()}-${p.row.event._id}`}
            row={p.row}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                // Stop the column-level drag-create from starting too.
                e.stopPropagation();
                if (!writable) return;
                begin(e, p.row, "move");
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onClickCapture={handleClickCapture}
              className={`absolute flex flex-col items-start justify-start overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-1 ${
                writable ? "cursor-grab active:cursor-grabbing" : ""
              } ${
                isDragging ? "z-20 opacity-90 ring-2 ring-primary/60" : ""
              }`}
              style={{
                top: `${topPx}px`,
                height: `${heightPx}px`,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                backgroundColor: p.row.calendar.backgroundColor,
                color: p.row.calendar.foregroundColor,
                touchAction: writable ? "none" : undefined,
              }}
              title={`${p.row.event.summary} · ${formatTime(p.row.event.start)}`}
            >
              <div className="w-full truncate font-medium">
                {p.row.event.summary}
                {showInlineTime && (
                  <span className="font-normal opacity-80">
                    {" · "}
                    {formatTime(p.row.event.start)}
                  </span>
                )}
              </div>
              {showStackedTime && (
                <div className="w-full truncate opacity-80">
                  {formatTime(p.row.event.start)}
                </div>
              )}
              {showResizeHandle && (
                <span
                  aria-hidden
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    begin(e, p.row, "resize");
                  }}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                />
              )}
            </button>
          </EventPopover>
        );
      })}
      {isToday && <NowIndicator dayStart={dayStart} totalHeightPx={totalHeightPx} />}
    </div>
  );
}

function NowIndicator({
  dayStart,
  totalHeightPx,
}: {
  dayStart: Date;
  totalHeightPx: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const ms = dayStart.getTime();
  if (now < ms || now > ms + 86400_000) return null;
  const top = ((now - ms) / 86400_000) * totalHeightPx;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-10"
      style={{ top: `${top}px` }}
    >
      <div className="relative h-[2px] bg-red-500">
        <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
      </div>
    </div>
  );
}
