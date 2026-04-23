"use client";

import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { createContext, useContext, type ReactNode } from "react";

const HighlightContext = createContext<Set<Id<"eventProposals">>>(new Set());

export function HighlightProvider({
  ids,
  children,
}: {
  ids: Set<Id<"eventProposals">>;
  children: ReactNode;
}) {
  return (
    <HighlightContext.Provider value={ids}>
      {children}
    </HighlightContext.Provider>
  );
}

export function useIsProposalHighlighted(id: Id<"eventProposals">): boolean {
  return useContext(HighlightContext).has(id);
}
