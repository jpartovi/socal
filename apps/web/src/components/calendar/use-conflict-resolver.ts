import type { Id } from "@socal/backend/convex/_generated/dataModel";

import type { EventRow } from "@/components/calendar/types";

// Pad we try to leave when auto-moving a soft event out of the way. Mirrors
// the 10-min minimum gap the agent prompt and proposal validator already use,
// so the drag UX and the agent are consistent about what "not cramped" means.
const MIN_GAP_MS = 10 * 60_000;
const MIN_DURATION_MS = 15 * 60_000;

export type ProposedInterval = {
  eventId: string;
  start: number;
  end: number;
};

export type ConflictOption =
  | { id: "move-soft"; label: string; patch: MovePatch }
  | { id: "shorten-one"; label: string; patch: MovePatch }
  | { id: "keep-both"; label: string; patch: MovePatch };

export type MovePatch = {
  eventId: Id<"events">;
  start: number;
  end: number;
  oldStart: number;
  oldEnd: number;
};

export type Conflict = {
  newInterval: ProposedInterval;
  conflict: EventRow;
  options: ConflictOption[];
};

// Plain "does A overlap B" with strict bounds. A touches-at-edge case
// (a.end === b.start) is NOT a conflict — that's the intended back-to-back
// scenario, which is already handled by the rest of the scheduling stack.
function intervalsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && a.end > b.start;
}

function isSoft(row: EventRow): boolean {
  return row.event.status === "tentative";
}

export function findConflict(args: {
  proposed: ProposedInterval;
  events: EventRow[];
}): EventRow | null {
  for (const row of args.events) {
    if ((row.event._id as string) === args.proposed.eventId) continue;
    if (row.event.allDay) continue;
    if (row.event.status === "cancelled") continue;
    if (
      intervalsOverlap(
        { start: args.proposed.start, end: args.proposed.end },
        { start: row.event.start, end: row.event.end },
      )
    ) {
      return row;
    }
  }
  return null;
}

// Compose the three user-facing options the inline resolver shows. Each option
// returns a single MovePatch ready to hand to `onMoveEvent`. Options whose
// preconditions aren't met (e.g. shortening would leave <15 min of event, or
// neither event is soft) are omitted so the strip doesn't dead-end the user on
// a button that can't actually fit the constraint.
export function buildConflictOptions(args: {
  proposed: ProposedInterval;
  dragged: EventRow;
  conflict: EventRow;
}): ConflictOption[] {
  const { proposed, dragged, conflict } = args;
  const duration = proposed.end - proposed.start;
  const options: ConflictOption[] = [];

  // "Keep both" — commit the drag as-is; lane layout handles the visual
  // overlap. Always available.
  options.push({
    id: "keep-both",
    label: "Keep both",
    patch: {
      eventId: dragged.event._id as Id<"events">,
      start: proposed.start,
      end: proposed.end,
      oldStart: dragged.event.start,
      oldEnd: dragged.event.end,
    },
  });

  // "Shorten one" — trim whichever of the two is longer so its end lands at
  // the other's start (with the 10-min gap). If the shorter one would be left
  // under 15 min, drop the option instead of producing a nub.
  const draggedLen = duration;
  const conflictLen = conflict.event.end - conflict.event.start;
  if (draggedLen >= conflictLen) {
    const newEnd = conflict.event.start - MIN_GAP_MS;
    if (newEnd - proposed.start >= MIN_DURATION_MS) {
      options.push({
        id: "shorten-one",
        label: "Shorten this one",
        patch: {
          eventId: dragged.event._id as Id<"events">,
          start: proposed.start,
          end: newEnd,
          oldStart: dragged.event.start,
          oldEnd: dragged.event.end,
        },
      });
    }
  } else {
    const newEnd = proposed.start - MIN_GAP_MS;
    if (newEnd - conflict.event.start >= MIN_DURATION_MS) {
      options.push({
        id: "shorten-one",
        label: `Shorten "${conflict.event.summary}"`,
        patch: {
          eventId: conflict.event._id as Id<"events">,
          start: conflict.event.start,
          end: newEnd,
          oldStart: conflict.event.start,
          oldEnd: conflict.event.end,
        },
      });
    }
  }

  // "Move soft event" — only when exactly one side is tentative. Slide the
  // soft one to start at the firm one's end + the gap; keep its duration.
  const draggedSoft = isSoft(dragged);
  const conflictSoft = isSoft(conflict);
  if (draggedSoft !== conflictSoft) {
    if (draggedSoft) {
      const start = conflict.event.end + MIN_GAP_MS;
      options.push({
        id: "move-soft",
        label: "Move this (soft)",
        patch: {
          eventId: dragged.event._id as Id<"events">,
          start,
          end: start + draggedLen,
          oldStart: dragged.event.start,
          oldEnd: dragged.event.end,
        },
      });
    } else {
      const start = proposed.end + MIN_GAP_MS;
      options.push({
        id: "move-soft",
        label: `Move "${conflict.event.summary}" (soft)`,
        patch: {
          eventId: conflict.event._id as Id<"events">,
          start,
          end: start + conflictLen,
          oldStart: conflict.event.start,
          oldEnd: conflict.event.end,
        },
      });
    }
  }

  return options;
}

export { intervalsOverlap };
