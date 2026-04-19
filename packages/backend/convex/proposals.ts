import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

// Agent-authored event proposals.
//
// Lifecycle:
//   create → pending → accept → accepted (+ createdEventId, + respondedAt)
//                    → reject → rejected (+ respondedAt)
//
// Rows are NOT deleted on accept/reject — keeping the history lets a future
// "agent activity" feed render past proposals without a schema migration.
// The calendar view only queries `pending` rows so finished proposals don't
// clutter the UI.

const proposalStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("rejected"),
);

const proposalDoc = v.object({
  _id: v.id("eventProposals"),
  _creationTime: v.number(),
  userId: v.id("users"),
  calendarId: v.id("calendars"),
  summary: v.string(),
  description: v.optional(v.string()),
  location: v.optional(v.string()),
  start: v.number(),
  end: v.number(),
  allDay: v.boolean(),
  status: proposalStatus,
  proposedAt: v.number(),
  respondedAt: v.optional(v.number()),
  createdEventId: v.optional(v.id("events")),
});

const proposalWithCalendar = v.object({
  proposal: proposalDoc,
  calendar: v.object({
    _id: v.id("calendars"),
    summary: v.string(),
    summaryOverride: v.optional(v.string()),
    backgroundColor: v.string(),
    foregroundColor: v.string(),
  }),
});

// Shared ownership guard: the proposal's userId must match args.userId AND
// the calendar must still resolve to an account owned by that user. The
// second check guards against stale calendarIds (e.g. calendar unsubscribed
// after the proposal was created).
async function assertOwnsProposal(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  proposalId: Id<"eventProposals">,
): Promise<Doc<"eventProposals">> {
  const proposal = await ctx.db.get(proposalId);
  if (proposal === null) {
    throw new ConvexError("Proposal not found");
  }
  if (proposal.userId !== userId) {
    throw new ConvexError("Forbidden");
  }
  return proposal;
}

async function assertUserOwnsCalendar(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  calendarId: Id<"calendars">,
): Promise<Doc<"calendars">> {
  const calendar = await ctx.db.get(calendarId);
  if (calendar === null) {
    throw new ConvexError("Calendar not found");
  }
  const account = await ctx.db.get(calendar.googleAccountId);
  if (account === null || account.userId !== userId) {
    throw new ConvexError("You do not own this calendar");
  }
  return calendar;
}

// Agent-invoked: insert a pending proposal. `proposedAt` is set server-side
// so the queryable ordering is deterministic regardless of client clocks.
export const create = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
  },
  returns: v.id("eventProposals"),
  handler: async (ctx, args) => {
    if (args.end <= args.start) {
      throw new ConvexError("End must be after start");
    }
    const calendar = await assertUserOwnsCalendar(
      ctx,
      args.userId,
      args.calendarId,
    );
    if (calendar.accessRole !== "owner" && calendar.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }
    return await ctx.db.insert("eventProposals", {
      userId: args.userId,
      calendarId: args.calendarId,
      summary: args.summary,
      description: args.description,
      location: args.location,
      start: args.start,
      end: args.end,
      allDay: args.allDay,
      status: "pending",
      proposedAt: Date.now(),
    });
  },
});

// Calendar view uses this to render ghost cards. Window semantics mirror
// events.listForUserInRange: start falls in [start, end). Only `pending`
// rows are returned; accepted/rejected ones stay in the table but stay out
// of the live calendar view.
export const listForUserInRange = query({
  args: {
    userId: v.id("users"),
    start: v.number(),
    end: v.number(),
  },
  returns: v.array(proposalWithCalendar),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("eventProposals")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending"),
      )
      .collect();

    const inRange = pending.filter(
      (p) => p.start >= args.start && p.start < args.end,
    );

    // Join with minimal calendar info so the UI can style the ghost card to
    // match the calendar's color without a second round-trip.
    const results: Array<{
      proposal: Doc<"eventProposals">;
      calendar: {
        _id: Id<"calendars">;
        summary: string;
        summaryOverride?: string;
        backgroundColor: string;
        foregroundColor: string;
      };
    }> = [];
    for (const proposal of inRange) {
      const calendar = await ctx.db.get(proposal.calendarId);
      if (calendar === null) continue;
      results.push({
        proposal,
        calendar: {
          _id: calendar._id,
          summary: calendar.summary,
          summaryOverride: calendar.summaryOverride,
          backgroundColor: calendar.colorOverride ?? calendar.backgroundColor,
          foregroundColor: calendar.foregroundColor,
        },
      });
    }
    results.sort((a, b) => a.proposal.start - b.proposal.start);
    return results;
  },
});

// Accept: delegate event creation to the existing action (which handles
// Google round-trip, OAuth refresh, and local insert), then patch the
// proposal to `accepted` with a pointer to the new event. Kept as an action
// because `api.events.createEvent` is an action.
export const accept = action({
  args: {
    userId: v.id("users"),
    proposalId: v.id("eventProposals"),
  },
  returns: v.id("events"),
  handler: async (ctx, args): Promise<Id<"events">> => {
    const proposal = await ctx.runQuery(api.proposals._getForAccept, {
      userId: args.userId,
      proposalId: args.proposalId,
    });
    if (proposal === null) throw new ConvexError("Proposal not found");
    if (proposal.status !== "pending") {
      throw new ConvexError(`Proposal is already ${proposal.status}`);
    }

    const eventId = await ctx.runAction(api.events.createEvent, {
      userId: args.userId,
      calendarId: proposal.calendarId,
      summary: proposal.summary,
      description: proposal.description,
      location: proposal.location,
      start: proposal.start,
      end: proposal.end,
      allDay: proposal.allDay,
    });

    await ctx.runMutation(api.proposals._markAccepted, {
      userId: args.userId,
      proposalId: args.proposalId,
      createdEventId: eventId,
    });

    return eventId;
  },
});

// Internal read for the accept action. Exposed via `api.proposals._getForAccept`
// rather than `internal.*` so the action can call it from the public namespace
// without threading an additional `internal` import in this file's consumers.
export const _getForAccept = query({
  args: {
    userId: v.id("users"),
    proposalId: v.id("eventProposals"),
  },
  returns: v.union(proposalDoc, v.null()),
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal === null) return null;
    if (proposal.userId !== args.userId) return null;
    return proposal;
  },
});

export const _markAccepted = mutation({
  args: {
    userId: v.id("users"),
    proposalId: v.id("eventProposals"),
    createdEventId: v.id("events"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const proposal = await assertOwnsProposal(ctx, args.userId, args.proposalId);
    if (proposal.status !== "pending") {
      throw new ConvexError(`Proposal is already ${proposal.status}`);
    }
    await ctx.db.patch(args.proposalId, {
      status: "accepted",
      respondedAt: Date.now(),
      createdEventId: args.createdEventId,
    });
    return null;
  },
});

// Reject: just flip status. No Google side effect.
export const reject = mutation({
  args: {
    userId: v.id("users"),
    proposalId: v.id("eventProposals"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const proposal = await assertOwnsProposal(ctx, args.userId, args.proposalId);
    if (proposal.status !== "pending") {
      throw new ConvexError(`Proposal is already ${proposal.status}`);
    }
    await ctx.db.patch(args.proposalId, {
      status: "rejected",
      respondedAt: Date.now(),
    });
    return null;
  },
});
