"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !userId) {
      router.replace("/login");
    }
  }, [isReady, userId, router]);

  if (!isReady || !userId) {
    return null;
  }

  return <>{children}</>;
}
