import type { BaseMessage } from "@langchain/core/messages";
import { isToolMessage } from "@langchain/core/messages";

export type AgentRunResult = { ok: true } | { ok: false; reason: string };

const INCOMPLETE: AgentRunResult = {
  ok: false,
  reason: "Agent did not complete",
};

function contentToString(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Reads the last finish_agent tool result from the LangGraph message list.
 */
export function parseFinishAgentFromMessages(
  messages: BaseMessage[],
): AgentRunResult {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isToolMessage(m) || m.name !== "finish_agent") continue;
    const raw = contentToString(m.content);
    try {
      const parsed = JSON.parse(raw) as {
        outcome?: string;
        reason?: string;
      };
      if (parsed.outcome === "success") return { ok: true };
      if (parsed.outcome === "failure" && typeof parsed.reason === "string") {
        return { ok: false, reason: parsed.reason };
      }
    } catch {
      return { ok: false, reason: "Invalid finish_agent result" };
    }
    return { ok: false, reason: "Invalid finish_agent result" };
  }
  return INCOMPLETE;
}
