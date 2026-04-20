"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "../../_generated/api";
import { isoInZone, localDateOnlyInZone } from "../../timezone";
import type { ToolDeps } from "./deps";

function scheduleRowForAgent(
  event: {
    summary: string;
    start: number;
    end: number;
    allDay: boolean;
    location?: string;
    attendees?: unknown[] | undefined;
  },
  calendarLabel: string,
  userTimeZone: string | undefined,
) {
  if (event.allDay) {
    const startDate = localDateOnlyInZone(event.start, userTimeZone);
    const endDateInclusive = localDateOnlyInZone(event.end - 1, userTimeZone);
    return {
      summary: event.summary,
      allDay: true as const,
      startDate,
      endDate: endDateInclusive,
      location: event.location,
      calendar: calendarLabel,
      attendees: event.attendees?.length ?? 0,
    };
  }
  return {
    summary: event.summary,
    allDay: false as const,
    start: isoInZone(event.start, userTimeZone),
    end: isoInZone(event.end, userTimeZone),
    location: event.location,
    calendar: calendarLabel,
    attendees: event.attendees?.length ?? 0,
  };
}

export function getUserScheduleTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId, userTimeZone } = deps;
  return tool(
    async ({ startIso, endIso }) => {
      console.log("[agent-tool] get_user_schedule call", { startIso, endIso });
      const start = Date.parse(startIso);
      const end = Date.parse(endIso);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error("startIso/endIso must be valid ISO 8601 timestamps");
      }
      if (end <= start) {
        throw new Error("endIso must be strictly after startIso");
      }
      const rows = await ctx.runQuery(api.events.listForUserInRange, {
        userId,
        start,
        end,
      });
      const calendarLabel = (c: (typeof rows)[0]["calendar"]) =>
        c.summaryOverride ?? c.summary;
      console.log("[agent-tool] get_user_schedule result", {
        startIso,
        endIso,
        count: rows.length,
        events: rows.map(({ event, calendar }) => {
          const label = calendarLabel(calendar);
          if (event.allDay) {
            const startDate = localDateOnlyInZone(event.start, userTimeZone);
            const endDate = localDateOnlyInZone(event.end - 1, userTimeZone);
            return `${startDate}–${endDate} (all day) ${event.summary ?? "(untitled)"} [${label}]`;
          }
          return `${isoInZone(event.start, userTimeZone)} – ${isoInZone(event.end, userTimeZone)} ${event.summary ?? "(untitled)"}`;
        }),
      });
      return JSON.stringify(
        rows.map(({ event, calendar }) =>
          scheduleRowForAgent(
            event,
            calendar.summaryOverride ?? calendar.summary,
            userTimeZone,
          ),
        ),
      );
    },
    {
      name: "get_user_schedule",
      description:
        "Return every event on the user's enabled calendars that overlaps [startIso, endIso) — " +
        "i.e. any event that is going on for any part of that window, including events that started before it, events contained within it, and events that run past it. " +
        "Pass ISO 8601 timestamps with the USER'S LOCAL offset, e.g. 2026-04-20T00:00:00-07:00 (the system prompt tells you the offset). " +
        "Timed events use start/end as ISO 8601 in the user's local zone. All-day events use startDate and endDate as YYYY-MM-DD (inclusive end date). " +
        "Cancelled events are excluded. Results are sorted by start time.",
      schema: z.object({
        startIso: z
          .string()
          .describe(
            "Inclusive window start, ISO 8601 with the user's local offset.",
          ),
        endIso: z
          .string()
          .describe(
            "Exclusive window end, ISO 8601 with the user's local offset.",
          ),
      }),
    },
  );
}
