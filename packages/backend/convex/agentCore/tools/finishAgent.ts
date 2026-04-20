"use node";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

// Single z.object so OpenAI tool JSON schema is type: "object" (z.union breaks conversion).
const finishAgentSchema = z.object({
  outcome: z
    .enum(["success", "failure"])
    .describe("success if the user request was handled; failure if it could not be completed."),
  reason: z
    .string()
    .optional()
    .describe(
      "Required when outcome is failure: short user-visible explanation. Omit for success.",
    ),
});

export function finishAgentTool(): StructuredToolInterface {
  return tool(
    (args) => {
      const parsed = finishAgentSchema.parse(args);
      if (parsed.outcome === "failure") {
        const reason = parsed.reason?.trim();
        return JSON.stringify({
          outcome: "failure" as const,
          reason: reason && reason.length > 0 ? reason : "Unknown failure",
        });
      }
      return JSON.stringify({ outcome: "success" as const });
    },
    {
      name: "finish_agent",
      description:
        "Call exactly once at the end of every run. Reports whether the task succeeded or failed from the agent's perspective. " +
        "On success, use outcome success (omit reason). On failure (e.g. could not find a free time, invalid request), use outcome failure with a short reason the user can read. " +
        "Do not skip this tool — the API response is derived from it, not from assistant text.",
      schema: finishAgentSchema,
    },
  );
}
