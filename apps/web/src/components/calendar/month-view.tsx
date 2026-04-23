"use client";

import { EventPopover } from "@/components/calendar/event-popover";
import {
  eventAccent,
  eventColor,
  eventSoftFill,
} from "@/components/calendar/colors";
import {
  eventKindLabel,
  isTask,
  isWorkingLocation,
} from "@/components/calendar/event-kind";
import {
  addDays,
  formatTime,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@/components/calendar/lib";
import { ProposalItem } from "@/components/calendar/proposal-item";
import type { EventRow, ProposalRow } from "@/components/calendar/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PILLS_PER_CELL = 3;

type CellItem =
  | { kind: "event"; start: number; row: EventRow }
  | { kind: "proposal"; start: number; row: ProposalRow };

export function MonthView({
  events,
  proposals,
  anchor,
}: {
  events: EventRow[];
  proposals: ProposalRow[];
  anchor: Date;
}) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));

  const byDay = new Map<number, CellItem[]>();
  for (const row of events) {
    const first = startOfDay(new Date(row.event.start));
    const last = startOfDay(new Date(row.event.end - 1));
    let cur = first;
    while (cur.getTime() <= last.getTime()) {
      const key = cur.getTime();
      const list = byDay.get(key) ?? [];
      list.push({ kind: "event", start: row.event.start, row });
      byDay.set(key, list);
      cur = addDays(cur, 1);
    }
  }
  for (const row of proposals) {
    const first = startOfDay(new Date(row.proposal.start));
    const last = startOfDay(new Date(row.proposal.end - 1));
    let cur = first;
    while (cur.getTime() <= last.getTime()) {
      const key = cur.getTime();
      const list = byDay.get(key) ?? [];
      list.push({ kind: "proposal", start: row.proposal.start, row });
      byDay.set(key, list);
      cur = addDays(cur, 1);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 gap-1 p-1">
        {days.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, new Date());
          const items = (byDay.get(d.getTime()) ?? [])
            .slice()
            .sort((a, b) => a.start - b.start);
          const visible = items.slice(0, MAX_PILLS_PER_CELL);
          const hidden = items.length - visible.length;
          return (
            <div
              key={d.getTime()}
              className={`flex min-h-24 flex-col gap-0.5 rounded-2xl p-1.5 ${
                inMonth
                  ? "bg-card/60 shadow-[0_1px_2px_rgba(16,24,40,0.03),0_6px_16px_rgba(16,24,40,0.04)] backdrop-blur-sm"
                  : "bg-transparent"
              }`}
            >
              <span
                className={`self-start font-display text-sm leading-none tracking-tight ${
                  today
                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background"
                    : inMonth
                      ? "text-foreground/80"
                      : "text-muted-foreground/60"
                }`}
                style={{ fontFamily: "var(--font-display)" }}
              >
                {d.getDate()}
              </span>
              {visible.map((item) =>
                item.kind === "event" ? (
                  <MonthPill
                    key={`${d.getTime()}-event-${item.row.event._id}`}
                    row={item.row}
                  />
                ) : (
                  <ProposalItem
                    key={`${d.getTime()}-proposal-${item.row.proposal._id}`}
                    row={item.row}
                    variant="month"
                  />
                ),
              )}
              {hidden > 0 && (
                <span className="px-1 text-[10px] text-muted-foreground">
                  +{hidden} more
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthPill({ row }: { row: EventRow }) {
  const { event, calendar } = row;
  const color = eventColor(row);
  const task = isTask(row);
  const workingLocation = isWorkingLocation(row);
  if (event.allDay) {
    return (
      <EventPopover row={row}>
        <button
          type="button"
          className={`flex items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-left text-[10px] leading-tight outline-none transition-transform duration-150 ease-out will-change-transform hover:scale-[1.02] active:scale-[0.98] ${
            workingLocation ? "border-l-4 bg-transparent" : ""
          }`}
          style={{
            backgroundColor: workingLocation ? undefined : eventSoftFill(row),
            borderColor: workingLocation ? color : undefined,
            color: eventAccent(row),
            boxShadow: workingLocation
              ? undefined
              : "0 1px 1px rgba(16,24,40,0.04)",
          }}
          title={`${eventKindLabel(row)}: ${event.summary}`}
        >
          {workingLocation && <BuildingIcon className="size-3 shrink-0" />}
          <span className="truncate font-medium">{event.summary}</span>
        </button>
      </EventPopover>
    );
  }
  return (
    <EventPopover row={row}>
      <button
        type="button"
        className="flex items-center gap-1 truncate rounded-md px-1 text-left text-[10px] leading-tight outline-none transition-transform duration-150 ease-out will-change-transform hover:scale-[1.02] active:scale-[0.98] hover:bg-muted"
        style={{ color: color }}
        title={`${eventKindLabel(row)}: ${event.summary}`}
      >
        {task ? (
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px] border-2 bg-background"
            style={{ borderColor: color }}
          />
        ) : (
          <>
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="shrink-0 opacity-70">
              {formatTime(event.start)}
            </span>
          </>
        )}
        <span className="truncate font-medium">{event.summary}</span>
      </button>
    </EventPopover>
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
