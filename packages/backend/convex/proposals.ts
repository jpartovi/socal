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
import { resolvePrimaryGoogleAccountForUser } from "./googleAccounts";

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
  groupId: v.optional(v.string()),
  groupIndex: v.optional(v.number()),
  groupSize: v.optional(v.number()),
  participantFriendUserIds: v.optional(v.array(v.id("users"))),
});

const proposalParticipantSummary = v.object({
  userId: v.id("users"),
  firstName: v.string(),
  lastName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
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
  participants: v.array(proposalParticipantSummary),
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

function orderPair(
  a: Id<"users">,
  b: Id<"users">,
): { userA: Id<"users">; userB: Id<"users"> } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

async function assertAcceptedFriendship(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  friendUserId: Id<"users">,
): Promise<void> {
  if (userId === friendUserId) {
    throw new ConvexError("Cannot add yourself as a participant");
  }
  const { userA, userB } = orderPair(userId, friendUserId);
  const friendship = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("userA", userA).eq("userB", userB))
    .unique();
  if (friendship === null || friendship.status !== "accepted") {
    throw new ConvexError("Participant is not an accepted friend");
  }
}

function dedupeFriendUserIds(ids: Id<"users">[]): Id<"users">[] {
  return [...new Set(ids)];
}

/**
 * Matches events.listForUserInRange attendee photos: uploaded photo wins when
 * useDefaultAvatar is not true, then primary Google, then any connected Google.
 */
async function resolvePhotoUrlForUser(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<string | null> {
  let photoUrl: string | null = null;
  if (user.photoStorageId && !user.useDefaultAvatar) {
    const url = await ctx.storage.getUrl(user.photoStorageId);
    if (url) photoUrl = url;
  }
  const primary = await resolvePrimaryGoogleAccountForUser(ctx, user._id);
  if (photoUrl === null) {
    photoUrl = primary?.pictureUrl ?? null;
  }
  if (photoUrl === null) {
    const googleAccount = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.neq(q.field("pictureUrl"), undefined))
      .first();
    photoUrl = googleAccount?.pictureUrl ?? null;
  }
  return photoUrl;
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
    participantFriendUserIds: v.optional(v.array(v.id("users"))),
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
    const friendIds = dedupeFriendUserIds(args.participantFriendUserIds ?? []);
    for (const fid of friendIds) {
      await assertAcceptedFriendship(ctx, args.userId, fid);
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
      participantFriendUserIds:
        friendIds.length > 0 ? friendIds : undefined,
    });
  },
});

// Batch variant: insert N linked proposals sharing a groupId so the UI can
// render them as an option set ("1 of 3") and accepting one can cascade-reject
// the others. Single-option calls are allowed (groupSize=1) but the agent
// should prefer `create` for that case.
export const createBatch = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    options: v.array(
      v.object({
        summary: v.string(),
        description: v.optional(v.string()),
        location: v.optional(v.string()),
        start: v.number(),
        end: v.number(),
        allDay: v.boolean(),
      }),
    ),
    participantFriendUserIds: v.optional(v.array(v.id("users"))),
  },
  returns: v.array(v.id("eventProposals")),
  handler: async (ctx, args) => {
    if (args.options.length === 0) {
      throw new ConvexError("Must provide at least one option");
    }
    if (args.options.length > 3) {
      throw new ConvexError("At most 3 options per batch");
    }
    for (const opt of args.options) {
      if (opt.end <= opt.start) {
        throw new ConvexError("End must be after start");
      }
    }
    const calendar = await assertUserOwnsCalendar(
      ctx,
      args.userId,
      args.calendarId,
    );
    if (calendar.accessRole !== "owner" && calendar.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }
    const friendIds = dedupeFriendUserIds(args.participantFriendUserIds ?? []);
    for (const fid of friendIds) {
      await assertAcceptedFriendship(ctx, args.userId, fid);
    }
    const groupId = globalThis.crypto.randomUUID();
    const groupSize = args.options.length;
    const proposedAt = Date.now();
    const ids: Id<"eventProposals">[] = [];
    for (let i = 0; i < args.options.length; i++) {
      const opt = args.options[i];
      const id = await ctx.db.insert("eventProposals", {
        userId: args.userId,
        calendarId: args.calendarId,
        summary: opt.summary,
        description: opt.description,
        location: opt.location,
        start: opt.start,
        end: opt.end,
        allDay: opt.allDay,
        status: "pending",
        proposedAt,
        groupId,
        groupIndex: i,
        groupSize,
        participantFriendUserIds:
          friendIds.length > 0 ? friendIds : undefined,
      });
      ids.push(id);
    }
    return ids;
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
      participants: Array<{
        userId: Id<"users">;
        firstName: string;
        lastName: string;
        photoUrl: string | null;
      }>;
    }> = [];
    for (const proposal of inRange) {
      const calendar = await ctx.db.get(proposal.calendarId);
      if (calendar === null) continue;
      const participantIds = proposal.participantFriendUserIds ?? [];
      const participants: Array<{
        userId: Id<"users">;
        firstName: string;
        lastName: string;
        photoUrl: string | null;
      }> = [];
      for (const uid of participantIds) {
        const u = await ctx.db.get(uid);
        if (u === null) continue;
        const photoUrl = await resolvePhotoUrlForUser(ctx, u);
        participants.push({
          userId: u._id,
          firstName: u.firstName,
          lastName: u.lastName,
          photoUrl,
        });
      }
      results.push({
        proposal,
        calendar: {
          _id: calendar._id,
          summary: calendar.summary,
          summaryOverride: calendar.summaryOverride,
          backgroundColor: calendar.colorOverride ?? calendar.backgroundColor,
          foregroundColor: calendar.foregroundColor,
        },
        participants,
      });
    }
    results.sort((a, b) => a.proposal.start - b.proposal.start);
    return results;
  },
});

