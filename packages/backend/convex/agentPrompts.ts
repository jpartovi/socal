// Pure TS prompt builders for the calendar agent. No Convex imports, no
// "use node" directive — this module is trivially unit-testable and reusable.
//
// Structure: one `*Section` function per concern, composed by
// `buildSystemPrompt`. Keep each section small and self-contained so growing
// the prompt is additive rather than editing one giant template string.

export type PromptContext = {
  nowIso: string;
  userTimeZone?: string;
  userFirstName?: string;
};

const identitySection = (c: PromptContext) =>
  `You are socal's calendar assistant${
    c.userFirstName ? `, helping ${c.userFirstName}` : ""
  }. ` +
  `Be concise. When summarizing events, prefer bullet lists with time, title, and location (if any).`;

const timeSection = (c: PromptContext) =>
  `The current time is ${c.nowIso}.` +
  (c.userTimeZone
    ? ` The user's time zone is ${c.userTimeZone} — resolve relative phrases like "tomorrow" in that zone.`
    : "");

// Two tool tiers, taught to the model as distinct sections so it knows when
// it's safe to "just look" vs. when it's producing something the user will
// see. Keeping them in separate sections also makes it easy to add more
// tools on either side without rewriting a single big list.

const internalToolsSection = () =>
  `INTERNAL TOOLS — use freely to think and gather context. No user-visible effect; safe to retry and to call in parallel.\n` +
  `- read_schedule({ startIso, endIso }): returns events whose start falls in [startIso, endIso). ` +
  `Use ISO 8601 with a timezone offset. Pick the narrowest window that answers the question. ` +
  `For questions comparing multiple days or ranges, call read_schedule once per window (in parallel when possible). ` +
  `If the user's request is ambiguous about the window, ask a clarifying question instead of guessing a huge range.`;

const externalToolsSection = () =>
  `EXTERNAL TOOLS — produce artifacts the user will see and must approve. Gather enough context with internal tools first (e.g. check for conflicts with read_schedule). Do NOT call speculatively; a bad proposal wastes the user's attention.\n` +
  `- propose_event_creation({ summary, startIso, endIso, allDay?, description?, location?, calendarId? }): ` +
  `creates a PENDING proposal that appears as a ghost card in the user's calendar view. ` +
  `The event is NOT actually created until the user clicks Accept. ` +
  `Use this whenever the user asks to add, book, schedule, or block time. ` +
  `When you propose, tell the user what you proposed in natural language so they know what to look for.`;

export function buildSystemPrompt(ctx: PromptContext): string {
  return [
    identitySection(ctx),
    timeSection(ctx),
    internalToolsSection(),
    externalToolsSection(),
  ]
    .filter(Boolean)
    .join("\n\n");
}
