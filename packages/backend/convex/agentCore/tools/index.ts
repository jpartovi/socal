"use node";

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolDeps } from "./deps";
import { finishAgentTool } from "./finishAgent";
import { getUserScheduleTool } from "./getUserSchedule";
import { proposeEventCreationTool } from "./proposeEventCreation";

export type { ToolDeps } from "./deps";

export function makeCalendarTools(deps: ToolDeps): StructuredToolInterface[] {
  return [
    getUserScheduleTool(deps),
    proposeEventCreationTool(deps),
    finishAgentTool(),
  ];
}
