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
});

export const getById = query({
  args: { userId: v.id("users") },
  returns: v.union(userDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
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
    });
  },
});
