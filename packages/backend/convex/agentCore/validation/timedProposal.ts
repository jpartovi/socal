// Overlap + minimum-gap validation for timed event proposals. Pure TS (no Convex).

import { isoInZone } from "../../timezone";

/** Minimum gap (ms) between a proposed timed event and any adjacent busy block. */
export const PROPOSE_MIN_GAP_MS = 15 * 60 * 1000;

export type BusyEventRow = {
  event: { start: number; end: number; summary: string; allDay?: boolean };
};

export type TimedProposalSpacingErrorOptions = {
  /** Lead-in for each message, e.g. "Spacing check" (default) or "Alex's calendar". */
  subjectDescription?: string;
};

/** Returns a human/tool-readable error string, or null if spacing is OK. */
export function timedProposalSpacingError(
  start: number,
  end: number,
  rows: BusyEventRow[],
  userTimeZone: string | undefined,
  options?: TimedProposalSpacingErrorOptions,
): string | null {
  const subject = options?.subjectDescription ?? "Spacing check";
  for (const { event: e } of rows) {
    // All-day blocks are contextual in the UI; they must not block timed proposals.
    if (e.allDay === true) continue;
    const eStart = e.start;
    const eEnd = e.end;
    const overlaps = start < eEnd && end > eStart;
    if (overlaps) {
      const scheduleHint =
        subject === "Spacing check"
          ? "Pick a time that does not intersect that event, or call get_user_schedule again."
          : "Pick a time that does not intersect that event, or call get_friend_schedule for their window.";
      return (
        `${subject}: proposal window overlaps existing event "${e.summary ?? "(untitled)"}" ` +
        `(${isoInZone(eStart, userTimeZone)} – ${isoInZone(eEnd, userTimeZone)}). ` +
        `No proposal was created. ${scheduleHint} ` +
        `Only use spacingValidationOverride: true if the user explicitly asked for overlap.`
      );
    }
    if (eEnd <= start && start - eEnd < PROPOSE_MIN_GAP_MS) {
      return (
        `${subject}: proposal starts only ${Math.round((start - eEnd) / 60000)} min after "${e.summary ?? "(untitled)"}" ends ` +
        `(${isoInZone(eEnd, userTimeZone)} — need at least 15 min gap). ` +
        `No proposal was created. Shift startIso to at least 15 minutes after that event's end. ` +
        `Only use spacingValidationOverride: true if the user explicitly asked for back-to-back.`
      );
    }
    if (eStart >= end && eStart - end < PROPOSE_MIN_GAP_MS) {
      return (
        `${subject}: proposal ends only ${Math.round((eStart - end) / 60000)} min before "${e.summary ?? "(untitled)"}" starts ` +
        `(${isoInZone(eStart, userTimeZone)} — need at least 15 min gap). ` +
        `No proposal was created. Shift endIso so the event ends at least 15 minutes before that event. ` +
        `Only use spacingValidationOverride: true if the user explicitly asked for back-to-back.`
      );
    }
  }
  return null;
}
