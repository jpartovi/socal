import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolvePhoneInvitesForNewUser } from "./friendships";
import { normalizePhone } from "./phone";

// TODO: replace with Twilio Verify. Any phone accepts this stub code for now.
const STUB_CODE = "000000";

const userDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  phoneNumber: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  photoStorageId: v.optional(v.id("_storage")),
  useDefaultAvatar: v.optional(v.boolean()),
  timeZone: v.optional(v.string()),
});

const userWithPhotoUrl = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  phoneNumber: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  photoStorageId: v.optional(v.id("_storage")),
  useDefaultAvatar: v.optional(v.boolean()),
  timeZone: v.optional(v.string()),
  photoUrl: v.union(v.string(), v.null()),
});

export const getById = query({
  args: { userId: v.id("users") },
  returns: v.union(userWithPhotoUrl, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    const photoUrl = user.photoStorageId
      ? await ctx.storage.getUrl(user.photoStorageId)
      : null;
    return { ...user, photoUrl };
  },
});

export const getByPhone = query({
  args: { phoneNumber: v.string() },
  returns: v.union(userDoc, v.null()),
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phoneNumber);
    return await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", phone))
      .unique();
  },
});

export const verifyCode = mutation({
  args: {
    phoneNumber: v.string(),
    code: v.string(),
  },
  returns: v.object({
    user: v.union(userDoc, v.null()),
  }),
  handler: async (ctx, args) => {
    if (args.code !== STUB_CODE) {
      throw new ConvexError("Invalid code");
    }
    const phone = normalizePhone(args.phoneNumber);
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", phone))
      .unique();
    return { user };
  },
});

export const create = mutation({
  args: {
    phoneNumber: v.string(),
    firstName: v.string(),
    lastName: v.string(),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phoneNumber);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) => q.eq("phoneNumber", phone))
      .unique();
    if (existing !== null) {
      throw new ConvexError("A user with that phone number already exists");
    }
    const userId = await ctx.db.insert("users", {
      phoneNumber: phone,
      firstName: args.firstName,
      lastName: args.lastName,
      useDefaultAvatar: true,
    });
    await resolvePhoneInvitesForNewUser(ctx, userId, phone);
    return userId;
  },
});

export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: {
      firstName?: string;
      lastName?: string;
      timeZone?: string;
    } = {};
    if (args.firstName !== undefined) {
      const trimmed = args.firstName.trim();
      if (!trimmed) throw new ConvexError("First name cannot be empty");
      patch.firstName = trimmed;
    }
    if (args.lastName !== undefined) {
      const trimmed = args.lastName.trim();
      if (!trimmed) throw new ConvexError("Last name cannot be empty");
      patch.lastName = trimmed;
    }
    if (args.timeZone !== undefined) {
      patch.timeZone = args.timeZone;
    }
    await ctx.db.patch(args.userId, patch);
    return null;
  },
});

export const generatePhotoUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// One-off migration: re-normalize phoneNumber on every existing user and
// phoneInvite. Safe to run multiple times. Logs (and skips) any rows whose
// phone can't be normalized (e.g. unrecognized format) or whose normalized
// form would collide with another user already in the table.
//
// Invoke via: `npx convex run users:normalizeExistingPhones`.
export const normalizeExistingPhones = mutation({
  args: {},
  returns: v.object({
    usersUpdated: v.number(),
    usersSkipped: v.number(),
    invitesUpdated: v.number(),
    invitesSkipped: v.number(),
  }),
  handler: async (ctx) => {
    let usersUpdated = 0;
    let usersSkipped = 0;
    let invitesUpdated = 0;
    let invitesSkipped = 0;

    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      let normalized: string;
      try {
        normalized = normalizePhone(u.phoneNumber);
      } catch (err) {
        console.warn(
          `normalizeExistingPhones: cannot normalize user ${u._id} phone=${u.phoneNumber}: ${(err as Error).message}`,
        );
        usersSkipped++;
        continue;
      }
      if (normalized === u.phoneNumber) continue;
      const collision = await ctx.db
        .query("users")
        .withIndex("by_phone_number", (q) =>
          q.eq("phoneNumber", normalized),
        )
        .unique();
      if (collision !== null && collision._id !== u._id) {
        console.warn(
          `normalizeExistingPhones: skipping user ${u._id} — ${normalized} already owned by ${collision._id}`,
        );
        usersSkipped++;
        continue;
      }
      await ctx.db.patch(u._id, { phoneNumber: normalized });
      usersUpdated++;
    }

    const invites = await ctx.db.query("phoneInvites").collect();
    for (const inv of invites) {
      let normalized: string;
      try {
        normalized = normalizePhone(inv.phoneNumber);
      } catch (err) {
        console.warn(
          `normalizeExistingPhones: cannot normalize invite ${inv._id} phone=${inv.phoneNumber}: ${(err as Error).message}`,
        );
        invitesSkipped++;
        continue;
      }
      if (normalized === inv.phoneNumber) continue;
      await ctx.db.patch(inv._id, { phoneNumber: normalized });
      invitesUpdated++;
    }

    return { usersUpdated, usersSkipped, invitesUpdated, invitesSkipped };
  },
});

export const setPhoto = mutation({
  args: {
    userId: v.id("users"),
    storageId: v.union(v.id("_storage"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("User not found");
    if (user.photoStorageId && user.photoStorageId !== args.storageId) {
      await ctx.storage.delete(user.photoStorageId);
    }
    await ctx.db.patch(args.userId, {
      photoStorageId: args.storageId ?? undefined,
      useDefaultAvatar: args.storageId !== null,
    });
    return null;
  },
});
