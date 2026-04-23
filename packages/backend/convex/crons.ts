import { cronJobs } from "convex/server";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";

// Lists every user that has at least one connected Google account. Used by the
// sync cron below to fan out syncUser calls. Users without a Google account
// have nothing to sync so they're skipped.
export const _listUsersWithGoogleAccounts = internalQuery({
  args: {},
  returns: v.array(v.id("users")),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("googleAccounts").collect();
    const seen = new Set<Id<"users">>();
    for (const a of accounts) seen.add(a.userId);
    return Array.from(seen);
  },
});

// Fires every five minutes. Iterates every user with a connected Google account
// and runs the same incremental sync the page fires on mount — picks up remote
// deletes, time changes, and new events without waiting for the user to reload
// or press R. Per-user errors are logged but don't stop the fan-out.
export const _syncAllUsers = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const userIds: Id<"users">[] = await ctx.runQuery(
      internal.crons._listUsersWithGoogleAccounts,
      {},
    );
    for (const userId of userIds) {
      try {
        await ctx.runAction(api.events.syncUser, { userId });
      } catch (err) {
        console.error(
          `cron syncUser failed for ${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return null;
  },
});

const crons = cronJobs();

crons.interval(
  "sync all users from Google Calendar",
  { minutes: 5 },
  internal.crons._syncAllUsers,
  {},
);

export default crons;
