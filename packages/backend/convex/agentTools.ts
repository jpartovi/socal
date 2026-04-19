"use node";

// LangChain tool factory for the calendar agent.
//
// Organization: tools are grouped into two tiers — a convention, not a
// LangChain primitive — so the model (and future per-tier observability)
// can treat them differently:
//
//   INTERNAL tools: read-only, agent-private reasoning steps. Idempotent,
//     cheap, safe to retry. No user-visible side effect. Today: read_schedule.
//
//   EXTERNAL tools: produce user-visible artifacts that persist. Today:
//     propose_event_creation (writes a pending row to eventProposals).
//
// `agent.ts` keeps calling `makeCalendarTools(deps)` — the split becomes
// load-bearing only when we want per-tier logging/safety hooks, which we get
// by wrapping either factory.
//
// Growth path: when this file gets uncomfortable (~3-5 tools or any single
// tool > ~80 lines), promote to `convex/agentTools/` with one file per tool
// plus an `index.ts` barrel re-exporting `makeCalendarTools`. The import in
// `agent.ts` resolves unchanged.

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

type ToolDeps = { ctx: ActionCtx; userId: Id<"users"> };

// Return types are annotated (rather than inferred) because strict TS chokes
// on the combination of tool()'s heavily-generic return type and Convex's
// self-referential `api` typings.

// --- Internal tools (read-only, agent-private) -----------------------------

const readSchedule = ({ ctx, userId }: ToolDeps): StructuredToolInterface =>
  tool(
    async ({ startIso, endIso }) => {
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
      // Compact projection: the agent doesn't need attendee photo URLs,
      // htmlLinks, Convex ids, etc. Keep the token cost down.
      return JSON.stringify(
        rows.map(({ event, calendar }) => ({
          summary: event.summary,
          start: new Date(event.start).toISOString(),
          end: new Date(event.end).toISOString(),
          allDay: event.allDay,
          location: event.location,
          calendar: calendar.summaryOverride ?? calendar.summary,
          attendees: event.attendees?.length ?? 0,
        })),
      );
    },
    {
      name: "read_schedule",
      description:
        "Return events on the user's enabled calendars whose start time falls within [startIso, endIso). " +
        "Use ISO 8601 timestamps with timezone offsets, e.g. 2026-04-20T00:00:00-07:00. " +
        "Cancelled events are excluded. Results are sorted by start time.",
      schema: z.object({
        startIso: z
          .string()
          .describe("Inclusive window start, ISO 8601 with offset."),
        endIso: z
          .string()
          .describe("Exclusive window end, ISO 8601 with offset."),
      }),
    },
  );

// --- External tools (user-visible side effects) ----------------------------

const proposeEventCreation = ({
  ctx,
  userId,
}: ToolDeps): StructuredToolInterface =>
  tool(
    async (args) => {
      const start = Date.parse(args.startIso);
      const end = Date.parse(args.endIso);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error("startIso/endIso must be valid ISO 8601 timestamps");
      }
      if (end <= start) {
        throw new Error("endIso must be strictly after startIso");
      }
      // If the model didn't name a calendar, fall back to the user's default
      // writable (primary) calendar — matches the UI's quick-create behavior.
      const calendarId =
        (args.calendarId as Id<"calendars"> | undefined) ??
        (await ctx.runQuery(api.calendars.defaultWritable, { userId }));
      if (!calendarId) {
        throw new Error(
          "No writable calendar is connected for this user; cannot propose an event.",
        );
      }
      const proposalId = await ctx.runMutation(api.proposals.create, {
        userId,
        calendarId,
        summary: args.summary,
        description: args.description,
        location: args.location,
        start,
        end,
        allDay: args.allDay ?? false,
      });
      return `Proposed '${args.summary}' for ${new Date(start).toISOString()} – ${new Date(end).toISOString()}. Awaiting user approval. proposalId=${proposalId}`;
    },
    {
      name: "propose_event_creation",
      description:
        "Create a PENDING event proposal for the user. Does NOT create the event directly. " +
        "The user will see a ghost card in their calendar and can Accept or Reject it. " +
        "Use this whenever the user asks to add, book, schedule, or block time for something. " +
        "Gather enough context with internal tools first (e.g. read_schedule to check for conflicts) — do not call speculatively.",
      schema: z.object({
        summary: z
          .string()
          .describe("Short title for the event, e.g. 'Walk' or 'Lunch with Alex'."),
        startIso: z
          .string()
          .describe(
            "Event start in ISO 8601 with timezone offset, e.g. 2026-04-20T15:00:00-07:00.",
          ),
        endIso: z
          .string()
          .describe(
            "Event end (exclusive) in ISO 8601 with timezone offset. Must be after startIso.",
          ),
        allDay: z
          .boolean()
          .optional()
          .describe(
            "True for all-day events. Default false. When true, start/end should be UTC midnights spanning the intended day(s).",
          ),
        description: z
          .string()
          .optional()
          .describe("Optional longer description / body."),
        location: z
          .string()
          .optional()
          .describe("Optional free-form location string."),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Optional Convex calendar id. Leave unset to use the user's default writable calendar.",
          ),
      }),
    },
  );

// --- Factories -------------------------------------------------------------

export function makeInternalTools(deps: ToolDeps): StructuredToolInterface[] {
  return [readSchedule(deps)];
}

export function makeExternalTools(deps: ToolDeps): StructuredToolInterface[] {
  return [proposeEventCreation(deps)];
}

export function makeCalendarTools(deps: ToolDeps): StructuredToolInterface[] {
  return [...makeInternalTools(deps), ...makeExternalTools(deps)];
}
