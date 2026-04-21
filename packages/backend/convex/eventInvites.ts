import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";

// Same ordering helper as friendships.ts uses for the by_pair index.
function orderPair(
  a: Id<"users">,
  b: Id<"users">,
): { userA: Id<"users">; userB: Id<"users"> } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

async function assertEventOwner(
  ctx: QueryCtx,
  userId: Id<"users">,
  eventId: Id<"events">,
): Promise<Doc<"events">> {
  const event = await ctx.db.get(eventId);
  if (event === null) throw new ConvexError("Event not found");
  const cal = await ctx.db.get(event.calendarId);
  if (cal === null) throw new ConvexError("Calendar not found");
  const account = await ctx.db.get(cal.googleAccountId);
  if (account === null || account.userId !== userId) {
    throw new ConvexError("Forbidden");
  }
  return event;
}

async function assertAcceptedFriendship(
  ctx: QueryCtx,
  userId: Id<"users">,
  friendUserId: Id<"users">,
): Promise<void> {
  if (userId === friendUserId) {
    throw new ConvexError("Cannot invite yourself");
  }
  const { userA, userB } = orderPair(userId, friendUserId);
  const friendship = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("userA", userA).eq("userB", userB))
    .unique();
  if (friendship === null || friendship.status !== "accepted") {
    throw new ConvexError("Not friends");
  }
}

// Bulk reconcile a single event's friend invites. Used both at create
// (just-inserted event with empty current set) and at edit time. Diffing
// here keeps the action callers ignorant of which rows already exist.
async function reconcileInvites(
  ctx: MutationCtx,
  eventId: Id<"events">,
  inviterUserId: Id<"users">,
  nextFriendIds: Id<"users">[],
): Promise<void> {
  const current = await ctx.db
    .query("eventInvites")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const currentSet = new Set(current.map((r) => r.inviteeUserId));
  const nextSet = new Set(nextFriendIds);

  for (const row of current) {
    if (!nextSet.has(row.inviteeUserId)) await ctx.db.delete(row._id);
  }
  const now = Date.now();
  for (const friendId of nextFriendIds) {
    if (currentSet.has(friendId)) continue;
    await assertAcceptedFriendship(ctx, inviterUserId, friendId);
    await ctx.db.insert("eventInvites", {
      eventId,
      inviteeUserId: friendId,
      inviterUserId,
      createdAt: now,
    });
  }
}

// Public mutation: replace the friend-invite set for an event the caller
// owns. Used directly from the client when the existing edit path is
// already running (e.g., undo for now just calls this with the prev set).
export const setInvitesForEvent = mutation({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    friendUserIds: v.array(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertEventOwner(ctx, args.userId, args.eventId);
    await reconcileInvites(
      ctx,
      args.eventId,
      args.userId,
      args.friendUserIds,
    );
    return null;
  },
});

// Internal flavor: same reconciliation but skip the ownership check (the
// calling action has already validated). Used by createEvent and
// updateEventFields right after they touch the event.
export const _reconcile = internalMutation({
  args: {
    eventId: v.id("events"),
    inviterUserId: v.id("users"),
    friendUserIds: v.array(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await reconcileInvites(
      ctx,
      args.eventId,
      args.inviterUserId,
      args.friendUserIds,
    );
    return null;
  },
});
