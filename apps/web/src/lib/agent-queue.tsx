"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/lib/auth";

export type QueuedTaskStatus =
  | "queued"
  | "running"
  | "done"
  | "no_action"
  | "failed";

export type QueuedTask = {
  id: string;
  message: string;
  taggedFriends?: Array<{ name: string; userId: Id<"users"> }>;
  status: QueuedTaskStatus;
  createdAt: number;
  proposalIds?: Id<"eventProposals">[];
  noActionMessage?: string;
  error?: string;
};

type EnqueueInput = {
  message: string;
  taggedFriends?: Array<{ name: string; userId: Id<"users"> }>;
};

type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "full" | "no_user" };

type AgentQueueContextValue = {
  tasks: QueuedTask[];
  capacity: number;
  activeCount: number;
  enqueue: (input: EnqueueInput) => EnqueueResult;
  dismiss: (id: string) => void;
};

const CAPACITY = 3;

const AgentQueueContext = createContext<AgentQueueContextValue | null>(null);

export function AgentQueueProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const runAgent = useAction(api.agent.run);
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  // Guard against StrictMode's double-fire by tracking which task ids we've
  // already kicked off. Effects below read-check this before scheduling work.
  const startedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    if (tasks.some((t) => t.status === "running")) return;
    const next = tasks.find(
      (t) => t.status === "queued" && !startedIdsRef.current.has(t.id),
    );
    if (!next) return;

    startedIdsRef.current.add(next.id);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === next.id ? { ...t, status: "running" as const } : t,
      ),
    );

    void (async () => {
      try {
        const result = await runAgent({
          userId,
          message: next.message,
          ...(next.taggedFriends
            ? { taggedFriends: next.taggedFriends }
            : {}),
        });
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== next.id) return t;
            if (result.status === "completed") {
              return {
                ...t,
                status: "done" as const,
                proposalIds: result.proposalIds,
              };
            }
            if (result.status === "no_action") {
              return {
                ...t,
                status: "no_action" as const,
                ...(result.message !== undefined
                  ? { noActionMessage: result.message }
                  : {}),
              };
            }
            return { ...t, status: "failed" as const, error: result.reason };
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === next.id
              ? { ...t, status: "failed" as const, error: msg }
              : t,
          ),
        );
      }
    })();
  }, [tasks, userId, runAgent]);

  const enqueue = useCallback<AgentQueueContextValue["enqueue"]>(
    (input) => {
      if (!userId) return { ok: false, reason: "no_user" };
      let result: EnqueueResult = { ok: false, reason: "full" };
      setTasks((prev) => {
        const active = prev.filter(
          (t) => t.status === "queued" || t.status === "running",
        );
        if (active.length >= CAPACITY) {
          result = { ok: false, reason: "full" };
          return prev;
        }
        const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        result = { ok: true, id };
        const task: QueuedTask = {
          id,
          message: input.message,
          ...(input.taggedFriends ? { taggedFriends: input.taggedFriends } : {}),
          status: "queued",
          createdAt: Date.now(),
        };
        return [...prev, task];
      });
      return result;
    },
    [userId],
  );

  const dismiss = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const activeCount = useMemo(
    () =>
      tasks.filter((t) => t.status === "queued" || t.status === "running")
        .length,
    [tasks],
  );

  const value = useMemo<AgentQueueContextValue>(
    () => ({
      tasks,
      capacity: CAPACITY,
      activeCount,
      enqueue,
      dismiss,
    }),
    [tasks, activeCount, enqueue, dismiss],
  );

  return (
    <AgentQueueContext.Provider value={value}>
      {children}
    </AgentQueueContext.Provider>
  );
}

export function useAgentQueue(): AgentQueueContextValue {
  const ctx = useContext(AgentQueueContext);
  if (!ctx) {
    throw new Error("useAgentQueue must be used within AgentQueueProvider");
  }
  return ctx;
}
