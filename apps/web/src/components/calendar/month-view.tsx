"use client";

import { EventPopover } from "@/components/calendar/event-popover";
import {
  addDays,
  formatTime,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@/components/calendar/lib";
import type { EventRow } from "@/components/calendar/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_PILLS_PER_CELL = 3;

export function MonthView({
  events,
  anchor,
}: {
  events: EventRow[];
  anchor: Date;
}) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));

  const byDay = new Map<number, EventRow[]>();
  for (const row of events) {
    const first = startOfDay(new Date(row.event.start));
    const last = startOfDay(new Date(row.event.end - 1));
    let cur = first;
    while (cur.getTime() <= last.getTime()) {
      const key = cur.getTime();
      const list = byDay.get(key) ?? [];
      list.push(row);
      byDay.set(key, list);
      cur = addDays(cur, 1);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border">
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, new Date());
          const rows = byDay.get(d.getTime()) ?? [];
          rows.sort((a, b) => a.event.start - b.event.start);
          const visible = rows.slice(0, MAX_PILLS_PER_CELL);
          const hidden = rows.length - visible.length;
          return (
            <div
              key={d.getTime()}
              className={`flex min-h-24 flex-col gap-0.5 border-b border-l p-1 ${
                inMonth ? "bg-background" : "bg-muted/20"
              }`}
            >
              <span
                className={`self-start text-[11px] ${
                  today
                    ? "rounded-full bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {d.getDate()}
              </span>
              {visible.map((row) => (
                <MonthPill
                  key={`${d.getTime()}-${row.event._id}`}
                  row={row}
                />
              ))}
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
  if (event.allDay) {
    return (
      <EventPopover row={row}>
        <button
          type="button"
          className="truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight outline-none transition hover:brightness-95"
          style={{
            backgroundColor: calendar.backgroundColor,
            color: calendar.foregroundColor,
          }}
          title={event.summary}
        >
          {event.summary}
        </button>
      </EventPopover>
    );
  }
  return (
    <EventPopover row={row}>
      <button
        type="button"
        className="flex items-center gap-1 truncate px-1 text-left text-[10px] leading-tight outline-none hover:bg-muted"
        title={event.summary}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: calendar.backgroundColor }}
        />
        <span className="shrink-0 text-muted-foreground">
          {formatTime(event.start)}
        </span>
        <span className="truncate">{event.summary}</span>
      </button>
    </EventPopover>
  );
}
