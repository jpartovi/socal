"use client";

import { formatTimeRange } from "@/components/calendar/lib";
import { ProposalPopover } from "@/components/calendar/proposal-popover";
import type { ProposalRow } from "@/components/calendar/types";

// Ghost/dashed-border card used wherever a calendar view renders a list of
// events. Visually distinct from real event cards (dashed outline, reduced
// opacity, a "Proposed" label) so the user reads it as "pending, awaiting
// approval, not yet on my calendar". Clicking the card opens a
// ProposalPopover with details and Accept / Reject actions — mirroring the
// EventPopover flow for real events.
export function ProposalItem({
  row,
  variant = "agenda",
}: {
  row: ProposalRow;
  variant?: "agenda" | "day" | "month";
}) {
  const { proposal, calendar } = row;
  const color = calendar.backgroundColor;

  const timeLabel = proposal.allDay
    ? "All day"
    : formatTimeRange(proposal.start, proposal.end);

  if (variant === "month") {
    return (
      <ProposalPopover row={row}>
        <button
          type="button"
          title={`Proposed: ${proposal.summary}`}
          className="flex items-center gap-1 truncate rounded border border-dashed bg-background/60 px-1 text-left text-[10px] leading-tight opacity-80 outline-none transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: color, color }}
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full border border-dashed"
            style={{ borderColor: color }}
          />
          <span className="truncate">{proposal.summary}</span>
        </button>
      </ProposalPopover>
    );
  }

  if (variant === "day") {
    return (
      <ProposalPopover row={row}>
        <button
          type="button"
          // Stop the column-level drag-create from starting when the user
          // clicks a proposal card inside the day grid.
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-full w-full flex-col justify-start overflow-hidden rounded border border-dashed bg-background/70 px-1 py-0.5 text-left text-[11px] leading-tight outline-none transition hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: color, color }}
          title={`Proposed: ${proposal.summary} · ${timeLabel}`}
        >
          <div className="min-w-0">
            <div className="truncate font-medium">{proposal.summary}</div>
            <div className="truncate opacity-80">{timeLabel}</div>
          </div>
          <span
            className="mt-auto self-end rounded-full border border-dashed px-1.5 text-[9px] uppercase tracking-wider"
            style={{ borderColor: color }}
          >
            Proposed
          </span>
        </button>
      </ProposalPopover>
    );
  }

  return (
    <ProposalPopover row={row}>
      <button
        type="button"
        className="flex w-full flex-col gap-2 rounded-xl border border-dashed bg-background/70 px-3 py-2 text-left text-sm opacity-90 outline-none transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
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
        </div>
      </button>
    </ProposalPopover>
  );
}
