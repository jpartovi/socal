"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useState, type KeyboardEvent } from "react";

import { useAuth } from "@/lib/auth";

// Calendar agent entrypoint at the bottom of the home page. Sends the typed
// message to api.agent.run. The agent only acts via tools; structured failure
// reasons come back on result.ok === false, while thrown errors are transport
// or server failures.
export function AgentInput() {
  const { userId } = useAuth();
  const runAgent = useAction(api.agent.run);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async () => {
    const text = value.trim();
    if (!text || !userId || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await runAgent({ userId, message: text });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      {error !== null && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
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
