"use client";

import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";

import { EventPopover } from "@/components/calendar/event-popover";
import {
  eventKindLabel,
  isTask,
  isWorkingLocation,
} from "@/components/calendar/event-kind";
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
  originDayIndex: number;
  pointerStartX: number;
  pointerStartY: number;
  pointerCurrentX: number;
  deltaMs: number;
  dayDiff: number;
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
  if (isTask(row) || isWorkingLocation(row)) return false;
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

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<Set<string>>(new Set());
  // Optimistic override for an in-flight move. We immediately pretend the
  // event is at its new start/end so the user sees it land the instant they
  // release — no waiting for the Convex round-trip. Cleared once the real
  // `events` prop reflects the move (or after a safety timeout).
  const [pendingMove, setPendingMove] = useState<{
    eventId: string;
    expectedStart: number;
    expectedEnd: number;
  } | null>(null);

  const effectiveEvents =
    pendingMove === null
      ? events
      : events.map((r) => {
          if ((r.event._id as string) !== pendingMove.eventId) return r;
          return {
            ...r,
            event: {
              ...r.event,
              start: pendingMove.expectedStart,
              end: pendingMove.expectedEnd,
            },
          };
        });

  // Bucket timed events only; all-day events render as spanning segments in
  // AllDayRow and must not appear in any day column.
  const eventsByDay = new Map<number, EventRow[]>();
  for (const day of days) eventsByDay.set(day.getTime(), []);
  for (const row of effectiveEvents) {
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
  const hourGridRef = useRef<HTMLDivElement | null>(null);

  const draggedRow =
    drag !== null
      ? effectiveEvents.find((r) => (r.event._id as string) === drag.eventId) ??
        null
      : null;

  useEffect(() => {
    if (!pendingMove) return;
    const current = events.find(
      (r) => (r.event._id as string) === pendingMove.eventId,
    );
    if (
      current &&
      current.event.start === pendingMove.expectedStart &&
      current.event.end === pendingMove.expectedEnd
    ) {
      setPendingMove(null);
    }
  }, [events, pendingMove]);

  // Safety: if the mutation never lands (e.g. error), drop the override after
  // a grace period so the UI doesn't show a stale optimistic position forever.
  useEffect(() => {
    if (!pendingMove) return;
    const id = setTimeout(() => setPendingMove(null), 3000);
    return () => clearTimeout(id);
  }, [pendingMove]);

  function computeDayDiff(pointerX: number, originDayIndex: number): number {
    const rect = hourGridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const colWidth = (rect.width - 48) / numDays;
    if (colWidth <= 0) return 0;
    const x = pointerX - (rect.left + 48);
    const target = Math.max(
      0,
      Math.min(numDays - 1, Math.floor(x / colWidth)),
    );
    return target - originDayIndex;
  }

  function beginDrag(
    e: React.PointerEvent<HTMLElement>,
    row: EventRow,
    mode: "move" | "resize",
    originDayIndex: number,
  ) {
    const state: DragState = {
      eventId: row.event._id as string,
      mode,
      originalStart: row.event.start,
      originalEnd: row.event.end,
      originDayIndex,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      pointerCurrentX: e.clientX,
      deltaMs: 0,
      dayDiff: 0,
      active: false,
      pointerId: e.pointerId,
    };
    dragRef.current = state;
    setDrag(state);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }

  function moveDrag(e: React.PointerEvent<HTMLElement>) {
    const s = dragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.pointerStartX;
    const dy = e.clientY - s.pointerStartY;
    if (
      !s.active &&
      Math.abs(dy) < DRAG_THRESHOLD_PX &&
      Math.abs(dx) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    const raw = (dy / HOUR_HEIGHT) * 3_600_000;
    const snapped = Math.round(raw / SNAP_MS) * SNAP_MS;
    const dayDiff =
      s.mode === "move" ? computeDayDiff(e.clientX, s.originDayIndex) : 0;
    if (
      !s.active ||
      snapped !== s.deltaMs ||
      dayDiff !== s.dayDiff ||
      e.clientX !== s.pointerCurrentX
    ) {
      const next: DragState = {
        ...s,
        active: true,
        deltaMs: snapped,
        dayDiff,
        pointerCurrentX: e.clientX,
      };
      dragRef.current = next;
      setDrag(next);
    }
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    const s = dragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
    setDrag(null);
    if (!s.active || (s.deltaMs === 0 && s.dayDiff === 0)) return;
    suppressClickRef.current.add(s.eventId);
    let newStart = s.originalStart;
    let newEnd = s.originalEnd;
    if (s.mode === "move") {
      // Use calendar-day deltas (DST-safe) rather than 24h * dayDiff.
      const dayShiftMs =
        days[s.originDayIndex + s.dayDiff].getTime() -
        days[s.originDayIndex].getTime();
      const shift = s.deltaMs + dayShiftMs;
      newStart = s.originalStart + shift;
      newEnd = s.originalEnd + shift;
    } else {
      newEnd = Math.max(
        s.originalStart + MIN_EVENT_MS,
        s.originalEnd + s.deltaMs,
      );
    }
    setPendingMove({
      eventId: s.eventId,
      expectedStart: newStart,
      expectedEnd: newEnd,
    });
    onMoveEvent({
      eventId: s.eventId as Id<"events">,
      start: newStart,
      end: newEnd,
    });
  }

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
        <div
          ref={hourGridRef}
          className="relative grid"
          style={columnsStyle}
        >
          <HourLabels />
          {days.map((d, idx) => {
            const rows = eventsByDay.get(d.getTime()) ?? [];
            const positioned = layoutDay(rows, d);
            return (
              <DayColumn
                key={d.getTime()}
                dayStart={d}
                dayIndex={idx}
                positioned={positioned}
                totalHeightPx={HOUR_HEIGHT * 24}
                onCreateEvent={onCreateEvent}
                drag={drag}
                draggedRow={draggedRow}
                suppressClickRef={suppressClickRef}
                onEventPointerDown={beginDrag}
                onEventPointerMove={moveDrag}
                onEventPointerUp={endDrag}
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
            className={`mx-0.5 my-0.5 flex items-center overflow-hidden rounded px-1.5 text-left text-[11px] leading-tight outline-none transition hover:brightness-95 focus-visible:ring-2 ${
              isWorkingLocation(s.row) ? "border bg-transparent" : ""
            }`}
            style={{
              gridColumn: `${2 + s.startIdx} / ${3 + s.endIdx}`,
              gridRow: `${s.lane + 1}`,
              backgroundColor: isWorkingLocation(s.row)
                ? "transparent"
                : s.row.calendar.backgroundColor,
              borderColor: isWorkingLocation(s.row)
                ? s.row.calendar.backgroundColor
                : undefined,
              color: isWorkingLocation(s.row)
                ? s.row.calendar.backgroundColor
                : s.row.calendar.foregroundColor,
            }}
            title={s.row.event.summary}
          >
            {isWorkingLocation(s.row) && (
              <BuildingIcon className="mr-1 size-3 shrink-0" />
            )}
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
  dayIndex,
  positioned,
  totalHeightPx,
  onCreateEvent,
  drag,
  draggedRow,
  suppressClickRef,
  onEventPointerDown,
  onEventPointerMove,
  onEventPointerUp,
}: {
  dayStart: Date;
  dayIndex: number;
  positioned: Positioned[];
  totalHeightPx: number;
  onCreateEvent: ((args: CreateEventArgs) => void) | null;
  drag: DragState | null;
  draggedRow: EventRow | null;
  suppressClickRef: React.MutableRefObject<Set<string>>;
  onEventPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    row: EventRow,
    mode: "move" | "resize",
    originDayIndex: number,
  ) => void;
  onEventPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onEventPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const isToday = sameDay(dayStart, new Date());
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 86400_000;
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDragState | null>(null);
  const createDragRef = useRef<CreateDragState | null>(null);

  function snapMsFromOffsetY(offsetY: number): number {
    const clamped = Math.max(0, Math.min(offsetY, totalHeightPx));
    const ms = (clamped / totalHeightPx) * 86400_000;
    return Math.round(ms / SNAP_MS) * SNAP_MS;
  }

  function beginCreate(e: React.PointerEvent<HTMLDivElement>) {
    if (!columnRef.current?.contains(e.target as Node)) return;
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
        const isDraggingMe =
          drag !== null && drag.eventId === (p.row.event._id as string);
        // Hide this event while it's being actively dragged — the ghost
        // (rendered below, possibly in a different day column) takes over.
        // We keep the button mounted so pointer capture stays alive.
        const hideForDrag = isDraggingMe && drag.active;
        const topPx = ((p.startMs - dayStartMs) / 86400_000) * totalHeightPx;
        const heightPx = Math.max(
          ((p.endMs - p.startMs) / 86400_000) * totalHeightPx,
          14,
        );
        const showStackedTime = heightPx >= 32;
        const showInlineTime = !showStackedTime && heightPx >= 20;
        const task = isTask(p.row);
        const workingLocation = isWorkingLocation(p.row);
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
                onEventPointerDown(e, p.row, "move", dayIndex);
              }}
              onPointerMove={onEventPointerMove}
              onPointerUp={onEventPointerUp}
              onPointerCancel={onEventPointerUp}
              onClickCapture={handleClickCapture}
              className={`absolute flex items-start justify-start overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-offset-1 ${
                writable ? "cursor-grab active:cursor-grabbing" : ""
              } ${
                task
                  ? "gap-1 bg-transparent shadow-none"
                  : workingLocation
                    ? "gap-1 border-l-4 bg-transparent shadow-none"
                    : "flex-col shadow-sm"
              }`}
              style={{
                top: `${topPx}px`,
                height: `${heightPx}px`,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                backgroundColor: task || workingLocation
                    ? "transparent"
                    : p.row.calendar.backgroundColor,
                borderColor:
                  workingLocation ? p.row.calendar.backgroundColor : undefined,
                color:
                  task || workingLocation
                    ? p.row.calendar.backgroundColor
                    : p.row.calendar.foregroundColor,
                touchAction: writable ? "none" : undefined,
                opacity: hideForDrag ? 0 : 1,
                pointerEvents: hideForDrag ? "none" : undefined,
              }}
              title={`${eventKindLabel(p.row)}: ${p.row.event.summary} · ${formatTime(p.row.event.start)}`}
            >
              {task && (
                <TaskCheckbox
                  className="mt-0.5 size-3 shrink-0"
                  color={p.row.calendar.backgroundColor}
                />
              )}
              {workingLocation && (
                <BuildingIcon className="mt-0.5 size-3 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="w-full truncate font-medium">
                  {p.row.event.summary}
                  {showInlineTime && !task && !workingLocation && (
                    <span className="font-normal opacity-80">
                      {" · "}
                      {formatTime(p.row.event.start)}
                    </span>
                  )}
                </div>
                {showStackedTime && !task && !workingLocation && (
                  <div className="w-full truncate opacity-80">
                    {formatTime(p.row.event.start)}
                  </div>
                )}
              </div>
              {showResizeHandle && (
                <span
                  aria-hidden
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    onEventPointerDown(e, p.row, "resize", dayIndex);
                  }}
                  onPointerMove={onEventPointerMove}
                  onPointerUp={onEventPointerUp}
                  onPointerCancel={onEventPointerUp}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                />
              )}
            </button>
          </EventPopover>
        );
      })}
      {drag !== null &&
        drag.active &&
        draggedRow !== null &&
        drag.originDayIndex + drag.dayDiff === dayIndex && (
          <DragGhost
            drag={drag}
            row={draggedRow}
            dayStartMs={dayStartMs}
            totalHeightPx={totalHeightPx}
          />
        )}
      {isToday && <NowIndicator dayStart={dayStart} totalHeightPx={totalHeightPx} />}
    </div>
  );
}

