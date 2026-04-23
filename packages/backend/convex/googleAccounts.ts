import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type ReadCtx = QueryCtx | MutationCtx;

/** Prefer users.primaryGoogleAccountId; else first googleAccounts row for user. */
export async function resolvePrimaryGoogleAccountForUser(
  ctx: ReadCtx,
  userId: Id<"users">,
): Promise<Doc<"googleAccounts"> | null> {
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  const preferredId = user.primaryGoogleAccountId;
  if (preferredId !== undefined) {
    const acc = await ctx.db.get(preferredId);
    if (acc !== null && acc.userId === userId) {
      return acc;
    }
  }
  const accounts = await ctx.db
    .query("googleAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return accounts[0] ?? null;
}

const googleAccountSummary = v.object({
  _id: v.id("googleAccounts"),
  _creationTime: v.number(),
  email: v.string(),
  name: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
  connectedAt: v.number(),
});

const primaryGoogleAccountPublic = v.object({
  _id: v.id("googleAccounts"),
  email: v.string(),
  name: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
});

export const getPrimaryForUser = query({
  args: { userId: v.id("users") },
  returns: v.union(primaryGoogleAccountPublic, v.null()),
  handler: async (ctx, args) => {
    const acc = await resolvePrimaryGoogleAccountForUser(ctx, args.userId);
    if (acc === null) return null;
    return {
      _id: acc._id,
      email: acc.email,
      name: acc.name,
      pictureUrl: acc.pictureUrl,
    };
  },
});

export const setPrimaryGoogleAccount = mutation({
  args: {
    userId: v.id("users"),
    googleAccountId: v.union(v.id("googleAccounts"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new ConvexError("User not found");
    }
    if (args.googleAccountId === null) {
      await ctx.db.patch(args.userId, { primaryGoogleAccountId: undefined });
      return null;
    }
    const acc = await ctx.db.get(args.googleAccountId);
    if (acc === null || acc.userId !== args.userId) {
      throw new ConvexError("Google account not found for this user");
    }
    await ctx.db.patch(args.userId, {
      primaryGoogleAccountId: args.googleAccountId,
    });
    return null;
  },
});

export const listByUser = query({
  args: { userId: v.id("users") },
  returns: v.array(googleAccountSummary),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      email: r.email,
      name: r.name,
      pictureUrl: r.pictureUrl,
      connectedAt: r.connectedAt,
    }));
  },
});

export const upsertFromOAuth = mutation({
  args: {
    userId: v.id("users"),
    googleSub: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scope: v.string(),
  },
  returns: v.id("googleAccounts"),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new ConvexError("User does not exist");
    }

    const existing = await ctx.db
      .query("googleAccounts")
      .withIndex("by_google_sub", (q) => q.eq("googleSub", args.googleSub))
      .unique();

    if (existing !== null) {
      if (existing.userId !== args.userId) {
        throw new ConvexError(
          "This Google account is already connected to another socal user",
        );
      }
      const normalizedEmail = args.email.trim().toLowerCase();
      const patch: {
        email: string;
        name?: string;
        pictureUrl?: string;
        accessToken: string;
        accessTokenExpiresAt: number;
        scope: string;
        connectedAt: number;
        refreshToken?: string;
      } = {
        email: normalizedEmail,
        name: args.name,
        pictureUrl: args.pictureUrl,
        accessToken: args.accessToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        scope: args.scope,
        connectedAt: Date.now(),
      };
      // Google only returns a refresh token on first consent; don't clobber
      // an existing one with undefined on re-auth.
      if (args.refreshToken !== undefined) {
        patch.refreshToken = args.refreshToken;
      }
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    const normalizedEmail = args.email.trim().toLowerCase();
    const newId = await ctx.db.insert("googleAccounts", {
      userId: args.userId,
      googleSub: args.googleSub,
      email: normalizedEmail,
      name: args.name,
      pictureUrl: args.pictureUrl,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      scope: args.scope,
      connectedAt: Date.now(),
    });
    if (user.primaryGoogleAccountId === undefined) {
      await ctx.db.patch(args.userId, { primaryGoogleAccountId: newId });
    }
    return newId;
  },
});

// Internal: full account row for use by actions during token refresh.
export const _getById = internalQuery({
  args: { accountId: v.id("googleAccounts") },
  returns: v.union(
    v.object({
      _id: v.id("googleAccounts"),
      _creationTime: v.number(),
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
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accountId);
  },
});

// Internal: patch tokens after a refresh. Google does not re-issue refresh
// tokens on refresh, so refreshToken is optional here.
export const _updateTokens = internalMutation({
  args: {
    accountId: v.id("googleAccounts"),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshToken: v.optional(v.string()),
    scope: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: {
      accessToken: string;
      accessTokenExpiresAt: number;
      refreshToken?: string;
      scope?: string;
    } = {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
    };
    if (args.refreshToken !== undefined) patch.refreshToken = args.refreshToken;
    if (args.scope !== undefined) patch.scope = args.scope;
    await ctx.db.patch(args.accountId, patch);
    return null;
  },
});

export const disconnect = mutation({
  args: {
    userId: v.id("users"),
    accountId: v.id("googleAccounts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (account === null) {
      throw new ConvexError("Google account not found");
    }
    if (account.userId !== args.userId) {
      throw new ConvexError("This Google account belongs to a different user");
    }
    const calendars = await ctx.db
      .query("calendars")
      .withIndex("by_account", (q) =>
        q.eq("googleAccountId", args.accountId),
      )
      .collect();
    const user = await ctx.db.get(args.userId);
    if (user?.primaryGoogleAccountId === args.accountId) {
      await ctx.db.patch(args.userId, { primaryGoogleAccountId: undefined });
    }
    for (const cal of calendars) {
      await ctx.db.delete(cal._id);
    }
    await ctx.db.delete(args.accountId);
    return null;
  },
});
