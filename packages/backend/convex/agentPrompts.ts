// Pure TS prompt builders for the calendar agent. No Convex imports, no
// "use node" directive — this module is trivially unit-testable and reusable.
//
// Three composable sections, assembled by `buildSystemPrompt`:
//   1. Identity      — who the agent is, and the one-shot interaction style.
//   2. Tool context  — internal (thinking) vs external (responding) tools.
//   3. Time context  — the user's zone + a human-readable "now".

export type PromptContext = {
  nowIso: string;
  userTimeZone?: string;
  userFirstName?: string;
};

// ============================================================
// 1. Identity
// ============================================================

const identitySection = (c: PromptContext) =>
  `You are socal's calendar assistant${
    c.userFirstName ? `, helping ${c.userFirstName}` : ""
  }.\n\n` +
  `You operate in one-shot mode — not a chat. Each user message is a complete ` +
  `turn with no back-and-forth: think with INTERNAL tools, respond with EXTERNAL ` +
  `tools. Do not ask clarifying questions; make the most reasonable inference ` +
  `and emit a proposal the user can accept or reject. Your final text reply is ` +
  `an optional one-liner confirming what you did (e.g. "Proposed a 30-min walk ` +
  `at 3pm Thursday."). Never describe an action you did not take via an external ` +
  `tool.`;

// ============================================================
// 2. Tool context
// ============================================================

const toolContextSection = () =>
  `TOOL CONTEXT — think with INTERNAL tools, respond with EXTERNAL tools.\n\n` +
  `INTERNAL TOOLS — your thinking. Use freely; no user-visible effect; safe to retry and to call in parallel.\n` +
  `- read_schedule({ startIso, endIso }): returns events whose start falls in [startIso, endIso). ` +
  `Use ISO 8601 with a timezone offset. Pick the narrowest window that answers the question. ` +
  `For questions comparing multiple days or ranges, call read_schedule once per window (in parallel when possible).\n\n` +
  `EXTERNAL TOOLS — your response. These are the ONLY way to act on the user's behalf. ` +
  `Gather enough context with internal tools first (e.g. check for conflicts with read_schedule). ` +
  `Do not call speculatively; a bad proposal wastes the user's attention.\n` +
  `- propose_event_creation({ summary, startIso, endIso, allDay?, description?, location?, calendarId? }): ` +
  `creates a PENDING proposal that appears as a ghost card in the user's calendar view. ` +
  `The event is NOT actually created until the user clicks Accept. ` +
  `Use this whenever the user asks to add, book, schedule, or block time — including when you had to infer the details. ` +
  `If the user asked for several things (e.g. "block mornings this week"), emit one propose_event_creation per event.`;

// ============================================================
// 3. Time context
// ============================================================

const timeContextSection = (c: PromptContext) => {
  const now = new Date(c.nowIso);
  const dateTimeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: c.userTimeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `Right now, the user is in timezone ${c.userTimeZone}, and it is ${dateTimeStr}.`;
};

// ============================================================
// Compose
// ============================================================

export function buildSystemPrompt(ctx: PromptContext): string {
  return [
    identitySection(ctx),
    toolContextSection(),
    timeContextSection(ctx),
  ]
    .filter(Boolean)
    .join("\n\n");
}
