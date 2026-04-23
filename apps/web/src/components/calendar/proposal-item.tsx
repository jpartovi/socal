"use client";

import { useIsProposalHighlighted } from "@/components/calendar/highlight-context";
import { formatTimeRange } from "@/components/calendar/lib";
import { ProposalPopover } from "@/components/calendar/proposal-popover";
import type { ProposalRow } from "@/components/calendar/types";

// Inviting card used wherever a calendar view renders a suggested event.
// Visually lands between "ghost placeholder" and "real event": soft tinted
// fill in the calendar's color, solid accent border, a sparkle prefix that
// signals "AI suggestion", and a subtle hover lift. The earlier dashed /
// faded treatment read as dismissable filler; this treatment reads as an
// opportunity the user should look at.
export function ProposalItem({
  row,
  variant = "agenda",
}: {
  row: ProposalRow;
  variant?: "agenda" | "day" | "month";
}) {
  const { proposal, calendar } = row;
  const color = calendar.backgroundColor;
  // 6-digit hex + 2-digit alpha = 8-digit hex color. Using raw hex+alpha
  // instead of color-mix so every modern browser renders identically.
  const softFill = `${color}1f`; // ~12% alpha
  const softFillHover = `${color}33`; // ~20% alpha on hover
  const highlighted = useIsProposalHighlighted(proposal._id);
  const sparkleClass = highlighted ? " sparkle-pulse" : "";

  const timeLabel = proposal.allDay
    ? "All day"
    : formatTimeRange(proposal.start, proposal.end);

  const groupBadge =
    proposal.groupSize !== undefined &&
    proposal.groupSize > 1 &&
    proposal.groupIndex !== undefined
      ? `${proposal.groupIndex + 1}/${proposal.groupSize}`
      : null;

  if (variant === "month") {
    return (
      <ProposalPopover row={row}>
        <button
          type="button"
          title={`Suggestion: ${proposal.summary}`}
          className={`group flex items-center gap-1 truncate rounded px-1 text-left text-[10px] leading-tight outline-none transition focus-visible:ring-2 focus-visible:ring-ring${sparkleClass}`}
          style={{
            backgroundColor: softFill,
            color,
            boxShadow: `inset 2px 0 0 ${color}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = softFillHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = softFill;
          }}
        >
          <SparkleIcon />
          <span className="truncate">{proposal.summary}</span>
          {groupBadge !== null && (
            <span className="ml-auto shrink-0 text-[9px] tabular-nums opacity-70">
              {groupBadge}
            </span>
          )}
        </button>
      </ProposalPopover>
    );
  }

  if (variant === "day") {
    return (
      <ProposalPopover row={row}>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          className={`group flex h-full w-full flex-col justify-start overflow-hidden rounded px-1.5 py-1 text-left text-[11px] leading-tight outline-none transition focus-visible:ring-2 focus-visible:ring-ring${sparkleClass}`}
          style={{
            backgroundColor: softFill,
            color,
            boxShadow: `inset 3px 0 0 ${color}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = softFillHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = softFill;
          }}
          title={`Suggestion: ${proposal.summary} · ${timeLabel}`}
        >
          <div className="flex min-w-0 items-center gap-1">
            <SparkleIcon />
            <div className="truncate font-medium">{proposal.summary}</div>
            {groupBadge !== null && (
              <span className="ml-auto shrink-0 text-[9px] tabular-nums opacity-70">
                {groupBadge}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate opacity-80">{timeLabel}</div>
        </button>
      </ProposalPopover>
    );
  }

  return (
    <ProposalPopover row={row}>
      <button
        type="button"
        className={`group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm outline-none transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring${sparkleClass}`}
        style={{
          backgroundColor: softFill,
          boxShadow: `inset 3px 0 0 ${color}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = softFillHover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = softFill;
        }}
      >
        <span
          aria-hidden
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: color, color: "#fff" }}
        >
          <SparkleIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{proposal.summary}</span>
            {groupBadge !== null && (
              <span
                className="shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums"
                style={{ backgroundColor: `${color}33`, color }}
              >
                {groupBadge}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {timeLabel}
            {proposal.location ? ` · ${proposal.location}` : ""}
          </span>
        </div>
      </button>
    </ProposalPopover>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-3 w-3 shrink-0"
      aria-hidden
    >
      <path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5zM13 9l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8L10.5 11.5l1.8-.7L13 9zM3.5 10l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L1.7 11.8l1.3-.5L3.5 10z" />
    </svg>
  );
}
