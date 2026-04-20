"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

// Single z.object so OpenAI tool JSON schema is type: "object" (z.union breaks conversion).
const finishAgentSchema = z.object({
  status: z
    .enum(["completed", "no_action", "error"])
    .describe(
      "completed: you handled a calendar/scheduling request (e.g. emitted a proposal). " +
        "no_action: the message was not a calendar request (greeting, thanks, chit-chat). " +
        "error: you could not complete a calendar request — must include reason.",
    ),
  reason: z
    .string()
    .optional()
    .describe("Required when status is error: short user-visible explanation."),
  message: z
    .string()
    .optional()
    .describe(
      "Optional when status is no_action: one short line shown in the UI (e.g. what would help next). Omit if nothing useful to say.",
    ),
});

export function finishAgentTool(): StructuredToolInterface {
  return tool(
    (args) => {
      const parsed = finishAgentSchema.parse(args);
      if (parsed.status === "error") {
        const reason = parsed.reason?.trim();
        return JSON.stringify({
          status: "error" as const,
          reason: reason && reason.length > 0 ? reason : "Unknown error",
        });
      }
      if (parsed.status === "no_action") {
        const message = parsed.message?.trim();
        return JSON.stringify({
          status: "no_action" as const,
          ...(message && message.length > 0 ? { message } : {}),
        });
      }
      return JSON.stringify({ status: "completed" as const });
    },
    {
      name: "finish_agent",
      description:
        "Call exactly once at the end of every run. The API response is derived from this tool, not from assistant text. " +
        "Use status completed when you fully handled a scheduling request (including after propose_event_creation). " +
        "Use status no_action for greetings, thanks, or anything that is not asking to put time on the calendar (optional message for the user). " +
        "Use status error with reason when a calendar request could not be fulfilled (e.g. no free slot, invalid time, tool validation failure you cannot fix). " +
        "Do not skip this tool.",
      schema: finishAgentSchema,
    },
  );
}
