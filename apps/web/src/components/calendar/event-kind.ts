import type { EventRow } from "@/components/calendar/types";

export type EventKind = "event" | "workingLocation" | "task";

export function eventKind(row: EventRow): EventKind {
  const calendarName =
    row.calendar.summaryOverride ?? row.calendar.summary ?? "";
  if (looksLikeTasksCalendar(calendarName)) return "task";
  if (row.event.eventKind) return row.event.eventKind;
  return "event";
}

function looksLikeTasksCalendar(calendarName: string): boolean {
  const normalized = calendarName.toLowerCase().trim();
  return normalized === "tasks" || normalized === "task";
}

export function isTask(row: EventRow): boolean {
  return eventKind(row) === "task";
}

export function isWorkingLocation(row: EventRow): boolean {
  return eventKind(row) === "workingLocation";
}

export function eventKindLabel(row: EventRow): string {
  const kind = eventKind(row);
  if (kind === "task") return "Task";
  if (kind === "workingLocation") return "Working location";
  return "Event";
}
