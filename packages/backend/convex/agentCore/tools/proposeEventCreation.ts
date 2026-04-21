"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { isoInZone } from "../../timezone";
import {
  PROPOSE_MIN_GAP_MS,
  timedProposalSpacingError,
} from "../validation/timedProposal";
import type { ToolDeps } from "./deps";

export function proposeEventCreationTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId, userTimeZone, runState } = deps;
  return tool(
    async (args) => {
      console.log("[agent-tool] propose_event_creation call", {
        summary: args.summary,
        startIso: args.startIso,
        endIso: args.endIso,
        allDay: args.allDay,
        location: args.location,
        calendarId: args.calendarId,
        spacingValidationOverride: args.spacingValidationOverride,
      });
      const start = Date.parse(args.startIso);
      const end = Date.parse(args.endIso);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return (
          "FAILED — propose_event_creation: startIso/endIso are not valid ISO 8601 timestamps. " +
          "Fix the strings (use the user's local offset from the system prompt) and retry."
        );
      }
      if (end <= start) {
        return (
          "FAILED — propose_event_creation: endIso must be strictly after startIso. " +
          "No proposal was created."
        );
      }
      const allDay = args.allDay ?? false;
      if (!allDay && !args.spacingValidationOverride) {
        const busyRows = await ctx.runQuery(api.events.listForUserInRange, {
          userId,
          start: start - PROPOSE_MIN_GAP_MS,
          end: end + PROPOSE_MIN_GAP_MS,
        });
        const spacingErr = timedProposalSpacingError(
          start,
          end,
          busyRows,
          userTimeZone,
        );
        if (spacingErr !== null) {
          console.log("[agent-tool] propose_event_creation rejected", {
            summary: args.summary,
            reason: spacingErr,
          });
          return `FAILED — propose_event_creation: ${spacingErr}`;
        }
      }
      const calendarId =
        (args.calendarId as Id<"calendars"> | undefined) ??
        (await ctx.runQuery(api.calendars.defaultWritable, { userId }));
      if (!calendarId) {
        return (
          "FAILED — propose_event_creation: no writable calendar is connected for this user. " +
          "No proposal was created."
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
        allDay,
      });
      runState.proposalIds.push(proposalId);
      console.log("[agent-tool] propose_event_creation result", {
        proposalId,
        summary: args.summary,
      });
      return `Proposed '${args.summary}' for ${isoInZone(start, userTimeZone)} – ${isoInZone(end, userTimeZone)}. Awaiting user approval. proposalId=${proposalId}`;
    },
    {
      name: "propose_event_creation",
      description:
        "Create a PENDING event proposal for the user. Does NOT create the event directly. " +
        "The user will see a ghost card in their calendar and can Accept or Reject it. " +
        "Use this whenever the user asks to add, book, schedule, or block time for something. " +
        "Gather enough context first (e.g. get_user_schedule to check for conflicts) — do not call speculatively. " +
        "For timed events (allDay false or omitted), the server rejects proposals that overlap other timed events or sit within 15 minutes of another timed event's start/end unless spacingValidationOverride is true — all-day events are ignored for this check. Use the override only when the user explicitly asked for back-to-back or overlapping placement. " +
        "If the call fails validation, the tool returns a message starting with FAILED — read that message (it explains overlap vs too-tight gap and what to change); do not blindly retry the same times.",
      schema: z.object({
        summary: z
          .string()
          .describe("Short title for the event, e.g. 'Walk' or 'Lunch with Alex'."),
        startIso: z
          .string()
          .describe(
            "Event start in ISO 8601 with the user's LOCAL offset (from the system prompt), e.g. 2026-04-20T15:00:00-07:00. Do NOT use UTC ('...Z') unless the user is actually in UTC.",
          ),
        endIso: z
          .string()
          .describe(
            "Event end (exclusive) in ISO 8601 with the user's local offset. Must be after startIso.",
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
        spacingValidationOverride: z
          .boolean()
          .optional()
          .describe(
            "If true, skip server checks that block overlap and <15 min gaps vs existing events. " +
              "Only set when the user explicitly asked for back-to-back or overlapping events. Default false.",
          ),
      }),
    },
  );
}
