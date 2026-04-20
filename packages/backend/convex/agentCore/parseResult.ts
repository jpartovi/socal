import type { BaseMessage } from "@langchain/core/messages";
import { isToolMessage } from "@langchain/core/messages";

export type AgentRunResult =
  | { status: "completed" }
  | { status: "no_action"; message?: string }
  | { status: "error"; reason: string };

const INCOMPLETE: AgentRunResult = {
  status: "error",
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

function parseFinishPayload(raw: string): AgentRunResult | null {
  const parsed = JSON.parse(raw) as {
    status?: string;
    message?: string;
    reason?: string;
    outcome?: string;
  };

  if (parsed.status === "completed") {
    return { status: "completed" };
  }
  if (parsed.status === "no_action") {
    const message = parsed.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return { status: "no_action", message: message.trim() };
    }
    return { status: "no_action" };
  }
  if (parsed.status === "error" && typeof parsed.reason === "string") {
    return { status: "error", reason: parsed.reason };
  }

  // Legacy finish_agent payloads (outcome success | failure)
  if (parsed.outcome === "success") {
    return { status: "completed" };
  }
  if (parsed.outcome === "failure" && typeof parsed.reason === "string") {
    return { status: "error", reason: parsed.reason };
  }

  return null;
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
      const result = parseFinishPayload(raw);
      if (result !== null) return result;
    } catch {
      return { status: "error", reason: "Invalid finish_agent result" };
    }
    return { status: "error", reason: "Invalid finish_agent result" };
  }
  return INCOMPLETE;
}
