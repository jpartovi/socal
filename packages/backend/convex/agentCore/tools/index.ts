"use node";

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolDeps } from "./deps";
import { findFriendTool } from "./findFriend";
import { finishAgentTool } from "./finishAgent";
import { getFreeSlotsTool } from "./getFreeSlots";
import { getFriendScheduleTool } from "./getFriendSchedule";
import { getUserScheduleTool } from "./getUserSchedule";
import { proposeEventCreationTool } from "./proposeEventCreation";

export type { ToolDeps } from "./deps";

export function makeCalendarTools(deps: ToolDeps): StructuredToolInterface[] {
  return [
    getUserScheduleTool(deps),
    getFreeSlotsTool(deps),
    findFriendTool(deps),
    getFriendScheduleTool(deps),
    proposeEventCreationTool(deps),
    finishAgentTool(),
  ];
}
