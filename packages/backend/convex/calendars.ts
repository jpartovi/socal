import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getValidAccessToken } from "./googleTokens";

const accessRole = v.union(
  v.literal("owner"),
  v.literal("writer"),
  v.literal("reader"),
  v.literal("freeBusyReader"),
);

const calendarDoc = v.object({
  _id: v.id("calendars"),
  _creationTime: v.number(),
  googleAccountId: v.id("googleAccounts"),
  googleCalendarId: v.string(),
  summary: v.string(),
  summaryOverride: v.optional(v.string()),
  description: v.optional(v.string()),
  accessRole,
  backgroundColor: v.string(),
  foregroundColor: v.string(),
  colorOverride: v.optional(v.string()),
  isPrimary: v.boolean(),
  isEnabled: v.boolean(),
  hiddenFromList: v.optional(v.boolean()),
  timeZone: v.optional(v.string()),
  syncToken: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
});

export const listByAccount = query({
  args: { googleAccountId: v.id("googleAccounts") },
  returns: v.array(calendarDoc),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("calendars")
      .withIndex("by_account", (q) =>
        q.eq("googleAccountId", args.googleAccountId),
      )
      .collect();
  },
});

// Default writable calendar for quick-create flows: the primary calendar of
// the user's first Google account, provided it's writable. Returns null if
// the user has no writable primary calendar.
export const defaultWritable = query({
  args: { userId: v.id("users") },
  returns: v.union(v.id("calendars"), v.null()),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const acc of accounts) {
      const cals = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", acc._id))
        .collect();
      const primary = cals.find(
        (c) =>
          c.isPrimary &&
          (c.accessRole === "owner" || c.accessRole === "writer"),
      );
      if (primary) return primary._id;
    }
    return null;
  },
});

// Internal: every enabled calendar across all of this user's connected
// Google accounts. Used by events.syncUser to know what to pull.
export const _listEnabledForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      _id: v.id("calendars"),
      googleAccountId: v.id("googleAccounts"),
      googleCalendarId: v.string(),
      syncToken: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const out = [];
    for (const acc of accounts) {
      const cals = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", acc._id))
        .collect();
      for (const c of cals) {
        if (c.isEnabled) {
          out.push({
            _id: c._id,
            googleAccountId: c.googleAccountId,
            googleCalendarId: c.googleCalendarId,
            syncToken: c.syncToken,
          });
        }
      }
    }
    return out;
  },
});

export const setEnabled = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    isEnabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (cal === null) {
      throw new ConvexError("Calendar not found");
    }
    const account = await ctx.db.get(cal.googleAccountId);
    if (account === null || account.userId !== args.userId) {
      throw new ConvexError("You do not own this calendar");
    }
    await ctx.db.patch(args.calendarId, { isEnabled: args.isEnabled });
    return null;
  },
});

export const setHiddenFromList = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    hiddenFromList: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertOwnsCalendar(ctx, args.userId, args.calendarId);
    await ctx.db.patch(args.calendarId, {
      hiddenFromList: args.hiddenFromList,
    });
    return null;
  },
});

export const setColorOverride = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    colorOverride: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertOwnsCalendar(ctx, args.userId, args.calendarId);
    if (
      args.colorOverride !== null &&
      !/^#[0-9a-fA-F]{6}$/.test(args.colorOverride)
    ) {
      throw new ConvexError("Color must be a hex value");
    }
    await ctx.db.patch(args.calendarId, {
      colorOverride: args.colorOverride ?? undefined,
    });
    return null;
  },
});

export const displayOnly = mutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertOwnsCalendar(ctx, args.userId, args.calendarId);
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const account of accounts) {
      const siblings = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", account._id))
        .collect();
      for (const sibling of siblings) {
        await ctx.db.patch(sibling._id, {
          isEnabled: sibling._id === args.calendarId,
        });
      }
    }
    return null;
  },
});

export const unsubscribe = action({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cal = await ctx.runQuery(internal.calendars._getOwnedForUnsubscribe, {
      userId: args.userId,
      calendarId: args.calendarId,
    });
    if (cal === null) {
      throw new Error("Calendar not found");
    }
    if (cal.isPrimary) {
      throw new Error("Primary calendars cannot be unsubscribed");
    }

    const token = await getValidAccessToken(ctx, cal.googleAccountId);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(
        cal.googleCalendarId,
      )}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      throw new Error(
        `calendarList.delete failed: ${res.status} ${await res.text()}`,
      );
    }

    await ctx.runMutation(internal.calendars._deleteCalendarAfterUnsubscribe, {
      userId: args.userId,
      calendarId: args.calendarId,
    });
    return null;
  },
});

type CalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  timeZone?: string;
  deleted?: boolean;
  hidden?: boolean;
};

type CalendarListResponse = {
  items?: CalendarListEntry[];
  nextPageToken?: string;
};

// Public action: call this after OAuth (or when the user clicks Refresh) to
// populate/refresh the list of calendars for a Google account.
export const discoverForAccount = action({
  args: { googleAccountId: v.id("googleAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await getValidAccessToken(ctx, args.googleAccountId);

    const entries: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      );
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showHidden", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `calendarList.list failed: ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as CalendarListResponse;
      if (body.items) entries.push(...body.items);
      pageToken = body.nextPageToken;
    } while (pageToken);

    await ctx.runMutation(internal.calendars._syncAccountCalendars, {
      googleAccountId: args.googleAccountId,
      entries: entries
        .filter((e) => !e.deleted)
        .map((e) => ({
          googleCalendarId: e.id,
          summary: e.summary ?? e.id,
          summaryOverride: e.summaryOverride,
          description: e.description,
          accessRole: e.accessRole,
          backgroundColor: e.backgroundColor ?? "#4285F4",
          foregroundColor: e.foregroundColor ?? "#000000",
          isPrimary: e.primary === true,
          timeZone: e.timeZone,
        })),
    });
    return null;
  },
});

// Internal: reconcile a full calendarList.list response with our table in a
// single transaction. New entries default isEnabled=true for primary only.
// Existing rows keep their isEnabled but refresh everything else. Rows not
// present in `entries` are deleted.
export const _syncAccountCalendars = internalMutation({
  args: {
    googleAccountId: v.id("googleAccounts"),
    entries: v.array(
      v.object({
        googleCalendarId: v.string(),
        summary: v.string(),
        summaryOverride: v.optional(v.string()),
        description: v.optional(v.string()),
        accessRole,
        backgroundColor: v.string(),
        foregroundColor: v.string(),
        isPrimary: v.boolean(),
        timeZone: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendars")
      .withIndex("by_account", (q) =>
        q.eq("googleAccountId", args.googleAccountId),
      )
      .collect();
    const byCalId = new Map(existing.map((c) => [c.googleCalendarId, c]));
    const seen = new Set<string>();

    for (const e of args.entries) {
      seen.add(e.googleCalendarId);
      const prev = byCalId.get(e.googleCalendarId);
      if (prev) {
        await ctx.db.patch(prev._id, {
          summary: e.summary,
          summaryOverride: e.summaryOverride,
          description: e.description,
          accessRole: e.accessRole,
          backgroundColor: e.backgroundColor,
          foregroundColor: e.foregroundColor,
          isPrimary: e.isPrimary,
          timeZone: e.timeZone,
        });
      } else {
        await ctx.db.insert("calendars", {
          googleAccountId: args.googleAccountId,
          googleCalendarId: e.googleCalendarId,
          summary: e.summary,
          summaryOverride: e.summaryOverride,
          description: e.description,
          accessRole: e.accessRole,
          backgroundColor: e.backgroundColor,
          foregroundColor: e.foregroundColor,
          isPrimary: e.isPrimary,
          isEnabled: e.isPrimary,
          timeZone: e.timeZone,
        });
      }
    }

    for (const prev of existing) {
      if (!seen.has(prev.googleCalendarId)) {
        await ctx.db.delete(prev._id);
      }
    }
    return null;
  },
});

export const _getOwnedForUnsubscribe = internalQuery({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
  },
  returns: v.union(
    v.null(),
    v.object({
      googleAccountId: v.id("googleAccounts"),
      googleCalendarId: v.string(),
      isPrimary: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (cal === null) return null;
    const account = await ctx.db.get(cal.googleAccountId);
    if (account === null || account.userId !== args.userId) return null;
    return {
      googleAccountId: cal.googleAccountId,
      googleCalendarId: cal.googleCalendarId,
      isPrimary: cal.isPrimary,
    };
  },
});

export const _deleteCalendarAfterUnsubscribe = internalMutation({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertOwnsCalendar(ctx, args.userId, args.calendarId);
    const events = await ctx.db
      .query("events")
      .withIndex("by_calendar", (q) => q.eq("calendarId", args.calendarId))
      .collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }
    await ctx.db.delete(args.calendarId);
    return null;
  },
});

async function assertOwnsCalendar(
  ctx: MutationCtx,
  userId: Id<"users">,
  calendarId: Id<"calendars">,
) {
  const cal = await ctx.db.get(calendarId);
  if (cal === null) {
    throw new ConvexError("Calendar not found");
  }
  const account = await ctx.db.get(cal.googleAccountId);
  if (account === null || account.userId !== userId) {
    throw new ConvexError("You do not own this calendar");
  }
  return cal;
}
