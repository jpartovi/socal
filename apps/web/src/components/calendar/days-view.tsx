"use client";

import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Input } from "@socal/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@socal/ui/components/popover";
import { forwardRef, useEffect, useRef, useState } from "react";

import {
  eventColor,
  eventTextColor,
  readableTextColor,
} from "@/components/calendar/colors";
import { EventPopover } from "@/components/calendar/event-popover";
import {
  eventKindLabel,
  isTask,
  isWorkingLocation,
} from "@/components/calendar/event-kind";
import {
  addDays,
  formatTime,
  formatTimeRange,
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
const MIN_EVENT_MS = 30 * 60_000;

type MoveEventArgs = {
  eventId: Id<"events">;
  start: number;
  end: number;
  oldStart: number;
  oldEnd: number;
};

type CreateEventArgs = {
  start: number;
  end: number;
};

export type DraftCalendarEvent = {
  id: string;
  calendarId: Id<"calendars">;
  calendarName: string;
  backgroundColor: string;
  foregroundColor: string;
  summary?: string;
  start: number;
  end: number;
};

type DraftCommitFields = {
  summary: string;
  location: string;
  attendees: string[];
};

type EventAppearance = {
  backgroundColor: string;
  foregroundColor: string;
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
    .filter((r) => !r.event.allDay && !isWorkingLocation(r))
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
  createEventAppearance,
  draftEvent,
  onDraftDismiss,
  onDraftCommit,
  createdEventId,
  onCreateDismiss,
}: {
  events: EventRow[];
  anchor: Date;
  numDays: number;
  onMoveEvent: (args: MoveEventArgs) => void;
  onCreateEvent: ((args: CreateEventArgs) => void) | null;
  createEventAppearance: EventAppearance | null;
  draftEvent: DraftCalendarEvent | null;
  onDraftDismiss: () => void;
  onDraftCommit: (fields: DraftCommitFields) => Promise<void>;
  createdEventId: Id<"events"> | null;
  onCreateDismiss: () => void;
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
      oldStart: s.originalStart,
      oldEnd: s.originalEnd,
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
            events={effectiveEvents}
            columnsStyle={columnsStyle}
            onMoveEvent={onMoveEvent}
            setPendingMove={setPendingMove}
            createdEventId={createdEventId}
            onCreateDismiss={onCreateDismiss}
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
            const workingLocations = rows.filter(
              (row) => !row.event.allDay && isWorkingLocation(row),
            );
            const draftForDay =
              draftEvent && sameDay(new Date(draftEvent.start), d)
                ? draftEvent
                : null;
            return (
              <DayColumn
                key={d.getTime()}
                dayStart={d}
                dayIndex={idx}
                positioned={positioned}
                workingLocations={workingLocations}
                totalHeightPx={HOUR_HEIGHT * 24}
                onCreateEvent={onCreateEvent}
                createEventAppearance={createEventAppearance}
                draftEvent={draftForDay}
                onDraftDismiss={onDraftDismiss}
                onDraftCommit={onDraftCommit}
                drag={drag}
                draggedRow={draggedRow}
                suppressClickRef={suppressClickRef}
                onEventPointerDown={beginDrag}
                onEventPointerMove={moveDrag}
                onEventPointerUp={endDrag}
                createdEventId={createdEventId}
                onCreateDismiss={onCreateDismiss}
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

type AllDayDragState = {
  eventId: string;
  mode: "move" | "resize";
  originalStart: number;
  originalEnd: number;
  startIdx: number;
  endIdx: number;
  pointerStartX: number;
  deltaDays: number;
  active: boolean;
  pointerId: number;
};

function AllDayRow({
  days,
  events,
  columnsStyle,
  onMoveEvent,
  setPendingMove,
  createdEventId,
  onCreateDismiss,
}: {
  days: Date[];
  events: EventRow[];
  columnsStyle: React.CSSProperties;
  onMoveEvent: (args: MoveEventArgs) => void;
  setPendingMove: (
    pm: {
      eventId: string;
      expectedStart: number;
      expectedEnd: number;
    } | null,
  ) => void;
  createdEventId: Id<"events"> | null;
  onCreateDismiss: () => void;
}) {
  const windowStart = days[0].getTime();
  const windowEndExcl = days[days.length - 1].getTime() + 86400_000;
  const numDays = days.length;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<AllDayDragState | null>(null);
  const dragRef = useRef<AllDayDragState | null>(null);
  const suppressClickRef = useRef<Set<string>>(new Set());

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

  function canDrag(row: EventRow): boolean {
    const r = row.calendar.accessRole;
    if (r !== "owner" && r !== "writer") return false;
    // Only drag events fully contained in the visible window — clipped
    // segments would need extra math to translate back to absolute times.
    return row.event.start >= windowStart && row.event.end <= windowEndExcl;
  }

  function begin(
    e: React.PointerEvent<HTMLElement>,
    row: EventRow,
    mode: "move" | "resize",
    startIdx: number,
    endIdx: number,
  ) {
    const state: AllDayDragState = {
      eventId: row.event._id as string,
      mode,
      originalStart: row.event.start,
      originalEnd: row.event.end,
      startIdx,
      endIdx,
      pointerStartX: e.clientX,
      deltaDays: 0,
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
    const dx = e.clientX - s.pointerStartX;
    if (!s.active && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const colWidth = (rect.width - 48) / numDays;
    if (colWidth <= 0) return;
    const rawDelta = Math.round(dx / colWidth);
    // Clamp to the visible window so the chip never slides off either edge.
    const minDelta =
      s.mode === "move" ? -s.startIdx : s.startIdx - s.endIdx;
    const maxDelta = numDays - 1 - s.endIdx;
    const clamped = Math.max(minDelta, Math.min(maxDelta, rawDelta));
    if (!s.active || clamped !== s.deltaDays) {
      const next: AllDayDragState = {
        ...s,
        active: true,
        deltaDays: clamped,
      };
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
    if (!s.active || s.deltaDays === 0) return;
    suppressClickRef.current.add(s.eventId);
    let newStart = s.originalStart;
    let newEnd = s.originalEnd;
    if (s.mode === "move") {
      newStart = s.originalStart + s.deltaDays * 86400_000;
      newEnd = s.originalEnd + s.deltaDays * 86400_000;
    } else {
      newEnd = Math.max(
        s.originalStart + 86400_000,
        s.originalEnd + s.deltaDays * 86400_000,
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
      oldStart: s.originalStart,
      oldEnd: s.originalEnd,
    });
  }

  return (
    <div
      ref={gridRef}
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
      {laned.map((s) => {
        const writable = canDrag(s.row);
        const isDraggingMe =
          drag !== null && drag.eventId === (s.row.event._id as string);
        const activeDrag = isDraggingMe && drag.active;
        let startCol = s.startIdx;
        let endCol = s.endIdx;
        if (activeDrag && drag) {
          if (drag.mode === "move") {
            startCol = s.startIdx + drag.deltaDays;
            endCol = s.endIdx + drag.deltaDays;
          } else {
            endCol = s.endIdx + drag.deltaDays;
          }
        }
        const eventIdStr = s.row.event._id as string;
        const handleClickCapture = (
          e: React.MouseEvent<HTMLButtonElement>,
        ) => {
          if (suppressClickRef.current.has(eventIdStr)) {
            suppressClickRef.current.delete(eventIdStr);
            e.preventDefault();
            e.stopPropagation();
            (e.nativeEvent as Event & {
              stopImmediatePropagation?: () => void;
            }).stopImmediatePropagation?.();
          }
        };
        const isNewlyCreated =
          createdEventId !== null && s.row.event._id === createdEventId;
        return (
          <EventPopover
            key={`${s.row.event._id}-${s.startIdx}`}
            row={s.row}
            open={isNewlyCreated ? true : undefined}
            onOpenChange={
              isNewlyCreated ? (o) => !o && onCreateDismiss() : undefined
            }
            defaultEditing={isNewlyCreated}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                if (!writable) return;
                begin(e, s.row, "move", s.startIdx, s.endIdx);
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onClickCapture={handleClickCapture}
              className={`relative mx-0.5 my-0.5 flex items-center overflow-hidden rounded px-1.5 text-left text-[11px] leading-tight outline-none transition hover:brightness-95 focus-visible:ring-2 ${
                isWorkingLocation(s.row) ? "border bg-transparent" : ""
              } ${writable ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{
                gridColumn: `${2 + startCol} / ${3 + endCol}`,
                gridRow: `${s.lane + 1}`,
                backgroundColor: isWorkingLocation(s.row)
                  ? "transparent"
                  : eventColor(s.row),
                borderColor: isWorkingLocation(s.row)
                  ? eventColor(s.row)
                  : undefined,
                color: isWorkingLocation(s.row)
                  ? eventColor(s.row)
                  : eventTextColor(s.row),
                opacity: activeDrag ? 0.85 : 1,
                boxShadow: activeDrag
                  ? "0 0 0 2px var(--ring, rgba(99,102,241,0.6))"
                  : undefined,
                touchAction: writable ? "none" : undefined,
              }}
              title={s.row.event.summary}
            >
              {isWorkingLocation(s.row) && (
                <BuildingIcon className="mr-1 size-3 shrink-0" />
              )}
              <span className="truncate">{s.row.event.summary}</span>
              {writable && (
                <span
                  aria-hidden
                  role="presentation"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    begin(e, s.row, "resize", s.startIdx, s.endIdx);
                  }}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                />
              )}
            </button>
          </EventPopover>
        );
      })}
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

function clippedTimedSegment(
  start: number,
  end: number,
  dayStartMs: number,
  dayEndMs: number,
): { startMs: number; endMs: number } | null {
  const startMs = Math.max(start, dayStartMs);
  const endMs = Math.min(end, dayEndMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

function DraftEventPopover({
  draft,
  children,
  onDismiss,
  onCommit,
}: {
  draft: DraftCalendarEvent;
  children: React.ReactNode;
  onDismiss: () => void;
  onCommit: (fields: DraftCommitFields) => Promise<void>;
}) {
  const [summary, setSummary] = useState("");
  const [who, setWho] = useState("");
  const [location, setLocation] = useState("");
  const [open, setOpen] = useState(true);
  const committedRef = useRef(false);
  const attendees = parseAttendeeInput(who);
  const hasContent =
    summary.trim() !== "" || location.trim() !== "" || attendees.length > 0;

  async function commit() {
    if (committedRef.current || !hasContent) return;
    committedRef.current = true;
    setOpen(false);
    try {
      await onCommit({ summary, location, attendees });
    } catch (err) {
      committedRef.current = false;
      setOpen(true);
      console.error("draft create failed", err);
    }
  }

  function submitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (hasContent) void commit();
    else {
      setOpen(false);
      onDismiss();
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        if (open) {
          if (!committedRef.current) setOpen(true);
          return;
        }
        if (hasContent) {
          void commit();
        } else {
          setOpen(false);
          onDismiss();
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-lg p-0 text-sm"
      >
        <div
          className="bg-card text-card-foreground"
          onKeyDownCapture={(e) => {
            if (e.key !== "Enter") return;
            const target = e.target as HTMLElement | null;
            if (target?.tagName !== "INPUT") return;
            e.preventDefault();
            if (hasContent) void commit();
            else onDismiss();
          }}
        >
          <div className="flex h-9 items-center justify-between bg-muted/50 px-4">
            <span className="text-base text-muted-foreground">=</span>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                if (hasContent) void commit();
                else {
                  setOpen(false);
                  onDismiss();
                }
              }}
              aria-label="Close"
            >
              x
            </button>
          </div>
          <div className="space-y-4 px-8 pb-6 pt-5">
            <Input
              autoFocus
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="what?"
              className="h-12 rounded-none border-0 border-b bg-transparent px-0 text-3xl font-normal shadow-none placeholder:text-muted-foreground/45 focus-visible:ring-0"
            />
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                Event
              </span>
              {["Task", "Out of office", "Focus time", "Working location"].map(
                (label) => (
                  <span
                    key={label}
                    className="px-2 py-2 text-sm font-medium text-muted-foreground"
                  >
                    {label}
                  </span>
                ),
              )}
            </div>
            <div className="grid grid-cols-[24px_1fr] items-center gap-x-4 gap-y-3">
              <ClockIcon />
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                {new Date(draft.start).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}{" "}
                {formatTime(draft.start)} - {formatTime(draft.end)}
              </div>
              <PeopleIcon />
              <Input
                value={who}
                onChange={(e) => setWho(e.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="who?"
                className="h-9 border-0 bg-transparent px-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
              />
              <LocationPinIcon />
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="where?"
                className="h-9 border-0 bg-transparent px-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
              />
              <CalendarTinyIcon />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{draft.calendarName}</span>
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: draft.backgroundColor }}
                />
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseAttendeeInput(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of value.split(/[\s,;]+/)) {
    const email = token.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

const DraftEventBlock = forwardRef<
  HTMLButtonElement,
  {
    draft: DraftCalendarEvent;
    topPx: number;
    heightPx: number;
  }
>(function DraftEventBlock({ draft, topPx, heightPx }, ref) {
  const showStacked = heightPx >= 34;
  const time = formatTimeRange(draft.start, draft.end);
  return (
    <button
      ref={ref}
      type="button"
      className={`absolute left-1 right-1 flex overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        showStacked ? "flex-col items-start" : "items-center gap-1"
      }`}
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        zIndex: 20,
        backgroundColor: draft.backgroundColor,
        color: readableTextColor(draft.backgroundColor),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="max-w-full truncate font-medium">
        {draft.summary?.trim() || "(no title)"}
      </span>
      <span className="max-w-full truncate opacity-80">
        {showStacked ? time : `, ${time}`}
      </span>
    </button>
  );
});

function DayColumn({
  dayStart,
  dayIndex,
  positioned,
  workingLocations,
  totalHeightPx,
  onCreateEvent,
  createEventAppearance,
  draftEvent,
  onDraftDismiss,
  onDraftCommit,
  drag,
  draggedRow,
  suppressClickRef,
  onEventPointerDown,
  onEventPointerMove,
  onEventPointerUp,
  createdEventId,
  onCreateDismiss,
}: {
  dayStart: Date;
  dayIndex: number;
  positioned: Positioned[];
  workingLocations: EventRow[];
  totalHeightPx: number;
  onCreateEvent: ((args: CreateEventArgs) => void) | null;
  createEventAppearance: EventAppearance | null;
  draftEvent: DraftCalendarEvent | null;
  onDraftDismiss: () => void;
  onDraftCommit: (fields: DraftCommitFields) => Promise<void>;
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
  createdEventId: Id<"events"> | null;
  onCreateDismiss: () => void;
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

  function createSelectionFromOffsets(aOffsetY: number, bOffsetY: number) {
    const aMs = snapMsFromOffsetY(aOffsetY);
    const bMs = snapMsFromOffsetY(bOffsetY);
    let startMs = Math.min(aMs, bMs);
    let endMs = Math.max(aMs, bMs);
    if (endMs - startMs < MIN_EVENT_MS) {
      endMs = Math.min(86400_000, startMs + MIN_EVENT_MS);
      startMs = Math.max(0, endMs - MIN_EVENT_MS);
    }
    return { startMs, endMs };
  }

  function createPreviewFromOffsets(aOffsetY: number, bOffsetY: number) {
    const minHeightPx = (MIN_EVENT_MS / 86400_000) * totalHeightPx;
    const a = Math.max(0, Math.min(aOffsetY, totalHeightPx));
    const b = Math.max(0, Math.min(bOffsetY, totalHeightPx));
    let topPx = Math.min(a, b);
    let bottomPx = Math.max(a, b);
    if (bottomPx - topPx < minHeightPx) {
      if (b < a) {
        bottomPx = a;
        topPx = Math.max(0, bottomPx - minHeightPx);
      } else {
        topPx = a;
        bottomPx = Math.min(totalHeightPx, topPx + minHeightPx);
      }
      if (bottomPx - topPx < minHeightPx) {
        topPx = Math.max(0, bottomPx - minHeightPx);
      }
    }
    const { startMs, endMs } = createSelectionFromOffsets(aOffsetY, bOffsetY);
    return {
      topPx,
      heightPx: bottomPx - topPx,
      startMs,
      endMs,
    };
  }

  function beginCreate(e: React.PointerEvent<HTMLDivElement>) {
    if (!columnRef.current?.contains(e.target as Node)) return;
    if (!onCreateEvent) return;
    if (e.button !== 0) return;
    const rect = columnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetY = e.clientY - rect.top;
    const defaultEndOffsetY =
      offsetY + (MIN_EVENT_MS / 86400_000) * totalHeightPx;
    const state: CreateDragState = {
      pointerStartY: offsetY,
      currentOffsetY: defaultEndOffsetY,
      active: true,
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
    if (!onCreateEvent) return;
    const { startMs, endMs } = createSelectionFromOffsets(
      s.pointerStartY,
      s.currentOffsetY,
    );
    onCreateEvent({ start: dayStartMs + startMs, end: dayStartMs + endMs });
  }

  function canDrag(row: EventRow): boolean {
    if (!isWritable(row)) return false;
    // Restrict drag to events fully contained within this day for v1.
    return row.event.start >= dayStartMs && row.event.end <= dayEndMs;
  }

  const createPreview = (() => {
    if (!createDrag?.active) return null;
    return createPreviewFromOffsets(
      createDrag.pointerStartY,
      createDrag.currentOffsetY,
    );
  })();

  const draftSegment = draftEvent
    ? clippedTimedSegment(draftEvent.start, draftEvent.end, dayStartMs, dayEndMs)
    : null;

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
          className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-md px-2 py-1 text-[11px] font-medium shadow-sm"
          style={{
            top: `${createPreview.topPx}px`,
            height: `${Math.max(createPreview.heightPx, 18)}px`,
            zIndex: 15,
            backgroundColor:
              createEventAppearance?.backgroundColor ?? "var(--primary)",
            color: createEventAppearance
              ? readableTextColor(createEventAppearance.backgroundColor)
              : "var(--primary-foreground)",
          }}
        >
          <div className="truncate">(no title)</div>
          <div className="truncate font-normal opacity-80">
            {formatTime(dayStartMs + createPreview.startMs)} -{" "}
            {formatTime(dayStartMs + createPreview.endMs)}
          </div>
        </div>
      )}
      {workingLocations.map((row) => {
        const segment = clippedTimedSegment(
          row.event.start,
          row.event.end,
          dayStartMs,
          dayEndMs,
        );
        if (!segment) return null;
        const topPx =
          ((segment.startMs - dayStartMs) / 86400_000) * totalHeightPx;
        const heightPx = Math.max(
          ((segment.endMs - segment.startMs) / 86400_000) * totalHeightPx,
          18,
        );
        const color = eventColor(row);
        return (
          <div
            key={`${dayStart.getTime()}-${row.event._id}-working-location`}
            className="pointer-events-none absolute left-1 flex flex-col items-start"
            style={{
              top: `${topPx}px`,
              height: `${heightPx}px`,
              zIndex: 2,
            }}
            title={`${eventKindLabel(row)}: ${row.event.summary} · ${formatTimeRange(row.event.start, row.event.end)}`}
          >
            <div
              className="flex items-center gap-1 whitespace-nowrap text-[11px] font-medium leading-tight"
              style={{ color }}
            >
              <BuildingIcon className="size-3 shrink-0" />
              <span>{row.event.summary}</span>
            </div>
            <div
              className="ml-[5px] mt-0.5 w-0.5 flex-1 rounded-full"
              style={{ backgroundColor: color, opacity: 0.7 }}
            />
          </div>
        );
      })}
      {draftEvent && draftSegment && (
        <DraftEventPopover
          draft={draftEvent}
          onDismiss={onDraftDismiss}
          onCommit={onDraftCommit}
        >
          <DraftEventBlock
            draft={draftEvent}
            topPx={
              ((draftSegment.startMs - dayStartMs) / 86400_000) *
              totalHeightPx
            }
            heightPx={Math.max(
              ((draftSegment.endMs - draftSegment.startMs) / 86400_000) *
                totalHeightPx,
              24,
            )}
          />
        </DraftEventPopover>
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
        const isNewlyCreated =
          createdEventId !== null && p.row.event._id === createdEventId;
        return (
          <EventPopover
            key={`${dayStart.getTime()}-${p.row.event._id}`}
            row={p.row}
            open={isNewlyCreated ? true : undefined}
            onOpenChange={
              isNewlyCreated ? (o) => !o && onCreateDismiss() : undefined
            }
            defaultEditing={isNewlyCreated}
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
                    : eventColor(p.row),
                borderColor:
                  workingLocation ? eventColor(p.row) : undefined,
                color:
                  task || workingLocation
                    ? eventColor(p.row)
                    : eventTextColor(p.row),
                touchAction: writable ? "none" : undefined,
                opacity: hideForDrag ? 0 : 1,
                pointerEvents: hideForDrag ? "none" : undefined,
              }}
              title={`${eventKindLabel(p.row)}: ${p.row.event.summary} · ${formatTimeRange(p.row.event.start, p.row.event.end)}`}
            >
              {task && (
                <TaskCheckbox
                  className="mt-0.5 size-3 shrink-0"
                  color={eventColor(p.row)}
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
                      {formatTimeRange(p.row.event.start, p.row.event.end)}
                    </span>
                  )}
                </div>
                {showStackedTime && !task && !workingLocation && (
                  <div className="w-full truncate opacity-80">
                    {formatTimeRange(p.row.event.start, p.row.event.end)}
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
  const displayEnd = displayStart + durationMs;
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
        backgroundColor: eventColor(row),
        color: eventTextColor(row),
        opacity: 0.92,
      }}
    >
      <div className="w-full truncate font-medium">
        {row.event.summary}
        {showInlineTime && (
          <span className="font-normal opacity-80">
            {" · "}
            {formatTimeRange(displayStart, displayEnd)}
          </span>
        )}
      </div>
      {showStackedTime && (
        <div className="w-full truncate opacity-80">
          {formatTimeRange(displayStart, displayEnd)}
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

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-5 w-5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-5 w-5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 8.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
      <path d="M1.75 13.25c.6-2.25 2.2-3.5 4.75-3.5s4.15 1.25 4.75 3.5" />
      <path d="M11 4.25a2.25 2.25 0 0 1 0 4.25" />
      <path d="M11.75 9.75c1.4.45 2.25 1.55 2.5 3.25" />
    </svg>
  );
}

function LocationPinIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-5 w-5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 14s4.75-4.25 4.75-8A4.75 4.75 0 0 0 3.25 6C3.25 9.75 8 14 8 14Z" />
      <circle cx="8" cy="6" r="1.5" />
    </svg>
  );
}

function CalendarTinyIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-5 w-5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </svg>
  );
}
