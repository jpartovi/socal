import type { FunctionReturnType } from "convex/server";
import type { api } from "@socal/backend/convex/_generated/api";

export type EventRow = FunctionReturnType<
  typeof api.events.listForUserInRange
>[number];
