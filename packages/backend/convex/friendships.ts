import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

// Friendships are bidirectional, so we store one row per pair with the
// two user ids in lexicographic order. `orderPair` gives us the canonical
// (userA, userB) for any two users.
function orderPair(
  a: Id<"users">,
  b: Id<"users">,
): { userA: Id<"users">; userB: Id<"users"> } {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}

async function findFriendship(
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<Doc<"friendships"> | null> {
  const { userA, userB } = orderPair(a, b);
  return await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("userA", userA).eq("userB", userB))
    .unique();
}

const friendshipDoc = v.object({
  _id: v.id("friendships"),
  _creationTime: v.number(),
  userA: v.id("users"),
  userB: v.id("users"),
  requesterId: v.id("users"),
  status: v.union(v.literal("pending"), v.literal("accepted")),
  acceptedAt: v.optional(v.number()),
});

const friendUserSummary = v.object({
  _id: v.id("users"),
  firstName: v.string(),
  lastName: v.string(),
  phoneNumber: v.string(),
});

const connectionEntry = v.object({
  friendshipId: v.id("friendships"),
  user: friendUserSummary,
});

function otherUserId(
  friendship: Doc<"friendships">,
  userId: Id<"users">,
): Id<"users"> {
  return friendship.userA === userId ? friendship.userB : friendship.userA;
}

export const getBetween = query({
  args: {
    userId: v.id("users"),
    otherUserId: v.id("users"),
  },
  returns: v.union(friendshipDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.userId === args.otherUserId) {
      return null;
    }
    return await findFriendship(ctx, args.userId, args.otherUserId);
  },
});

export const listFriends = query({
  args: { userId: v.id("users") },
  returns: v.array(friendshipDoc),
  handler: async (ctx, args) => {
    const asA = await ctx.db
      .query("friendships")
      .withIndex("by_userA_status", (q) =>
        q.eq("userA", args.userId).eq("status", "accepted"),
      )
      .collect();
    const asB = await ctx.db
      .query("friendships")
      .withIndex("by_userB_status", (q) =>
        q.eq("userB", args.userId).eq("status", "accepted"),
      )
      .collect();
    return [...asA, ...asB];
  },
});

export const listIncomingRequests = query({
  args: { userId: v.id("users") },
  returns: v.array(friendshipDoc),
  handler: async (ctx, args) => {
    const asA = await ctx.db
      .query("friendships")
      .withIndex("by_userA_status", (q) =>
        q.eq("userA", args.userId).eq("status", "pending"),
      )
      .collect();
    const asB = await ctx.db
      .query("friendships")
      .withIndex("by_userB_status", (q) =>
        q.eq("userB", args.userId).eq("status", "pending"),
      )
      .collect();
    return [...asA, ...asB].filter((f) => f.requesterId !== args.userId);
  },
});

export const listOutgoingRequests = query({
  args: { userId: v.id("users") },
  returns: v.array(friendshipDoc),
  handler: async (ctx, args) => {
    const asA = await ctx.db
      .query("friendships")
      .withIndex("by_userA_status", (q) =>
        q.eq("userA", args.userId).eq("status", "pending"),
      )
      .collect();
    const asB = await ctx.db
      .query("friendships")
      .withIndex("by_userB_status", (q) =>
        q.eq("userB", args.userId).eq("status", "pending"),
      )
      .collect();
    return [...asA, ...asB].filter((f) => f.requesterId === args.userId);
  },
});

// One-shot query for the /friends page: returns accepted friends, incoming
// pending requests, and outgoing pending requests, each with the other
// user's basic info resolved so the client doesn't have to do N lookups.
export const listConnections = query({
  args: { userId: v.id("users") },
  returns: v.object({
    friends: v.array(connectionEntry),
    incoming: v.array(connectionEntry),
    outgoing: v.array(connectionEntry),
  }),
  handler: async (ctx, args) => {
    const asA = await ctx.db
      .query("friendships")
      .withIndex("by_userA_status", (q) => q.eq("userA", args.userId))
      .collect();
    const asB = await ctx.db
      .query("friendships")
      .withIndex("by_userB_status", (q) => q.eq("userB", args.userId))
      .collect();
    const all = [...asA, ...asB];

    const friends: { friendshipId: Id<"friendships">; user: Doc<"users"> }[] =
      [];
    const incoming: { friendshipId: Id<"friendships">; user: Doc<"users"> }[] =
      [];
    const outgoing: { friendshipId: Id<"friendships">; user: Doc<"users"> }[] =
      [];

    for (const f of all) {
      const other = await ctx.db.get(otherUserId(f, args.userId));
      if (other === null) continue;
      const entry = { friendshipId: f._id, user: other };
      if (f.status === "accepted") {
        friends.push(entry);
      } else if (f.requesterId === args.userId) {
        outgoing.push(entry);
      } else {
        incoming.push(entry);
      }
    }

    const toSummary = (e: {
      friendshipId: Id<"friendships">;
      user: Doc<"users">;
    }) => ({
      friendshipId: e.friendshipId,
      user: {
        _id: e.user._id,
        firstName: e.user.firstName,
        lastName: e.user.lastName,
        phoneNumber: e.user.phoneNumber,
      },
    });

    return {
      friends: friends.map(toSummary),
      incoming: incoming.map(toSummary),
      outgoing: outgoing.map(toSummary),
    };
  },
});