// Group view for the proposal popover carousel. Returns every pending
// proposal in the group, sorted by groupIndex, so the UI can let the user
// flip between options with ◀/▶. Rejected siblings are filtered out — once
// one is accepted the cascade-reject leaves only the accepted row, and the
// popover is expected to unmount at that point anyway.
export const listGroup = query({
  args: {
    userId: v.id("users"),
    groupId: v.string(),
  },
  returns: v.array(proposalWithCalendar),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eventProposals")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const pending = rows.filter(
      (r) => r.userId === args.userId && r.status === "pending",
    );
    pending.sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));
    const results: Array<{
      proposal: Doc<"eventProposals">;
      calendar: {
        _id: Id<"calendars">;
        summary: string;
        summaryOverride?: string;
        backgroundColor: string;
        foregroundColor: string;
      };
      participants: Array<{
        userId: Id<"users">;
        firstName: string;
        lastName: string;
        photoUrl: string | null;
      }>;
    }> = [];
    for (const proposal of pending) {
      const calendar = await ctx.db.get(proposal.calendarId);
      if (calendar === null) continue;
      const participantIds = proposal.participantFriendUserIds ?? [];
      const participants: Array<{
        userId: Id<"users">;
        firstName: string;
        lastName: string;
        photoUrl: string | null;
      }> = [];
      for (const uid of participantIds) {
        const u = await ctx.db.get(uid);
        if (u === null) continue;
        const photoUrl = await resolvePhotoUrlForUser(ctx, u);
        participants.push({
          userId: u._id,
          firstName: u.firstName,
          lastName: u.lastName,
          photoUrl,
        });
      }
      results.push({
        proposal,
        calendar: {
          _id: calendar._id,
          summary: calendar.summary,
          summaryOverride: calendar.summaryOverride,
          backgroundColor: calendar.colorOverride ?? calendar.backgroundColor,
          foregroundColor: calendar.foregroundColor,
        },
        participants,
      });
    }
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

    const friendIds = proposal.participantFriendUserIds ?? [];
    const attendees =
      friendIds.length > 0
        ? await ctx.runQuery(api.proposals._resolveParticipantEmailsForAccept, {
            userId: args.userId,
            friendUserIds: friendIds,
          })
        : undefined;

    const eventId = await ctx.runAction(api.events.createEvent, {
      userId: args.userId,
      calendarId: proposal.calendarId,
      summary: proposal.summary,
      description: proposal.description,
      location: proposal.location,
      start: proposal.start,
      end: proposal.end,
      allDay: proposal.allDay,
      attendees,
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

// Validates friendships and resolves primary Google emails for calendar invites.
// Called from proposals.accept before createEvent.
export const _resolveParticipantEmailsForAccept = query({
  args: {
    userId: v.id("users"),
    friendUserIds: v.array(v.id("users")),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const unique = dedupeFriendUserIds(args.friendUserIds);
    if (unique.length === 0) {
      return [];
    }
    const emails: string[] = [];
    for (const friendId of unique) {
      await assertAcceptedFriendship(ctx, args.userId, friendId);
      const primary = await resolvePrimaryGoogleAccountForUser(ctx, friendId);
      if (primary === null) {
        const u = await ctx.db.get(friendId);
        const label = u
          ? `${u.firstName} ${u.lastName}`.trim() || "Friend"
          : "Friend";
        throw new ConvexError(
          `Cannot accept: ${label} has no connected Google email for invites.`,
        );
      }
      emails.push(primary.email);
    }
    return emails;
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
    const respondedAt = Date.now();
    await ctx.db.patch(args.proposalId, {
      status: "accepted",
      respondedAt,
      createdEventId: args.createdEventId,
    });
    // Option-set semantics: accepting one sibling auto-rejects every other
    // still-pending sibling in the same group. Already-accepted/rejected
    // siblings stay as they are — this is additive, not a re-patch.
    const groupId = proposal.groupId;
    if (groupId !== undefined) {
      const siblings = await ctx.db
        .query("eventProposals")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const sibling of siblings) {
        if (sibling._id === args.proposalId) continue;
        if (sibling.status !== "pending") continue;
        await ctx.db.patch(sibling._id, {
          status: "rejected",
          respondedAt,
        });
      }
    }
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

// Reject every still-pending proposal in an option-set group. Used by the
// popover's "Reject all" affordance so the user can dismiss a whole set of
// alternatives in one shot rather than clicking Reject N times. Sibling
// ownership is re-checked per row because `groupId` alone doesn't prove the
// rows belong to the caller.
export const rejectGroup = mutation({
  args: {
    userId: v.id("users"),
    groupId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("eventProposals")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const respondedAt = Date.now();
    for (const row of rows) {
      if (row.userId !== args.userId) continue;
      if (row.status !== "pending") continue;
      await ctx.db.patch(row._id, { status: "rejected", respondedAt });
    }
    return null;
  },
});
