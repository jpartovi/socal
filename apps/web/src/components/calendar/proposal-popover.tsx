"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { Avatar } from "@socal/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@socal/ui/components/popover";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { formatTime } from "@/components/calendar/lib";
import type { ProposalRow } from "@/components/calendar/types";
import { useAuth } from "@/lib/auth";

type ProposalParticipant = ProposalRow["participants"][number];

function sortProposalParticipants(
  participants: ProposalParticipant[],
): ProposalParticipant[] {
  return [...participants].sort((a, b) => {
    const ka = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
    const kb = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
    return ka.localeCompare(kb);
  });
}

function ProposalGuestListItem({ participant: p }: { participant: ProposalParticipant }) {
  const label = `${p.firstName} ${p.lastName}`.trim();
  return (
    <li className="flex items-start gap-2">
      <Avatar
        name={label}
        photoUrl={p.photoUrl ?? undefined}
        size="sm"
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="break-words text-xs font-medium leading-snug">
          {label}
        </div>
      </div>
    </li>
  );
}

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
  const rejectGroup = useMutation(api.proposals.rejectGroup);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

<<<<<<< HEAD
  // Option-set proposals: fetch every pending sibling in the same group so
  // the user can page through them in-place. Single proposals skip the
  // query and render the original row alone.
  const groupId = row.proposal.groupId;
  const siblings = useQuery(
    api.proposals.listGroup,
    userId && groupId !== undefined ? { userId, groupId } : "skip",
  );
  const groupRows = useMemo<ProposalRow[]>(() => {
    if (siblings === undefined || siblings.length === 0) return [row];
    return siblings;
  }, [siblings, row]);

  // Start on the clicked option. If that option gets cascade-rejected (user
  // accepted a sibling somewhere else), fall back to the first still-pending
  // row so the popover doesn't render stale data.
  const [activeId, setActiveId] = useState(row.proposal._id);
  const activeRow =
    groupRows.find((r) => r.proposal._id === activeId) ?? groupRows[0];
  const activeIndex = groupRows.findIndex(
    (r) => r.proposal._id === activeRow.proposal._id,
  );
  const canPaginate = groupRows.length > 1;

  const { proposal, calendar } = activeRow;
=======
  const { proposal, calendar, participants } = row;
>>>>>>> main
  const color = calendar.backgroundColor;
  const accountName = calendar.summaryOverride ?? calendar.summary;
  const timeLabel = formatProposalTimeRange(
    proposal.start,
    proposal.end,
    proposal.allDay,
  );
  const descriptionText = proposal.description ?? null;

  function goPrev() {
    if (!canPaginate) return;
    const next = (activeIndex - 1 + groupRows.length) % groupRows.length;
    setActiveId(groupRows[next].proposal._id);
  }

  function goNext() {
    if (!canPaginate) return;
    const next = (activeIndex + 1) % groupRows.length;
    setActiveId(groupRows[next].proposal._id);
  }

  async function onAccept() {
    if (!userId || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await accept({ userId, proposalId: proposal._id });
      // On success this row (and its siblings via cascade-reject) disappear
      // from the live query; the popover will unmount with it, so we don't
      // re-enable the buttons.
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

  async function onRejectAll() {
    if (!userId || isPending) return;
    if (groupId === undefined) return;
    setIsPending(true);
    setError(null);
    try {
      await rejectGroup({ userId, groupId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsPending(false);
    }
  }

  // Popover-scoped shortcuts (Cursor-style):
  //   Tab/y/Enter    → accept
  //   n/Delete/Back  → reject (current option)
  //   Shift+Backspace/Shift+Delete → reject all (grouped proposals only)
  //   ←/→            → prev/next sibling (grouped proposals only)
  // Radix handles Escape for closing. Tab is hijacked from the default
  // focus-traversal behavior because the popover only holds a handful of
  // buttons; accepting is the primary action and should be reachable
  // without reaching for the mouse.
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
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        void onAccept();
      } else if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
        e.preventDefault();
        void onAccept();
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        e.shiftKey &&
        canPaginate
      ) {
        e.preventDefault();
        void onRejectAll();
      } else if (
        e.key === "n" ||
        e.key === "N" ||
        e.key === "Backspace" ||
        e.key === "Delete"
      ) {
        e.preventDefault();
        void onReject();
      } else if (e.key === "ArrowLeft" && canPaginate) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && canPaginate) {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // onAccept/onReject/goPrev/goNext close over stable hooks and the
    // memoized groupRows; rebinding on every keystroke isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, canPaginate, activeIndex, groupRows, groupId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 -mt-2 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium"
          style={{ color }}
        >
          <SparkleIcon />
          Suggestion
        </span>
        {canPaginate ? (
          <div className="flex items-center">
            <IconButton onClick={goPrev} label="Previous option">
              <ChevronLeftIcon />
            </IconButton>
            <span className="min-w-[44px] text-center text-[11px] tabular-nums text-muted-foreground">
              {activeIndex + 1} of {groupRows.length}
            </span>
            <IconButton onClick={goNext} label="Next option">
              <ChevronRightIcon />
            </IconButton>
          </div>
        ) : (
          <IconButton onClick={onClose} label="Close">
            <CloseIcon />
          </IconButton>
        )}
      </div>

      <div className="min-w-0">
        <h3 className="break-words text-lg font-medium leading-tight">
          {proposal.summary || "(no title)"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{timeLabel}</p>
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

      {participants.length > 0 && (
        <Row icon={<PeopleIcon />}>
          <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
            {sortProposalParticipants(participants).map((p) => (
              <ProposalGuestListItem key={p.userId} participant={p} />
            ))}
          </ul>
        </Row>
      )}

      <Row icon={<CalendarIcon />}>
        <span className="text-xs text-muted-foreground">{accountName}</span>
      </Row>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onReject}
          disabled={isPending}
          className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={isPending}
          className="flex-1 rounded-lg px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          Accept
        </button>
      </div>

      {canPaginate && (
        <button
          type="button"
          onClick={onRejectAll}
          disabled={isPending}
          className="-mt-1 self-center text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline disabled:opacity-50"
        >
          Reject all {groupRows.length} options
        </button>
      )}

      {error !== null && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5zM13 9l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8L10.5 11.5l1.8-.7L13 9zM3.5 10l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L1.7 11.8l1.3-.5L3.5 10z" />
    </svg>
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

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
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

function PeopleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M6.5 8.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
      <path d="M1.75 13.25c.6-2.25 2.2-3.5 4.75-3.5s4.15 1.25 4.75 3.5" />
      <path d="M11 4.25a2.25 2.25 0 0 1 0 4.25" />
      <path d="M11.75 9.75c1.4.45 2.25 1.55 2.5 3.25" />
    </svg>
  );
}