export const sendRequest = mutation({
  args: {
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
  },
  returns: v.id("friendships"),
  handler: async (ctx, args) => {
    if (args.fromUserId === args.toUserId) {
      throw new ConvexError("You cannot send a friend request to yourself");
    }
    const from = await ctx.db.get(args.fromUserId);
    if (from === null) {
      throw new ConvexError("Sender does not exist");
    }
    const to = await ctx.db.get(args.toUserId);
    if (to === null) {
      throw new ConvexError("Recipient does not exist");
    }

    const existing = await findFriendship(ctx, args.fromUserId, args.toUserId);
    if (existing !== null) {
      if (existing.status === "accepted") {
        throw new ConvexError("You are already friends");
      }
      // Pending: if the other user previously sent a request, accept it;
      // otherwise we've already sent one.
      if (existing.requesterId === args.fromUserId) {
        throw new ConvexError("A friend request is already pending");
      }
      await ctx.db.patch(existing._id, {
        status: "accepted",
        acceptedAt: Date.now(),
      });
      return existing._id;
    }

    const { userA, userB } = orderPair(args.fromUserId, args.toUserId);
    return await ctx.db.insert("friendships", {
      userA,
      userB,
      requesterId: args.fromUserId,
      status: "pending",
    });
  },
});

export const acceptRequest = mutation({
  args: {
    userId: v.id("users"),
    friendshipId: v.id("friendships"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const friendship = await ctx.db.get(args.friendshipId);
    if (friendship === null) {
      throw new ConvexError("Friend request not found");
    }
    if (
      friendship.userA !== args.userId &&
      friendship.userB !== args.userId
    ) {
      throw new ConvexError("You are not a party to this friend request");
    }
    if (friendship.requesterId === args.userId) {
      throw new ConvexError("You cannot accept your own friend request");
    }
    if (friendship.status === "accepted") {
      throw new ConvexError("You are already friends");
    }
    await ctx.db.patch(args.friendshipId, {
      status: "accepted",
      acceptedAt: Date.now(),
    });
    return null;
  },
});

// Decline an incoming request, cancel an outgoing request, or unfriend.
// All three collapse to "delete the row" — the caller just needs to be a
// party to the friendship.
export const removeFriendship = mutation({
  args: {
    userId: v.id("users"),
    otherUserId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const friendship = await findFriendship(
      ctx,
      args.userId,
      args.otherUserId,
    );
    if (friendship === null) {
      throw new ConvexError("No friendship or request exists");
    }
    await ctx.db.delete(friendship._id);
    return null;
  },
});

// Same as removeFriendship but keyed by friendship id — convenient for UIs
// that already have the id in hand (e.g. "decline" or "cancel" buttons in
// a list of pending requests).
export const removeById = mutation({
  args: {
    userId: v.id("users"),
    friendshipId: v.id("friendships"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const friendship = await ctx.db.get(args.friendshipId);
    if (friendship === null) {
      throw new ConvexError("Friendship not found");
    }
    if (
      friendship.userA !== args.userId &&
      friendship.userB !== args.userId
    ) {
      throw new ConvexError("You are not a party to this friendship");
    }
    await ctx.db.delete(args.friendshipId);
    return null;
  },
});

export const sendRequestByPhone = mutation({
  args: {
    fromUserId: v.id("users"),
    phoneNumber: v.string(),
  },
  returns: v.id("friendships"),
  handler: async (ctx, args) => {
    const trimmed = args.phoneNumber.trim();
    if (trimmed.length === 0) {
      throw new ConvexError("Phone number is required");
    }

    const me = await ctx.db.get(args.fromUserId);
    if (me === null) {
      throw new ConvexError("Sender does not exist");
    }
    if (me.phoneNumber === trimmed) {
      throw new ConvexError("You cannot send a friend request to yourself");
    }

    const target = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", trimmed))
      .unique();
    if (target === null) {
      throw new ConvexError("No user exists with that phone number");
    }

    const existing = await findFriendship(ctx, args.fromUserId, target._id);
    if (existing !== null) {
      if (existing.status === "accepted") {
        throw new ConvexError("You are already friends");
      }
      if (existing.requesterId === args.fromUserId) {
        throw new ConvexError("A friend request is already pending");
      }
      await ctx.db.patch(existing._id, {
        status: "accepted",
        acceptedAt: Date.now(),
      });
      return existing._id;
    }

    const { userA, userB } = orderPair(args.fromUserId, target._id);
    return await ctx.db.insert("friendships", {
      userA,
      userB,
      requesterId: args.fromUserId,
      status: "pending",
    });
  },
});
