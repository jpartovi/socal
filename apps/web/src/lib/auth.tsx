"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Id } from "@socal/backend/convex/_generated/dataModel";

const STORAGE_KEY = "socal.userId";

type AuthContextValue = {
  userId: Id<"users"> | null;
  isReady: boolean;
  signIn: (userId: Id<"users">) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<Id<"users"> | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setUserId(stored as Id<"users">);
      }
    } finally {
      setIsReady(true);
    }
  }, []);

  const signIn = useCallback((id: Id<"users">) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setUserId(id);
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUserId(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ userId, isReady, signIn, signOut }),
    [userId, isReady, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }
  return ctx;
}
