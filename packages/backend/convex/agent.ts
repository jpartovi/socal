"use node";

// Public Convex module: `api.agent.run`. Implementation lives in ./agentCore/.

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { invokeCalendarAgent } from "./agentCore/invoke.js";
import { createAgentLlm } from "./agentCore/llm.js";
import { parseFinishAgentFromMessages } from "./agentCore/parseResult.js";
import { buildSystemPrompt } from "./agentCore/prompts/build.js";
import { makeCalendarTools } from "./agentCore/tools/index.js";

const agentRunResult = v.union(
  v.object({ status: v.literal("completed") }),
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
  },
  returns: agentRunResult,
  handler: async (ctx, { userId, message }) => {
    const user = await ctx.runQuery(api.users.getById, { userId });

    const llm = createAgentLlm();
    const tools = makeCalendarTools({
      ctx,
      userId,
      userTimeZone: user?.timeZone,
    });

    const systemPrompt = buildSystemPrompt({
      nowIso: new Date().toISOString(),
      userFirstName: user?.firstName,
      userTimeZone: user?.timeZone,
    });

    const result = await invokeCalendarAgent({
      llm,
      tools,
      systemPrompt,
      userMessage: message,
      recursionLimit: 24,
    });

    return parseFinishAgentFromMessages(result.messages);
  },
});
