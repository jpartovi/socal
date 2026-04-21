import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { resolvePrimaryGoogleAccountForUser } from "./googleAccounts";
import { getValidAccessToken } from "./googleTokens";

type ReadCtx = QueryCtx | MutationCtx;

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

/**
 * Writable calendar for creating events: primary calendar with owner/writer on a Google account.
 * - Default Google account: users.primaryGoogleAccountId (set on first connect; user can change in
 *   Calendar accounts), else legacy fallback to first connected account — see resolvePrimaryGoogleAccountForUser.
 * - Default calendar on that account: always derived (isPrimary + write access), never stored.
 * Optional accountEmail targets a specific connected account by address instead of the default account.
 */
export const writableCalendarForUser = query({
  args: {
    userId: v.id("users"),
    accountEmail: v.optional(v.string()),
  },
  returns: v.union(calendarDoc, v.null()),
  handler: async (ctx, args) => {
    const trimmed = args.accountEmail?.trim();
    if (trimmed) {
      const want = normalizeAccountEmail(trimmed);
      if (!want) return null;
      const accounts = await ctx.db
        .query("googleAccounts")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      const acc = accounts.find(
        (a) => normalizeAccountEmail(a.email) === want,
      );
      if (acc === undefined) return null;
      return await primaryWritableCalendarOnAccount(ctx, acc._id);
    }
    return await resolvePrimaryGoogleAccountCalendar(ctx, args.userId);
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

function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Primary calendar row with write access for this Google account (derived, not user-stored). */
async function primaryWritableCalendarOnAccount(
  ctx: ReadCtx,
  googleAccountId: Id<"googleAccounts">,
): Promise<Doc<"calendars"> | null> {
  const cals = await ctx.db
    .query("calendars")
    .withIndex("by_account", (q) => q.eq("googleAccountId", googleAccountId))
    .collect();
  return (
    cals.find(
      (c) =>
        c.isPrimary &&
        (c.accessRole === "owner" || c.accessRole === "writer"),
    ) ?? null
  );
}

/** Default writable calendar for the user's starred Google account, else first connected account. */
async function resolvePrimaryGoogleAccountCalendar(
  ctx: ReadCtx,
  userId: Id<"users">,
): Promise<Doc<"calendars"> | null> {
  const primaryAcc = await resolvePrimaryGoogleAccountForUser(ctx, userId);
  if (primaryAcc !== null) {
    const cal = await primaryWritableCalendarOnAccount(ctx, primaryAcc._id);
    if (cal) return cal;
  }
  const accounts = await ctx.db
    .query("googleAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const acc of accounts) {
    if (primaryAcc !== null && acc._id === primaryAcc._id) continue;
    const cal = await primaryWritableCalendarOnAccount(ctx, acc._id);
    if (cal) return cal;
  }
  return null;
}
