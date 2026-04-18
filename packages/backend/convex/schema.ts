import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phoneNumber: v.string(),
    firstName: v.string(),
    lastName: v.string(),
  }).index("by_phone_number", ["phoneNumber"]),

  // Bidirectional friendships. Each pair is stored exactly once with ids in
  // lexicographic order (userA < userB) so that lookups never need to query
  // both directions. `requesterId` tracks who sent the request; the other
  // user must accept before `status` flips to "accepted".
  friendships: defineTable({
    userA: v.id("users"),
    userB: v.id("users"),
    requesterId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_pair", ["userA", "userB"])
    .index("by_userA_status", ["userA", "status"])
    .index("by_userB_status", ["userB", "status"]),

  // Google accounts connected to a socal user. A single user may connect
  // multiple Google accounts. `googleSub` is Google's stable unique identifier
  // for the account and is what we dedupe on. OAuth tokens are stored here so
  // server-side actions can call the Google Calendar API on the user's behalf.
  googleAccounts: defineTable({
    userId: v.id("users"),
    googleSub: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scope: v.string(),
    connectedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_google_sub", ["googleSub"])
    .index("by_user_and_google_sub", ["userId", "googleSub"]),
});
