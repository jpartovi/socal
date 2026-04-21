"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { isoInZone, localDateOnlyInZone } from "../../timezone";
import type { ToolDeps } from "./deps";

export function getFriendScheduleTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId, userTimeZone } = deps;
  return tool(
    async ({ friendUserId, startIso, endIso }) => {
      console.log("[agent-tool] get_friend_schedule call", {
        friendUserId,
        startIso,
        endIso,
      });
      const start = Date.parse(startIso);
      const end = Date.parse(endIso);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new Error("startIso/endIso must be valid ISO 8601 timestamps");
      }
      if (end <= start) {
        throw new Error("endIso must be strictly after startIso");
      }
      const ownerId = friendUserId as Id<"users">;
      const allowed = await ctx.runQuery(api.friendships.areFriends, {
        viewerId: userId,
        ownerId,
      });
      if (!allowed) {
        console.log("[agent-tool] get_friend_schedule denied", {
          friendUserId,
        });
        return (
          `FAILED — get_friend_schedule: this user is not an accepted friend. ` +
          `Ask the user to send them a friend request first.`
        );
      }
      const rows = await ctx.runQuery(api.events.listForUserInRange, {
        userId: ownerId,
        start,
        end,
      });
      console.log("[agent-tool] get_friend_schedule result", {
        friendUserId,
        count: rows.length,
        events: rows.map(({ event }) => {
          if (event.allDay) {
            const startDate = localDateOnlyInZone(event.start, userTimeZone);
            const endDate = localDateOnlyInZone(event.end - 1, userTimeZone);
            return `${startDate}–${endDate} (all day) ${event.summary ?? "(untitled)"}`;
          }
          return `${isoInZone(event.start, userTimeZone)} – ${isoInZone(event.end, userTimeZone)} ${event.summary ?? "(untitled)"}`;
        }),
      });
      // Project just the fields the agent needs for skippability reasoning.
      // Keep summary/location visible so the LLM can judge "ML study" as
      // likely-skippable vs "Doctor appt" as hard. Emails/attendees are
      // omitted to keep the payload tight and avoid leaking contacts.
      const projected = rows.map(({ event }) => {
        if (event.allDay) {
          return {
            summary: event.summary,
            allDay: true as const,
            startDate: localDateOnlyInZone(event.start, userTimeZone),
            endDate: localDateOnlyInZone(event.end - 1, userTimeZone),
            location: event.location,
          };
        }
        return {
          summary: event.summary,
          allDay: false as const,
          start: isoInZone(event.start, userTimeZone),
          end: isoInZone(event.end, userTimeZone),
          location: event.location,
        };
      });
      return JSON.stringify(projected);
    },
    {
      name: "get_friend_schedule",
      description:
        "Return events on a friend's calendar overlapping [startIso, endIso), in the USER'S local timezone. " +
        "Call find_friend first to get the friend's userId. " +
        "Returns events only if the friend is an accepted friend of the user (friendship implies mutual calendar visibility); otherwise returns a message starting with 'FAILED'. " +
        "Use this together with get_user_schedule when the user wants to schedule with a friend — you need both schedules to find a mutually-free slot. " +
        "Same ISO format rules as get_user_schedule: use the user's local offset from the system prompt.",
      schema: z.object({
        friendUserId: z
          .string()
          .describe("Convex id of the friend, from find_friend."),
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
