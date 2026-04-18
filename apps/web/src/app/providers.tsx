"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

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
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
