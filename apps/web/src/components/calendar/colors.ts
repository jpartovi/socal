import type { EventRow } from "@/components/calendar/types";

export const EVENT_COLOR_SWATCHES = [
  "#c2185b",
  "#d81b60",
  "#e67c73",
  "#f4511e",
  "#ef6c00",
  "#f6bf26",
  "#c0ca33",
  "#7cb342",
  "#33b679",
  "#0b8043",
  "#009688",
  "#039be5",
  "#3f51b5",
  "#7986cb",
  "#8e24aa",
  "#9e69af",
  "#616161",
];

export function eventColor(row: EventRow): string {
  return row.event.colorOverride ?? row.calendar.backgroundColor;
}

export function eventTextColor(row: EventRow): string {
  return row.event.colorOverride
    ? readableTextColor(row.event.colorOverride)
    : row.calendar.foregroundColor;
}

export function readableTextColor(hex: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "#ffffff";
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#202124" : "#ffffff";
}