function DragGhost({
  drag,
  row,
  dayStartMs,
  totalHeightPx,
}: {
  drag: DragState;
  row: EventRow;
  dayStartMs: number;
  totalHeightPx: number;
}) {
  // Compute the ghost's offset within THIS (target) column. For move mode the
  // origin day's start is approximately targetDayStart - dayDiff*86400_000, so
  // the time-of-day inside origin is (originalStart - dayStartMs) + dayDiff*86400_000.
  // Adding deltaMs shifts it vertically within the target column.
  let startInDayMs: number;
  let durationMs: number;
  let displayStart: number;
  if (drag.mode === "move") {
    startInDayMs =
      drag.originalStart -
      dayStartMs +
      drag.dayDiff * 86400_000 +
      drag.deltaMs;
    durationMs = drag.originalEnd - drag.originalStart;
    displayStart = dayStartMs + startInDayMs;
  } else {
    const newEnd = Math.max(
      drag.originalStart + MIN_EVENT_MS,
      drag.originalEnd + drag.deltaMs,
    );
    startInDayMs = drag.originalStart - dayStartMs;
    durationMs = newEnd - drag.originalStart;
    displayStart = drag.originalStart;
  }
  const topPx = (startInDayMs / 86400_000) * totalHeightPx;
  const heightPx = Math.max((durationMs / 86400_000) * totalHeightPx, 14);
  const showStackedTime = heightPx >= 32;
  const showInlineTime = !showStackedTime && heightPx >= 20;
  return (
    <div
      className="pointer-events-none absolute left-1 right-1 z-20 flex flex-col items-start justify-start overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight shadow-md ring-2 ring-primary/60"
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        backgroundColor: row.calendar.backgroundColor,
        color: row.calendar.foregroundColor,
        opacity: 0.92,
      }}
    >
      <div className="w-full truncate font-medium">
        {row.event.summary}
        {showInlineTime && (
          <span className="font-normal opacity-80">
            {" · "}
            {formatTime(displayStart)}
          </span>
        )}
      </div>
      {showStackedTime && (
        <div className="w-full truncate opacity-80">
          {formatTime(displayStart)}
        </div>
      )}
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

function TaskCheckbox({
  className,
  color,
}: {
  className: string;
  color: string;
}) {
  return (
    <span
      aria-hidden
      className={`rounded-[3px] border-2 bg-background ${className}`}
      style={{ borderColor: color }}
    />
  );
}

function BuildingIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 13.5V3.5h8v10" />
      <path d="M6.5 13.5v-3h3v3" />
      <path d="M6.5 6h.01" />
      <path d="M9.5 6h.01" />
      <path d="M6.5 8.25h.01" />
      <path d="M9.5 8.25h.01" />
      <path d="M3 13.5h10" />
    </svg>
  );
}
