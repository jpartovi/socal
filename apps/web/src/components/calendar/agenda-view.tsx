"use client";

import { EventPopover } from "@/components/calendar/event-popover";
import { eventColor } from "@/components/calendar/colors";
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
} from "@/components/calendar/lib";
import { ProposalItem } from "@/components/calendar/proposal-item";
import type { EventRow, ProposalRow } from "@/components/calendar/types";

// Discriminated union so proposal ghost cards can be interleaved with event
// rows by start time without losing type info at the render site.
type AgendaItem =
  | { kind: "event"; start: number; row: EventRow }
  | { kind: "proposal"; start: number; row: ProposalRow };

export function AgendaView({
  events,
  proposals,
  anchor,
}: {
  events: EventRow[];
  proposals: ProposalRow[];
  anchor: Date;
}) {
  // Group by day for the 30-day window starting at anchor.
  const days: Date[] = [];
  for (let i = 0; i < 30; i++) {
    days.push(addDays(startOfDay(anchor), i));
  }

  const byDay = new Map<number, AgendaItem[]>();
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
    <div className="flex flex-col gap-7 px-2">
      {visibleDays.map((d) => {
        const items = (byDay.get(d.getTime()) ?? [])
          .slice()
          .sort((a, b) => a.start - b.start);
        return (
          <div key={d.getTime()} className="flex flex-col gap-3">
            <DayHeader date={d} />
            <ul className="flex flex-col gap-2">
              {items.map((item) =>
                item.kind === "event" ? (
                  <AgendaRow
                    key={`${d.getTime()}-event-${item.row.event._id}`}
                    row={item.row}
                  />
                ) : (
                  <li
                    key={`${d.getTime()}-proposal-${item.row.proposal._id}`}
                  >
                    <ProposalItem row={item.row} variant="agenda" />
                  </li>
                ),
              )}
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
    <div className="flex items-baseline gap-3 px-1">
      <span
        className="font-display text-2xl leading-none tracking-tight text-foreground/90"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {date.toLocaleDateString(undefined, {
          weekday: "long",
        })}
      </span>
      <span className="text-xs text-muted-foreground">
        {date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
        {today ? " · Today" : ""}
      </span>
    </div>
  );
}

function AgendaRow({ row }: { row: EventRow }) {
  const { event } = row;
  const color = eventColor(row);
  const task = isTask(row);
  const workingLocation = isWorkingLocation(row);
  return (
    <li>
      <EventPopover row={row}>
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-xl bg-card/70 px-4 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.03),0_6px_16px_rgba(16,24,40,0.05)] outline-none backdrop-blur-sm transition-transform duration-150 ease-out hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(16,24,40,0.04),0_10px_24px_rgba(16,24,40,0.06)]"
          title={`${eventKindLabel(row)}: ${event.summary}`}
        >
          {task ? (
            <span
              aria-hidden
              className="mt-1 size-3 shrink-0 rounded-[3px] border-2 bg-background"
              style={{ borderColor: color }}
            />
          ) : workingLocation ? (
            <BuildingIcon
              className="mt-0.5 size-4 shrink-0"
              color={color}
            />
          ) : (
            <span
              aria-hidden
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          )}
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-base font-medium"
                style={{ color: task || workingLocation ? color : undefined }}
              >
                {event.summary}
              </span>
              {(task || workingLocation) && (
                <span className="truncate text-xs text-muted-foreground">
                  {eventKindLabel(row)}
                </span>
              )}
              {event.location && (
                <span className="truncate text-xs text-muted-foreground">
                  {event.location}
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {task
                ? ""
                : event.allDay
                  ? "All day"
                  : `${formatTime(event.start)} – ${formatTime(event.end)}`}
            </span>
          </div>
        </button>
      </EventPopover>
    </li>
  );
}

function BuildingIcon({
  className,
  color,
}: {
  className: string;
  color: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className}
      fill="none"
      stroke={color}
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
