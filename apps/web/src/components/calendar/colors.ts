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

// Google Calendar's per-event color palette (the colors you get when you
// right-click an event and pick "Tomato", "Peacock", etc.). Keys are the
// colorId strings Google returns on event objects. Hex values match what
// the Calendar web UI paints; aligning with them is the whole point of
// pulling colorId during sync — without it every event in a calendar
// renders in the single calendar default color.
export const GOOGLE_EVENT_COLOR_PALETTE: Record<string, string> = {
  "1": "#7986cb", // Lavender
  "2": "#33b679", // Sage
  "3": "#8e24aa", // Grape
  "4": "#e67c73", // Flamingo
  "5": "#f6bf26", // Banana
  "6": "#f4511e", // Tangerine
  "7": "#039be5", // Peacock
  "8": "#616161", // Graphite
  "9": "#3f51b5", // Blueberry
  "10": "#0b8043", // Basil
  "11": "#d50000", // Tomato
};

function colorIdHex(colorId: string | undefined): string | undefined {
  if (colorId === undefined) return undefined;
  return GOOGLE_EVENT_COLOR_PALETTE[colorId];
}

// Resolution order: a local colorOverride wins (user explicitly picked a
// hex in socal), then Google's per-event colorId, and finally the calendar
// default. This mirrors how Google Calendar itself layers per-event color
// on top of the calendar color.
export function eventColor(row: EventRow): string {
  return (
    row.event.colorOverride ??
    colorIdHex(row.event.colorId) ??
    row.calendar.backgroundColor
  );
}

export function eventTextColor(row: EventRow): string {
  const override = row.event.colorOverride ?? colorIdHex(row.event.colorId);
  return override
    ? readableTextColor(override)
    : row.calendar.foregroundColor;
}

// Soft-tinted fill used by the Apple-style event treatment: the calendar/event
// color at 40% alpha (hex 66), so the block reads as a colored wash against
// the surface — not solid, not faint — letting the grid and adjacent events
// peek through while still carrying the event's identity color.
export function eventSoftFill(row: EventRow): string {
  return `${eventColor(row)}66`;
}

// Accent hex used for event title text in the soft treatment. Darkens the
// resolved event color by ~40% so titles have enough contrast against the
// 40%-alpha colored wash behind them (same-hue text on same-hue fill was
// unreadable). Accent bars and borders should keep using `eventColor` — only
// text wants the darkening.
export function eventAccent(row: EventRow): string {
  return darken(eventColor(row), 0.4);
}

export function darken(hex: string, factor: number): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const r = Math.round(Number.parseInt(value.slice(0, 2), 16) * (1 - factor));
  const g = Math.round(Number.parseInt(value.slice(2, 4), 16) * (1 - factor));
  const b = Math.round(Number.parseInt(value.slice(4, 6), 16) * (1 - factor));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
