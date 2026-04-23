import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { resolvePrimaryGoogleAccountForUser } from "./googleAccounts";
import { normalizePhone } from "./phone";

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
  photoUrl: v.union(v.string(), v.null()),
  inviteEmail: v.union(v.string(), v.null()),
});

const connectionEntry = v.object({
  friendshipId: v.id("friendships"),
  user: friendUserSummary,
});

const phoneInviteEntry = v.object({
  inviteId: v.id("phoneInvites"),
  phoneNumber: v.string(),
  name: v.union(v.string(), v.null()),
  invitedAt: v.number(),
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
    outgoingPhoneInvites: v.array(phoneInviteEntry),
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

    type RawEntry = {
      friendshipId: Id<"friendships">;
      user: Doc<"users">;
    };
    const friends: RawEntry[] = [];
    const incoming: RawEntry[] = [];
    const outgoing: RawEntry[] = [];

    for (const f of all) {
      const other = await ctx.db.get(otherUserId(f, args.userId));
      if (other === null) continue;
      const entry: RawEntry = { friendshipId: f._id, user: other };
      if (f.status === "accepted") {
        friends.push(entry);
      } else if (f.requesterId === args.userId) {
        outgoing.push(entry);
      } else {
        incoming.push(entry);
      }
    }

    const toSummary = async (e: RawEntry) => {
      let photoUrl = e.user.photoStorageId
        ? await ctx.storage.getUrl(e.user.photoStorageId)
        : null;
      const primaryForInvite = await resolvePrimaryGoogleAccountForUser(
        ctx,
        e.user._id,
      );
      if (photoUrl === null) {
        photoUrl = primaryForInvite?.pictureUrl ?? null;
      }
      if (photoUrl === null) {
        const googleAccount = await ctx.db
          .query("googleAccounts")
          .withIndex("by_user", (q) => q.eq("userId", e.user._id))
          .filter((q) => q.neq(q.field("pictureUrl"), undefined))
          .first();
        photoUrl = googleAccount?.pictureUrl ?? null;
      }
      return {
        friendshipId: e.friendshipId,
        user: {
          _id: e.user._id,
          firstName: e.user.firstName,
          lastName: e.user.lastName,
          phoneNumber: e.user.phoneNumber,
          photoUrl,
          inviteEmail: primaryForInvite?.email ?? null,
        },
      };
    };

    const phoneInvites = await ctx.db
      .query("phoneInvites")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .collect();

    return {
      friends: await Promise.all(friends.map(toSummary)),
      incoming: await Promise.all(incoming.map(toSummary)),
      outgoing: await Promise.all(outgoing.map(toSummary)),
      outgoingPhoneInvites: phoneInvites.map((p) => ({
        inviteId: p._id,
        phoneNumber: p.phoneNumber,
        name: p.name ?? null,
        invitedAt: p.invitedAt,
      })),
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

// Returns a discriminated status so the caller can distinguish "no user
// with that phone yet" (prompt for SMS invite) from real errors. When no
// user exists, also records a phoneInvite so the inviter sees the pending
// invite in their sidebar and so the friendship auto-resolves when the
// invitee eventually signs up.
export const sendRequestByPhone = mutation({
  args: {
    fromUserId: v.id("users"),
    phoneNumber: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      status: v.literal("sent"),
      friendshipId: v.id("friendships"),
    }),
    v.object({
      status: v.literal("accepted"),
      friendshipId: v.id("friendships"),
    }),
    v.object({ status: v.literal("already_pending") }),
    v.object({ status: v.literal("already_friends") }),
    v.object({
      status: v.literal("no_user"),
      inviteId: v.id("phoneInvites"),
    }),
  ),
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phoneNumber);

    const me = await ctx.db.get(args.fromUserId);
    if (me === null) {
      throw new ConvexError("Sender does not exist");
    }
    if (me.phoneNumber === phone) {
      throw new ConvexError("You cannot send a friend request to yourself");
    }

    const target = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", phone))
      .unique();
    if (target === null) {
      const existingInvite = await ctx.db
        .query("phoneInvites")
        .withIndex("by_from_user_and_phone", (q) =>
          q.eq("fromUserId", args.fromUserId).eq("phoneNumber", phone),
        )
        .unique();
      if (existingInvite !== null) {
        if (args.name !== undefined && existingInvite.name !== args.name) {
          await ctx.db.patch(existingInvite._id, { name: args.name });
        }
        return { status: "no_user" as const, inviteId: existingInvite._id };
      }
      const inviteId = await ctx.db.insert("phoneInvites", {
        fromUserId: args.fromUserId,
        phoneNumber: phone,
        name: args.name,
        invitedAt: Date.now(),
      });
      return { status: "no_user" as const, inviteId };
    }

    const existing = await findFriendship(ctx, args.fromUserId, target._id);
    if (existing !== null) {
      if (existing.status === "accepted") {
        return { status: "already_friends" as const };
      }
      if (existing.requesterId === args.fromUserId) {
        return { status: "already_pending" as const };
      }
      await ctx.db.patch(existing._id, {
        status: "accepted",
        acceptedAt: Date.now(),
      });
      return {
        status: "accepted" as const,
        friendshipId: existing._id,
      };
    }

    const { userA, userB } = orderPair(args.fromUserId, target._id);
    const friendshipId = await ctx.db.insert("friendships", {
      userA,
      userB,
      requesterId: args.fromUserId,
      status: "pending",
    });
    return { status: "sent" as const, friendshipId };
  },
});

