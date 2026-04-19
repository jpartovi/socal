import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
    return await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber),
      )
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
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber),
      )
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
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber),
      )
      .unique();
    if (existing !== null) {
      throw new ConvexError("A user with that phone number already exists");
    }
    return await ctx.db.insert("users", {
      phoneNumber: args.phoneNumber,
      firstName: args.firstName,
      lastName: args.lastName,
      useDefaultAvatar: true,
    });
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
