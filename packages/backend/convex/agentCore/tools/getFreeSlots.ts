"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { isoInZone } from "../../timezone";
import { computeGroupFreeSlots } from "../freeSlotsMath";
import type { ToolDeps } from "./deps";

const DEFAULT_SLOT_DURATION_MINUTES = 60;
const DEFAULT_PADDING_MINUTES = 10;

export function getFreeSlotsTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId, userTimeZone } = deps;
  return tool(
    async (args) => {
      const slotDurationMinutes =
        args.slotDurationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES;
      const paddingMinutes = args.paddingMinutes ?? DEFAULT_PADDING_MINUTES;
      const friendUserIds = [
        ...new Set(
          (args.friendUserIds ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
        ),
      ] as Id<"users">[];

      console.log("[agent-tool] get_free_slots call", {
        startIso: args.startIso,
        endIso: args.endIso,
        friendUserIds: friendUserIds,
        slotDurationMinutes,
        paddingMinutes,
      });

      const start = Date.parse(args.startIso);
      const end = Date.parse(args.endIso);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error("startIso/endIso must be valid ISO 8601 timestamps");
      }
      if (end <= start) {
        throw new Error("endIso must be strictly after startIso");
      }
      if (!Number.isFinite(slotDurationMinutes) || slotDurationMinutes <= 0) {
        throw new Error("slotDurationMinutes must be a positive number");
      }
      if (!Number.isFinite(paddingMinutes) || paddingMinutes < 0) {
        throw new Error("paddingMinutes must be a non-negative number");
      }

      const now = Date.now();
      const effectiveStart = Math.max(start, now);
      const clampedStartToNow = start < now;

      const minSlotDurationMs = slotDurationMinutes * 60_000;
      const paddingMs = paddingMinutes * 60_000;

      if (end <= effectiveStart) {
        return JSON.stringify({
          freeSlots: [] as { startIso: string; endIso: string }[],
          window: {
            startIso: isoInZone(effectiveStart, userTimeZone),
            endIso: isoInZone(end, userTimeZone),
          },
          slotDurationMinutes,
          paddingMinutes,
          clampedStartToNow,
          note:
            "No future window: endIso is not after the effective start (use end of day, end of week, or any time strictly after now). " +
            "For prospective events, search [now, EOD) or [now, EOW) from the system prompt. " +
            "Timed meetings only: all-day entries are ignored. " +
            "Use get_user_schedule / get_friend_schedule for all-day context.",
        });
      }

      const friendChecks = await Promise.all(
        friendUserIds.map((ownerId) =>
          ctx
            .runQuery(api.friendships.areFriends, { viewerId: userId, ownerId })
            .then((ok) => ({ ownerId, ok })),
        ),
      );
      const notFriends = friendChecks.filter((c) => !c.ok);
      if (notFriends.length > 0) {
        const labels = await Promise.all(
          notFriends.map((c) =>
            ctx
              .runQuery(api.users.getById, { userId: c.ownerId })
              .then(
                (u) =>
                  (u
                    ? `${u.firstName} ${u.lastName}`.trim() || "Friend"
                    : c.ownerId) as string,
              ),
          ),
        );
        console.log("[agent-tool] get_free_slots denied", { labels });
        return (
          `FAILED — get_free_slots: not accepted friends: ${labels.join(", ")}. ` +
          `Ask the user to connect as friends in the app first.`
        );
      }

      // Query from original `start` so past events (with padding) are not missed;
      // free intervals are only computed for [effectiveStart, end).
      const scheduleQueries = [userId, ...friendUserIds].map((uid) =>
        ctx.runQuery(api.events.listForUserInRange, { userId: uid, start, end }),
      );
      const scheduleRows = await Promise.all(scheduleQueries);

      const schedules = scheduleRows.map((rows) =>
        rows.map((r) => ({
          start: r.event.start,
          end: r.event.end,
          allDay: r.event.allDay,
        })),
      );

      const freeMs = computeGroupFreeSlots(
        schedules,
        effectiveStart,
        end,
        paddingMs,
        minSlotDurationMs,
      );

      const out = {
        freeSlots: freeMs.map((iv) => ({
          startIso: isoInZone(iv.start, userTimeZone),
          endIso: isoInZone(iv.end, userTimeZone),
        })),
        window: {
          startIso: isoInZone(effectiveStart, userTimeZone),
          endIso: isoInZone(end, userTimeZone),
        },
        slotDurationMinutes,
        paddingMinutes,
        clampedStartToNow,
        note:
          (clampedStartToNow
            ? "searchWindowStart was before now; only slots from the current time forward are returned. For prospective events, use startIso = now (from the system prompt) through end of day or end of week. "
            : "") +
          "Timed meetings only: all-day entries are ignored (same as proposal spacing). " +
          "If the user needs all-day context, call get_user_schedule / get_friend_schedule.",
      };

      console.log("[agent-tool] get_free_slots result", {
        count: out.freeSlots.length,
        slotDurationMinutes: out.slotDurationMinutes,
        paddingMinutes: out.paddingMinutes,
      });

      return JSON.stringify(out);
    },
    {
      name: "get_free_slots",
      description:
        "Find when the user AND everyone in friendUserIds are all free in [startIso, endIso) at once, using synced Google calendars. " +
        "For NEW events, search only the future: use startIso = now (from the system prompt) and endIso = end of day or end of week as appropriate, not a range that is mostly in the past; if startIso is earlier than the server 'now', results are computed from 'now' forward only. " +
        "Pass Convex user ids from find_friend. Prefer a wide time range: e.g. now through EOD or now through EOW (wider when matching more people), unless the user specified a tight window. " +
        "Returns JSON with freeSlots (each at least slotDurationMinutes long), " +
        "default slotDurationMinutes 60 and paddingMinutes 10 (buffer before/after every timed busy block; propose_event_creation still enforces a 15 min gap separately). " +
        "All-day events are ignored for this tool; use get_user_schedule or get_friend_schedule if the user needs all-day context. " +
        "Safe to call in parallel with other read-only tools. " +
        "If any id is not an accepted friend, returns text starting with FAILED — with the reason.",
      schema: z.object({
        startIso: z
          .string()
          .describe(
            "Inclusive window start, ISO 8601 with the user's local offset. For scheduling NEW events, use the current time from the system prompt (not midnight) through end of day or end of week so you only search the future. If you pass a past start, the tool uses 'now' as the effective start.",
          ),
        endIso: z
          .string()
          .describe(
            "Exclusive window end, ISO 8601 with the user's local offset. Typical: end of today (EOD) or end of this week (EOW) for prospective events; more friends often warrants a longer forward span.",
          ),
        friendUserIds: z
          .array(z.string())
          .optional()
          .describe(
            "Convex user ids of friends to include; from find_friend. Omit or use [] for the user's own free time only.",
          ),
        slotDurationMinutes: z
          .number()
          .positive()
          .optional()
          .describe(
            "Minimum length of each returned free block in minutes. Default 60.",
          ),
        paddingMinutes: z
          .number()
          .nonnegative()
          .optional()
          .describe(
            "Symmetric minutes of buffer before and after each timed busy event. Default 10 (use 15 to match propose_event_creation gap rules more closely).",
          ),
      }),
    },
  );
}
