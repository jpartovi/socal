"use node";

// Public Convex module: `api.agent.run`. Implementation lives in ./agentCore/.

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { invokeCalendarAgent } from "./agentCore/invoke.js";
import { createAgentLlm } from "./agentCore/llm.js";
import { parseFinishAgentFromMessages } from "./agentCore/parseResult.js";
import { buildSystemPrompt } from "./agentCore/prompts/build.js";
import { createRunState } from "./agentCore/tools/deps.js";
import { makeCalendarTools } from "./agentCore/tools/index.js";

const agentRunResult = v.union(
  v.object({
    status: v.literal("completed"),
    proposalIds: v.array(v.id("eventProposals")),
  }),
  v.object({
    status: v.literal("no_action"),
    message: v.optional(v.string()),
  }),
  v.object({ status: v.literal("error"), reason: v.string() }),
);

export const run = action({
  args: {
    userId: v.id("users"),
    message: v.string(),
    taggedFriends: v.optional(
      v.array(
        v.object({
          name: v.string(),
          userId: v.id("users"),
        }),
      ),
    ),
  },
  returns: agentRunResult,
  handler: async (ctx, { userId, message, taggedFriends }) => {
    const user = await ctx.runQuery(api.users.getById, { userId });

    const llm = createAgentLlm();
    const runState = createRunState();
    const tools = makeCalendarTools({
      ctx,
      userId,
      userTimeZone: user?.timeZone,
      runState,
    });

    const systemPrompt = buildSystemPrompt({
      nowIso: new Date().toISOString(),
      userFirstName: user?.firstName,
      userTimeZone: user?.timeZone,
      ...(taggedFriends !== undefined
        ? {
            taggedFriends: taggedFriends.map((f) => ({
              name: f.name,
              userId: f.userId as string,
            })),
          }
        : {}),
    });

    try {
      const result = await invokeCalendarAgent({
        llm,
        tools,
        systemPrompt,
        userMessage: message,
        recursionLimit: 40,
      });
      const parsed = parseFinishAgentFromMessages(result.messages);
      if (parsed.status === "completed") {
        return {
          status: "completed" as const,
          proposalIds: runState.proposalIds,
        };
      }
      return parsed;
    } catch (err) {
      // LangGraph throws GraphRecursionError when the step limit is hit
      // before the agent calls finish_agent. If the run already produced
      // a proposal the ghost card is live in the DB, so report completed.
      const name = err instanceof Error ? err.name : "";
      const isRecursion = name === "GraphRecursionError";
      if (isRecursion && runState.proposalIds.length > 0) {
        console.warn(
          "[agent] recursion limit hit, but a proposal was created — returning completed",
          { proposalIds: runState.proposalIds },
        );
        return {
          status: "completed" as const,
          proposalIds: runState.proposalIds,
        };
      }
      if (isRecursion) {
        return {
          status: "error" as const,
          reason: "Agent ran too long without finishing. Try rephrasing.",
        };
      }
      throw err;
    }
  },
});
