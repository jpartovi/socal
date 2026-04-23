"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { ToolDeps } from "./deps";

export function findFriendTool(deps: ToolDeps): StructuredToolInterface {
  const { ctx, userId } = deps;
  return tool(
    async ({ name }) => {
      console.log("[agent-tool] find_friend call", { name });
      const connections = await ctx.runQuery(api.friendships.listConnections, {
        userId,
      });
      const needle = name.trim().toLowerCase();
      const candidates = connections.friends
        .map((f) => {
          const full = `${f.user.firstName} ${f.user.lastName}`.trim();
          return {
            userId: f.user._id,
            firstName: f.user.firstName,
            lastName: f.user.lastName,
            fullName: full,
            inviteEmail: f.user.inviteEmail,
          };
        })
        .filter((f) => {
          if (needle.length === 0) return true;
          return (
            f.firstName.toLowerCase().includes(needle) ||
            f.lastName.toLowerCase().includes(needle) ||
            f.fullName.toLowerCase().includes(needle)
          );
        });
      console.log("[agent-tool] find_friend result", {
        name,
        count: candidates.length,
        matches: candidates.map((c) => c.fullName),
      });
      if (candidates.length === 0) {
        return `No friend matched '${name}'. Ask the user to friend this person in the app first, or confirm the name.`;
      }
      return JSON.stringify(candidates);
    },
    {
      name: "find_friend",
      description:
        "Look up a friend of the user by name or partial name. Returns an array of candidates with userId, firstName, lastName, inviteEmail (their chosen Google address for calendar invites, or null). " +
        "Use this before get_friend_schedule to resolve the friend's userId. " +
        "If multiple candidates match, prefer the closest full-name match; if ambiguous, pick the most likely one and proceed — do not ask the user.",
      schema: z.object({
        name: z
          .string()
          .describe(
            "Name or partial name to search. Matches on first, last, or full name, case-insensitive.",
          ),
      }),
    },
  );
}
