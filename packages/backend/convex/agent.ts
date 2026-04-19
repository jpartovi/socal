"use node";

// The calendar agent's Convex action. Kept deliberately thin: tool definitions
// live in ./agentTools, prompt assembly lives in ./agentPrompts.
//
// Multi-step tool use is the default — createReactAgent runs a loop of
// LLM → tool(s) → LLM → tool(s) → ... → final. Parallel tool calls inside a
// single assistant turn are supported out of the box. `recursionLimit` caps
// the loop so a confused model can't burn the action's timeout.

import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { buildSystemPrompt } from "./agentPrompts";
import { makeCalendarTools } from "./agentTools";

export const run = action({
  args: {
    userId: v.id("users"),
    message: v.string(),
  },
  returns: v.string(),
  // Explicit Promise<string> return type avoids TS7022/7023 in strict mode:
  // the `action()` wrapper's inferred type otherwise circles through the
  // self-referential Convex `api` and gives up to `any`.
  handler: async (ctx, { userId, message }): Promise<string> => {
    const agent = createReactAgent({
      llm: new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 }),
      tools: makeCalendarTools({ ctx, userId }),
    });

    // Fetch user context so the prompt can say "helping <first name>" and,
    // critically, resolve relative phrases like "tomorrow" in the user's
    // own time zone rather than UTC.
    const user = await ctx.runQuery(api.users.getById, { userId });

    const systemPrompt = buildSystemPrompt({
      nowIso: new Date().toISOString(),
      userFirstName: user?.firstName,
      userTimeZone: user?.timeZone,
    });

    const result = await agent.invoke(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
      },
      { recursionLimit: 10 },
    );

    const last = result.messages[result.messages.length - 1];
    if (typeof last.content === "string") return last.content;
    // Anthropic-style content blocks or tool-call artifacts: fall back to a
    // serialized form rather than dropping the reply.
    return JSON.stringify(last.content);
  },
});
