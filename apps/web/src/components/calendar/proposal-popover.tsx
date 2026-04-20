"use client";

import { api } from "@socal/backend/convex/_generated/api";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@socal/ui/components/popover";
import { useAction, useMutation } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";

import { formatTime } from "@/components/calendar/lib";
import type { ProposalRow } from "@/components/calendar/types";
import { useAuth } from "@/lib/auth";

// Popover that mirrors EventPopover's read-only body but for agent-proposed
// events. Trigger can be any element (the ProposalItem ghost card in our
// views). The body shows the same detail rows a real event would, plus
// Accept / Reject buttons that drive the proposal lifecycle. We keep local
// state for pending/error so repeated clicks don't fire duplicate mutations
// and so transient failures can be surfaced inline.
export function ProposalPopover({
  row,
  children,
}: {
  row: ProposalRow;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-80 p-4 text-sm"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <ProposalPopoverBody row={row} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function ProposalPopoverBody({
  row,
  onClose,
}: {
  row: ProposalRow;
  onClose: () => void;
}) {
  const { userId } = useAuth();
  const accept = useAction(api.proposals.accept);
  const reject = useMutation(api.proposals.reject);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { proposal, calendar } = row;
  const color = calendar.backgroundColor;
  const accountName = calendar.summaryOverride ?? calendar.summary;
  const timeLabel = formatProposalTimeRange(
    proposal.start,
    proposal.end,
    proposal.allDay,
  );
  const descriptionText = proposal.description ?? null;

  async function onAccept() {
    if (!userId || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await accept({ userId, proposalId: proposal._id });
      // On success the row disappears from the live query; the popover will
      // unmount with it, so we don't re-enable the buttons.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsPending(false);
    }
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

  // Popover-scoped shortcuts: y/Enter = accept, n/Delete/Backspace = reject.
  // Radix handles Escape for closing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
        e.preventDefault();
        void onAccept();
      } else if (
        e.key === "n" ||
        e.key === "N" ||
        e.key === "Backspace" ||
        e.key === "Delete"
      ) {
        e.preventDefault();
        void onReject();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onAccept/onReject close over stable hooks; rebinding on every keystroke
    // isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 -mt-2 flex items-center justify-between">
        <span
          className="rounded-full border border-dashed px-2 py-0.5 text-[10px] uppercase tracking-wider"
          style={{ borderColor: color, color }}
        >
          Proposed
        </span>
        <IconButton onClick={onClose} label="Close">
          <CloseIcon />
        </IconButton>
      </div>

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border border-dashed"
          style={{ borderColor: color }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-medium leading-tight">
            {proposal.summary || "(no title)"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{timeLabel}</p>
        </div>
      </div>

      {proposal.location && (
        <Row icon={<LocationIcon />}>{proposal.location}</Row>
      )}

      {descriptionText && (
        <Row icon={<DescriptionIcon />}>
          <p className="whitespace-pre-wrap break-words text-xs leading-snug text-foreground/80">
            {descriptionText}
          </p>
        </Row>
      )}

      <Row icon={<CalendarIcon />}>
        <span className="text-xs text-muted-foreground">{accountName}</span>
      </Row>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onReject}
          disabled={isPending}
          className="rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={isPending}
          className="rounded-lg px-2.5 py-1 text-xs text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          Accept
        </button>
      </div>

      {error !== null && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Row({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm text-foreground/90">{children}</div>
    </div>
  );
}

function formatProposalTimeRange(
  start: number,
  end: number,
  allDay: boolean,
): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };

  if (allDay) {
    const inclusiveEnd = new Date(end - 1);
    if (sameYMD(startDate, inclusiveEnd)) {
      return `${startDate.toLocaleDateString(undefined, dateOpts)} · all day`;
    }
    return `${startDate.toLocaleDateString(undefined, dateOpts)} – ${inclusiveEnd.toLocaleDateString(undefined, dateOpts)}`;
  }

  if (sameYMD(startDate, endDate)) {
    return `${startDate.toLocaleDateString(undefined, dateOpts)} · ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${startDate.toLocaleDateString(undefined, dateOpts)} ${formatTime(start)} – ${endDate.toLocaleDateString(undefined, dateOpts)} ${formatTime(end)}`;
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <path d="M8 14s5-4.5 5-8.5a5 5 0 10-10 0C3 9.5 8 14 8 14z" />
      <circle cx="8" cy="5.5" r="1.75" />
    </svg>
  );
}

function DescriptionIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" strokeLinecap="round" />
    </svg>
  );
}
