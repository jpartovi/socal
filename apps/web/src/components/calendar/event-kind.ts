import type { EventRow } from "@/components/calendar/types";

export type EventKind = "event" | "workingLocation" | "task";

export function eventKind(row: EventRow): EventKind {
  if (row.event.eventKind) return row.event.eventKind;
  const calendarName =
    row.calendar.summaryOverride ?? row.calendar.summary ?? "";
  if (calendarName.toLowerCase() === "tasks") return "task";
  return "event";
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