export const cancelPhoneInvite = mutation({
  args: {
    userId: v.id("users"),
    inviteId: v.id("phoneInvites"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (invite === null) {
      throw new ConvexError("Invite not found");
    }
    if (invite.fromUserId !== args.userId) {
      throw new ConvexError("You did not send this invite");
    }
    await ctx.db.delete(args.inviteId);
    return null;
  },
});

// Called from users.create after a new user is inserted: converts any
// pending phoneInvites matching the new user's phone into real pending
// friendships (or accepts if two people invited each other), then deletes
// the invites.
export async function resolvePhoneInvitesForNewUser(
  ctx: MutationCtx,
  newUserId: Id<"users">,
  phoneNumber: string,
): Promise<number> {
  const invites = await ctx.db
    .query("phoneInvites")
    .withIndex("by_phone_number", (q) => q.eq("phoneNumber", phoneNumber))
    .collect();
  let converted = 0;
  for (const invite of invites) {
    if (invite.fromUserId === newUserId) {
      await ctx.db.delete(invite._id);
      continue;
    }
    const existing = await ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => {
        const { userA, userB } = orderPair(invite.fromUserId, newUserId);
        return q.eq("userA", userA).eq("userB", userB);
      })
      .unique();
    if (existing === null) {
      const { userA, userB } = orderPair(invite.fromUserId, newUserId);
      await ctx.db.insert("friendships", {
        userA,
        userB,
        requesterId: invite.fromUserId,
        status: "pending",
      });
      converted++;
    }
    await ctx.db.delete(invite._id);
  }
  return converted;
}

// Are these two users accepted friends? Sharing follows directly from
// friendship — if yes, their calendars are mutually visible to each other's
// agent. Returns true for the self case so callers can pass viewer/owner
// without a special case.
export const areFriends = query({
  args: {
    viewerId: v.id("users"),
    ownerId: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (args.viewerId === args.ownerId) return true;
    const friendship = await findFriendship(
      ctx,
      args.viewerId,
      args.ownerId,
    );
    return friendship !== null && friendship.status === "accepted";
  },
});

// Exposed for manual/admin use — regular resolution happens inside
// users.create via the helper above.
export const _resolvePhoneInvites = internalMutation({
  args: { userId: v.id("users") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) return 0;
    return await resolvePhoneInvitesForNewUser(
      ctx,
      args.userId,
      user.phoneNumber,
    );
  },
});
