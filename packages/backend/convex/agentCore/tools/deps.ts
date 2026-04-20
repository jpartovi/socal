import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";

export type ToolDeps = {
  ctx: ActionCtx;
  userId: Id<"users">;
  /** IANA timezone for ISO strings shown to the model in tool results. */
  userTimeZone?: string;
};
