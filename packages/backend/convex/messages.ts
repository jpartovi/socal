import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      body: v.string(),
      author: v.string(),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db.query("messages").order("desc").take(50);
  },
});

export const send = mutation({
  args: {
    body: v.string(),
    author: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      body: args.body,
      author: args.author,
    });
  },
});
