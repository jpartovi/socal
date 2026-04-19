"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

import { AuthProvider } from "@/lib/auth";
import { UndoProvider } from "@/lib/undo";

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      // During first-time setup, NEXT_PUBLIC_CONVEX_URL may not yet be set.
      // Run `pnpm -F @socal/backend convex dev` to create a deployment.
      return null;
    }
    return new ConvexReactClient(url);
  }, []);

  if (!client) {
    return <AuthProvider>{children}</AuthProvider>;
  }

  return (
    <ConvexProvider client={client}>
      <AuthProvider>
        <UndoProvider>{children}</UndoProvider>
      </AuthProvider>
    </ConvexProvider>
  );
}
