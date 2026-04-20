"use node";

import { ChatOpenAI } from "@langchain/openai";

/**
 * Calendar agent LLM. Model and optional reasoning-related kwargs come from env
 * so you can swap in reasoning-capable models without code changes.
 *
 * - CALENDAR_AGENT_MODEL (default: gpt-4o-mini)
 * - CALENDAR_AGENT_REASONING_EFFORT (optional; passed through modelKwargs for OpenAI o-series-style APIs)
 */
export function createAgentLlm(): ChatOpenAI {
  const model = process.env.CALENDAR_AGENT_MODEL ?? "gpt-4o-mini";
  const reasoningEffort = process.env.CALENDAR_AGENT_REASONING_EFFORT;
  const modelKwargs =
    reasoningEffort !== undefined && reasoningEffort !== ""
      ? { reasoning_effort: reasoningEffort }
      : undefined;

  return new ChatOpenAI({
    model,
    temperature: 0,
    ...(modelKwargs ? { modelKwargs } : {}),
  });
}
