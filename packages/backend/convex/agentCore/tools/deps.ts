import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";

// Scratch state tools write to as side effects. Lets the caller recover a
// useful status even when the LangGraph run blows the recursion limit
// before the agent can call finish_agent.
export type RunState = {
  proposalIds: Id<"eventProposals">[];
};

export function createRunState(): RunState {
  return { proposalIds: [] };
}

export type ToolDeps = {
  ctx: ActionCtx;
  userId: Id<"users">;
  /** IANA timezone for ISO strings shown to the model in tool results. */
  userTimeZone?: string;
  runState: RunState;
};
