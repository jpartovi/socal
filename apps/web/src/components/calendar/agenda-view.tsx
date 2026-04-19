"use client";

import { EventPopover } from "@/components/calendar/event-popover";
import {
  addDays,
  formatTime,
  sameDay,
  startOfDay,
} from "@/components/calendar/lib";
import type { EventRow } from "@/components/calendar/types";

export function AgendaView({
  events,
  anchor,
}: {
  events: EventRow[];
  anchor: Date;
}) {
  // Group by day for the 30-day window starting at anchor.
  const days: Date[] = [];
  for (let i = 0; i < 30; i++) {
    days.push(addDays(startOfDay(anchor), i));
  }

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

  const visibleDays = days.filter(
    (d) => (byDay.get(d.getTime())?.length ?? 0) > 0,
  );

  if (visibleDays.length === 0) {
    return (
      <p className="px-2 py-8 text-sm text-muted-foreground">
        No upcoming events.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-2">
      {visibleDays.map((d) => {
        const rows = byDay.get(d.getTime()) ?? [];
        return (
          <div key={d.getTime()} className="flex flex-col gap-2">
            <DayHeader date={d} />
            <ul className="flex flex-col divide-y rounded-xl border">
              {rows.map((row) => (
                <AgendaRow
                  key={`${d.getTime()}-${row.event._id}`}
                  row={row}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function DayHeader({ date }: { date: Date }) {
  const today = sameDay(date, new Date());
  return (
    <div className="flex items-baseline gap-2 px-1">
      <span
        className={`text-sm font-medium ${
          today ? "text-primary" : "text-foreground"
        }`}
      >
        {date.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}
      </span>
      {today && (
        <span className="text-xs text-muted-foreground">Today</span>
      )}
    </div>
  );
}

function AgendaRow({ row }: { row: EventRow }) {
  const { event, calendar } = row;
  return (
    <li>
      <EventPopover row={row}>
        <button
          type="button"
          className="flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition hover:bg-muted"
        >
          <span
            aria-hidden
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: calendar.backgroundColor }}
          />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{event.summary}</span>
              {event.location && (
                <span className="truncate text-xs text-muted-foreground">
                  {event.location}
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {event.allDay
                ? "All day"
                : `${formatTime(event.start)} – ${formatTime(event.end)}`}
            </span>
          </div>
        </button>
      </EventPopover>
    </li>
  );
}
