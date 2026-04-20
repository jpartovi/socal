"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useState, type KeyboardEvent } from "react";

import { useAuth } from "@/lib/auth";

type AgentFeedback =
  | { status: "completed" }
  | { status: "no_action"; message?: string }
  | { status: "error"; reason: string };

// Calendar agent entrypoint at the bottom of the home page. Sends the typed
// message to api.agent.run. The agent only acts via tools; assistant plain
// text is not shown — only calendar proposals and these status banners.
export function AgentInput() {
  const { userId } = useAuth();
  const runAgent = useAction(api.agent.run);
  const [value, setValue] = useState("");
  const [agentFeedback, setAgentFeedback] = useState<AgentFeedback | null>(
    null,
  );
  /** Thrown errors (network, Convex, unexpected). */
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!agentFeedback || agentFeedback.status === "error") return;
    const t = window.setTimeout(() => setAgentFeedback(null), 8000);
    return () => window.clearTimeout(t);
  }, [agentFeedback]);

  const handleSubmit = async () => {
    const text = value.trim();
    if (!text || !userId || isPending) return;
    setIsPending(true);
    setAgentFeedback(null);
    setSubmitError(null);
    try {
      const result = await runAgent({ userId, message: text });
      if (result.status === "error") {
        setAgentFeedback({ status: "error", reason: result.reason });
        return;
      }
      setValue("");
      if (result.status === "no_action") {
        setAgentFeedback({
          status: "no_action",
          ...(result.message !== undefined ? { message: result.message } : {}),
        });
        return;
      }
      setAgentFeedback({ status: "completed" });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const canSubmit = value.trim().length > 0 && !isPending && !!userId;

  return (
    <div className="flex flex-col gap-2">
      {agentFeedback?.status === "completed" && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-600/25 bg-emerald-600/6 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/8 dark:text-emerald-50"
        >
          <p className="font-medium text-emerald-900 dark:text-emerald-50">
            Scheduled
          </p>
          <p className="mt-1 text-emerald-900/85 dark:text-emerald-100/80">
            If you asked for a new event, look for a proposed block on the
            calendar to accept or edit.
          </p>
        </div>
      )}
      {agentFeedback?.status === "no_action" && (
        <div
          role="status"
          className="rounded-2xl border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-sm"
        >
          <p className="font-medium text-foreground">Nothing to add</p>
          <p className="mt-1 text-muted-foreground">
            {agentFeedback.message ??
              "This assistant only schedules calendar events—describe a time or activity to get a proposal."}
          </p>
        </div>
      )}
      {agentFeedback?.status === "error" && (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/8 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
        >
          <p className="font-medium text-amber-900 dark:text-amber-50">
            Couldn&apos;t complete that request
          </p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-100/85">
            {agentFeedback.reason}
          </p>
        </div>
      )}
      {submitError !== null && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {submitError}
        </div>
      )}
      <div className="flex h-10 items-center gap-2 rounded-full border bg-background px-4 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isPending ? "Thinking…" : "Make some plans"}
          disabled={isPending}
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          aria-label="Ask calendar agent"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition disabled:opacity-40 hover:bg-primary/90"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 13V3" />
            <path d="M4 7l4-4 4 4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
