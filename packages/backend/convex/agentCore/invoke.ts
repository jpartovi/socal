"use node";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

export async function invokeCalendarAgent(opts: {
  llm: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  userMessage: string;
  recursionLimit?: number;
}) {
  const agent = createReactAgent({
    llm: opts.llm,
    tools: opts.tools,
  });
  return agent.invoke(
    {
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userMessage },
      ],
    },
    { recursionLimit: opts.recursionLimit ?? 20 },
  );
}
