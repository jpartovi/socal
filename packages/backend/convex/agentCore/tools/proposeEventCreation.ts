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
import { timeOfDayWindowError } from "../validation/timeOfDayWindow";
import type { ToolDeps } from "./deps";

// Agent-facing proposal tool. Always accepts an `options` array of 1–3
// alternative time slots for the same underlying event. Single-option calls
// produce a normal proposal (no groupId); multi-option calls produce a linked
// set so accepting one auto-rejects the others (see proposals._markAccepted).
//
// Validation is all-or-nothing: if ANY option fails spacing validation against
// the user's own calendar, no proposals are inserted and the tool returns a
// FAILED string naming the offending option. This keeps the agent from
// partially committing and having to reason about half-inserted groups.
export function proposeEventCreationTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId, userTimeZone, runState } = deps;
  return tool(
    async (args) => {
      console.log("[agent-tool] propose_event_creation call", {
<<<<<<< HEAD
        optionCount: args.options.length,
        summaries: args.options.map((o) => o.summary),
=======
        summary: args.summary,
        startIso: args.startIso,
        endIso: args.endIso,
        allDay: args.allDay,
        location: args.location,
        calendarId: args.calendarId,
        googleAccountEmail: args.googleAccountEmail,
>>>>>>> main
        spacingValidationOverride: args.spacingValidationOverride,
        participantFriendUserIds: args.participantFriendUserIds,
      });
      if (args.options.length === 0) {
        return "FAILED — propose_event_creation: options must contain at least one entry.";
      }
      if (args.options.length > 3) {
        return "FAILED — propose_event_creation: at most 3 options are allowed in a single call.";
      }
<<<<<<< HEAD

      type ParsedOption = {
        index: number;
        summary: string;
        description?: string;
        location?: string;
        start: number;
        end: number;
        allDay: boolean;
      };
      const parsed: ParsedOption[] = [];
      for (let i = 0; i < args.options.length; i++) {
        const opt = args.options[i];
        const start = Date.parse(opt.startIso);
        const end = Date.parse(opt.endIso);
        if (Number.isNaN(start) || Number.isNaN(end)) {
          return (
            `FAILED — propose_event_creation: option ${i + 1} has invalid ISO 8601 in startIso/endIso. ` +
            `Fix the strings (use the user's local offset from the system prompt) and retry. No proposals were created.`
          );
        }
        if (end <= start) {
          return (
            `FAILED — propose_event_creation: option ${i + 1} has endIso <= startIso. ` +
            `No proposals were created.`
          );
        }
        parsed.push({
          index: i,
          summary: opt.summary,
          description: opt.description,
          location: opt.location,
=======
      const rawFriendIds = args.participantFriendUserIds ?? [];
      const participantFriendUserIds = [
        ...new Set(rawFriendIds.map((id) => id as Id<"users">)),
      ];
      const allDay = args.allDay ?? false;
      if (!allDay && !args.spacingValidationOverride) {
        const busyRows = await ctx.runQuery(api.events.listForUserInRange, {
          userId,
          start: start - PROPOSE_MIN_GAP_MS,
          end: end + PROPOSE_MIN_GAP_MS,
        });
        const spacingErr = timedProposalSpacingError(
>>>>>>> main
          start,
          end,
          allDay: opt.allDay ?? false,
        });
      }

      // Time-of-day window validation: "dinner" has to land in dinner hours,
      // "coffee" in daytime, etc. Caught here (not just in the prompt) because
      // the model otherwise drifts into 3pm dinners and 4am coffees when the
      // schedule is tight. All-or-nothing like the spacing check.
      if (!args.timeOfDayOverride) {
        for (const opt of parsed) {
          if (opt.allDay) continue;
          const err = timeOfDayWindowError(opt.summary, opt.start, userTimeZone);
          if (err !== null) {
            console.log("[agent-tool] propose_event_creation rejected (time-of-day)", {
              optionIndex: opt.index,
              summary: opt.summary,
              reason: err,
            });
            return (
              `FAILED — propose_event_creation: option ${opt.index + 1} (${opt.summary}) failed time-of-day check. ` +
              `${err} No proposals were created.`
            );
          }
        }
        const rangeStart = start - PROPOSE_MIN_GAP_MS;
        const rangeEnd = end + PROPOSE_MIN_GAP_MS;
        for (const friendId of participantFriendUserIds) {
          const friendUser = await ctx.runQuery(api.users.getById, {
            userId: friendId,
          });
          const friendLabel =
            friendUser !== null
              ? `${friendUser.firstName} ${friendUser.lastName}`.trim() ||
                "Friend"
              : "Friend";
          const allowed = await ctx.runQuery(api.friendships.areFriends, {
            viewerId: userId,
            ownerId: friendId,
          });
          if (!allowed) {
            return (
              `FAILED — propose_event_creation: ${friendLabel} is not an accepted friend ` +
              `(participantFriendUserIds). No proposal was created. Ask the user to connect as friends first.`
            );
          }
          const friendBusy = await ctx.runQuery(api.events.listForUserInRange, {
            userId: friendId,
            start: rangeStart,
            end: rangeEnd,
          });
          const friendSpacingErr = timedProposalSpacingError(
            start,
            end,
            friendBusy,
            userTimeZone,
            { subjectDescription: `${friendLabel}'s calendar` },
          );
          if (friendSpacingErr !== null) {
            console.log("[agent-tool] propose_event_creation rejected (friend)", {
              summary: args.summary,
              friendId,
              reason: friendSpacingErr,
            });
            return `FAILED — propose_event_creation: ${friendSpacingErr}`;
          }
        }
      }
<<<<<<< HEAD

      // Spacing validation per option. All-or-nothing: a single failure aborts
      // the whole batch. Fetch each option's busy window in parallel so a
      // 3-option call is one round-trip instead of three.
      if (!args.spacingValidationOverride) {
        const timed = parsed.filter((p) => !p.allDay);
        const busyByIndex = await Promise.all(
          timed.map((opt) =>
            ctx.runQuery(api.events.listForUserInRange, {
              userId,
              start: opt.start - PROPOSE_MIN_GAP_MS,
              end: opt.end + PROPOSE_MIN_GAP_MS,
            }),
          ),
        );
        for (let i = 0; i < timed.length; i++) {
          const opt = timed[i];
          const spacingErr = timedProposalSpacingError(
            opt.start,
            opt.end,
            busyByIndex[i],
            userTimeZone,
          );
          if (spacingErr !== null) {
            console.log("[agent-tool] propose_event_creation rejected", {
              optionIndex: opt.index,
              summary: opt.summary,
              reason: spacingErr,
            });
            return (
              `FAILED — propose_event_creation: option ${opt.index + 1} (${opt.summary}) failed spacing check. ` +
              `${spacingErr} No proposals were created — fix that option (or drop it) and retry the whole batch.`
            );
          }
        }
      }

      const calendarId =
        (args.calendarId as Id<"calendars"> | undefined) ??
        (await ctx.runQuery(api.calendars.defaultWritable, { userId }));
      if (!calendarId) {
        return (
          "FAILED — propose_event_creation: no writable calendar is connected for this user. " +
          "No proposals were created."
        );
=======
      let calendarId: Id<"calendars"> | null = null;
      if (args.calendarId) {
        calendarId = args.calendarId as Id<"calendars">;
      } else {
        const email = args.googleAccountEmail?.trim();
        const cal = await ctx.runQuery(api.calendars.writableCalendarForUser, {
          userId,
          accountEmail: email ? email : undefined,
        });
        calendarId = cal?._id ?? null;
        if (!calendarId) {
          return email
            ? "FAILED — propose_event_creation: no connected Google account matches that email " +
                "(use the exact address from Calendar accounts). No proposal was created."
            : "FAILED — propose_event_creation: no writable calendar is connected for this user. " +
                "No proposal was created.";
        }
>>>>>>> main
      }

      // Single-option calls still use `create` so they stay groupless — keeps
      // the UI from rendering a "1/1" badge for solo proposals.
      if (parsed.length === 1) {
        const only = parsed[0];
        const proposalId = await ctx.runMutation(api.proposals.create, {
          userId,
          calendarId,
          summary: only.summary,
          description: only.description,
          location: only.location,
          start: only.start,
          end: only.end,
          allDay: only.allDay,
        });
        runState.proposalIds.push(proposalId);
        console.log("[agent-tool] propose_event_creation result", {
          proposalId,
          summary: only.summary,
        });
        return `Proposed '${only.summary}' for ${isoInZone(only.start, userTimeZone)} – ${isoInZone(only.end, userTimeZone)}. Awaiting user approval. proposalId=${proposalId}`;
      }

      const proposalIds = await ctx.runMutation(api.proposals.createBatch, {
        userId,
        calendarId,
<<<<<<< HEAD
        options: parsed.map((p) => ({
          summary: p.summary,
          description: p.description,
          location: p.location,
          start: p.start,
          end: p.end,
          allDay: p.allDay,
        })),
=======
        summary: args.summary,
        description: args.description,
        location: args.location,
        start,
        end,
        allDay,
        participantFriendUserIds:
          participantFriendUserIds.length > 0
            ? participantFriendUserIds
            : undefined,
>>>>>>> main
      });
      for (const id of proposalIds) runState.proposalIds.push(id);
      console.log("[agent-tool] propose_event_creation batch result", {
        proposalIds,
        count: proposalIds.length,
      });
      const lines = parsed.map(
        (p, i) =>
          `  ${i + 1}. ${p.summary} — ${isoInZone(p.start, userTimeZone)} – ${isoInZone(p.end, userTimeZone)} (proposalId=${proposalIds[i]})`,
      );
      return (
        `Proposed ${parsed.length} linked options. Accepting any one auto-rejects the rest:\n` +
        lines.join("\n")
      );
    },
    {
      name: "propose_event_creation",
      description:
<<<<<<< HEAD
        "Create PENDING event proposal(s) for the user. Does NOT create events directly — the user sees ghost cards and Accepts/Rejects. " +
        "Always takes an `options` array (1–3 entries). Use multiple options when the request is loose and the user would benefit from choices (e.g. 'dinner this week', 'coffee sometime tomorrow'). Use a single option when the user specified an exact time, or when the schedule only admits one reasonable slot. " +
        "When you provide multiple options, they are LINKED: all options appear together, and accepting one auto-rejects the others. All options should represent the SAME underlying event (same summary) at DIFFERENT times — don't mix unrelated events into one call. " +
        "Gather context first with get_user_schedule (and get_friend_schedule if relevant). For timed options, the server rejects any option that overlaps another timed event or sits within 15 min of one unless spacingValidationOverride is true. All-day existing events don't block. " +
        "Validation is all-or-nothing: if any single option fails, NO proposals are created — read the FAILED message for which option and why, fix or drop that option, and retry the whole batch. Do not blindly retry the same args.",
      schema: z.object({
        options: z
          .array(
            z.object({
              summary: z
                .string()
                .describe(
                  "Short title for the event, e.g. 'Walk' or 'Lunch with Alex'. " +
                    "When offering multiple options, all should share the same summary — they're the same event at different times.",
                ),
              startIso: z
                .string()
                .describe(
                  "Option start in ISO 8601 with the user's LOCAL offset (from the system prompt), e.g. 2026-04-20T15:00:00-07:00. Do NOT use UTC ('...Z') unless the user is actually in UTC.",
                ),
              endIso: z
                .string()
                .describe(
                  "Option end (exclusive) in ISO 8601 with the user's local offset. Must be after startIso.",
                ),
              allDay: z
                .boolean()
                .optional()
                .describe(
                  "True for an all-day option. Default false. When true, start/end should be UTC midnights spanning the intended day(s).",
                ),
              description: z
                .string()
                .optional()
                .describe("Optional longer description / body."),
              location: z
                .string()
                .optional()
                .describe("Optional free-form location string."),
            }),
          )
          .min(1)
          .max(3)
=======
        "Create a PENDING event proposal for the user. Does NOT create the event directly. " +
        "The user will see a ghost card in their calendar and can Accept or Reject it. " +
        "Use this whenever the user asks to add, book, schedule, or block time for something. " +
        "Gather enough context first (e.g. get_user_schedule to check for conflicts) — do not call speculatively. " +
        "For timed events (allDay false or omitted), the server rejects proposals that overlap other timed events or sit within 15 minutes of another timed event's start/end on the user's calendar — and the same rules apply to each accepted friend listed in participantFriendUserIds (their enabled calendars), unless spacingValidationOverride is true — all-day events are ignored for this check. Use the override only when the user explicitly asked for back-to-back or overlapping placement. " +
        "If the call fails validation, the tool returns a message starting with FAILED — read that message (it explains overlap vs too-tight gap and what to change); do not blindly retry the same times.",
      schema: z.object({
        summary: z
          .string()
          .describe(
            "Calendar title visible to all attendees. Neutral activity when participantFriendUserIds is set (e.g. 'Lunch', 'Coffee'); solo events may be more specific (e.g. 'Dentist', 'Walk').",
          ),
        startIso: z
          .string()
>>>>>>> main
          .describe(
            "1–3 alternative time slots for the same event. Provide multiple when the user's ask is loose (e.g. 'dinner this week'); provide one when they specified an exact time.",
          ),
        calendarId: z
          .string()
          .optional()
          .describe(
<<<<<<< HEAD
            "Optional Convex calendar id for all options. Leave unset to use the user's default writable calendar.",
=======
            "Optional Convex calendar id. If set, wins over googleAccountEmail.",
          ),
        googleAccountEmail: z
          .string()
          .optional()
          .describe(
            "Connected Google account email; resolves like writableCalendarForUser with accountEmail (primary writable on that account). Omit with calendarId; if both omitted, uses default Google account (same as quick-create).",
>>>>>>> main
          ),
        spacingValidationOverride: z
          .boolean()
          .optional()
          .describe(
<<<<<<< HEAD
            "If true, skip server checks that block overlap and <15 min gaps vs existing events for every option. " +
              "Only set when the user explicitly asked for back-to-back or overlapping events. Default false.",
          ),
        timeOfDayOverride: z
          .boolean()
          .optional()
          .describe(
            "If true, skip the server check that confines meal/coffee/workout summaries to their normal hours " +
              "(e.g. dinner 6pm–9pm, coffee 8am–4pm). Only set when the user EXPLICITLY asked for an off-hours " +
              "version (\"dinner at 3pm\", \"midnight coffee\"). Default false — do not flip this on just because " +
              "the first time you picked was rejected.",
=======
            "If true, skip server checks that block overlap and <15 min gaps vs the user's and participants' existing timed events. " +
              "Only set when the user explicitly asked for back-to-back or overlapping events. Default false.",
          ),
        participantFriendUserIds: z
          .array(z.string())
          .optional()
          .describe(
            "Convex user ids of accepted friends to invite as Google Calendar attendees when the user accepts the proposal. " +
              "Use ids from find_friend (e.g. when scheduling with a named friend). Omit for solo events.",
>>>>>>> main
          ),
      }),
    },
  );
}
