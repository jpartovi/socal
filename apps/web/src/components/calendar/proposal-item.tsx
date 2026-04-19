"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";

import { formatTimeRange } from "@/components/calendar/lib";
import type { ProposalRow } from "@/components/calendar/types";
import { useAuth } from "@/lib/auth";

// Ghost/dashed-border card used wherever a calendar view renders a list of
// events. Visually distinct from real event cards (dashed outline, reduced
// opacity, a "Proposed" label) so the user reads it as "pending, awaiting
// approval, not yet on my calendar".
//
// Keeps its own pending flags for accept/reject so double-clicks / network
// blips don't send duplicate mutations. The row disappears from the UI once
// the Convex live query re-queries (status flips to accepted/rejected and the
// server-side filter excludes it).
export function ProposalItem({
  row,
  variant = "agenda",
}: {
  row: ProposalRow;
  variant?: "agenda" | "day" | "month";
}) {
  const { userId } = useAuth();
  const accept = useAction(api.proposals.accept);
  const reject = useMutation(api.proposals.reject);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { proposal, calendar } = row;
  const color = calendar.backgroundColor;

  async function onAccept() {
    if (!userId || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await accept({ userId, proposalId: proposal._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsPending(false);
    }
    // On success we leave isPending=true — the row is about to disappear
    // from the live query; re-enabling the buttons would just flash.
  }

  async function onReject() {
    if (!userId || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await reject({ userId, proposalId: proposal._id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsPending(false);
    }
  }

  const timeLabel = proposal.allDay
    ? "All day"
    : formatTimeRange(proposal.start, proposal.end);

  // Month pills are extremely small — skip the action buttons there and just
  // show a dashed chip; the user can accept/reject from day/agenda views.
  if (variant === "month") {
    return (
      <span
        title={`Proposed: ${proposal.summary}`}
        className="flex items-center gap-1 truncate rounded border border-dashed bg-background/60 px-1 text-[10px] leading-tight opacity-80"
        style={{ borderColor: color, color }}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full border border-dashed"
          style={{ borderColor: color }}
        />
        <span className="truncate">{proposal.summary}</span>
      </span>
    );
  }

  // Day view: compact ghost block. Parent positions it absolutely within the
  // day column; we fill the given area. Accept/Reject are rendered inline so
  // the user can act without opening a popover.
  if (variant === "day") {
    return (
      <div
        className="flex h-full w-full flex-col justify-between overflow-hidden rounded border border-dashed bg-background/70 px-1 py-0.5 text-[11px] leading-tight"
        style={{ borderColor: color, color }}
        title={`Proposed: ${proposal.summary} · ${timeLabel}`}
      >
        <div className="min-w-0">
          <div className="truncate font-medium">{proposal.summary}</div>
          <div className="truncate opacity-80">{timeLabel}</div>
        </div>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onReject}
            disabled={isPending}
            className="rounded border border-dashed px-1 text-[10px] uppercase tracking-wider hover:bg-muted/50 disabled:opacity-50"
            style={{ borderColor: color }}
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isPending}
            className="rounded px-1 text-[10px] uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: color }}
          >
            Accept
          </button>
        </div>
        {error !== null && (
          <span className="truncate text-[10px] text-destructive">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-dashed bg-background/70 px-3 py-2 text-sm opacity-90"
      style={{ borderColor: color }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-dashed"
            style={{ borderColor: color }}
          />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{proposal.summary}</span>
              <span
                className="shrink-0 rounded-full border border-dashed px-1.5 py-px text-[10px] uppercase tracking-wider"
                style={{ borderColor: color, color }}
              >
                Proposed
              </span>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {timeLabel}
              {proposal.location ? ` · ${proposal.location}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onReject}
            disabled={isPending}
            className="rounded-lg border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={isPending}
            className="rounded-lg bg-primary px-2 py-1 text-xs text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            Accept
          </button>
        </div>
      </div>
      {error !== null && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
