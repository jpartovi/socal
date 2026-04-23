import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getValidAccessToken } from "./googleTokens";

// Initial-pull window: we grab a band around "now" so first paint is fast.
// Afterwards Google returns a syncToken and we only fetch deltas.
const INITIAL_PAST_DAYS = 14;
const INITIAL_FUTURE_DAYS = 90;

// Upper bound on the length of any single calendar event. Used by
// listForUserInRange to keep the "does this event overlap the window?"
// lookup bounded to an indexed range query. Events longer than this will
// be missed by overlap checks; bump if that ever becomes a real concern.
const MAX_EVENT_SPAN_MS = 366 * 24 * 60 * 60 * 1000;

const eventStatus = v.union(
  v.literal("confirmed"),
  v.literal("tentative"),
  v.literal("cancelled"),
);

const eventKind = v.union(
  v.literal("event"),
  v.literal("workingLocation"),
  v.literal("task"),
);

const attendeeResponseStatus = v.union(
  v.literal("needsAction"),
  v.literal("declined"),
  v.literal("tentative"),
  v.literal("accepted"),
);

const rawAttendee = v.object({
  email: v.string(),
  displayName: v.optional(v.string()),
  responseStatus: v.optional(attendeeResponseStatus),
  self: v.optional(v.boolean()),
  organizer: v.optional(v.boolean()),
});

const resolvedAttendee = v.object({
  email: v.string(),
  displayName: v.optional(v.string()),
  responseStatus: v.optional(attendeeResponseStatus),
  self: v.optional(v.boolean()),
  organizer: v.optional(v.boolean()),
  photoUrl: v.optional(v.string()),
  socalUserId: v.optional(v.id("users")),
});

const eventDoc = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  calendarId: v.id("calendars"),
  googleEventId: v.string(),
  summary: v.string(),
  description: v.optional(v.string()),
  location: v.optional(v.string()),
  start: v.number(),
  end: v.number(),
  allDay: v.boolean(),
  status: eventStatus,
  htmlLink: v.optional(v.string()),
  updatedAt: v.number(),
  colorOverride: v.optional(v.string()),
  colorId: v.optional(v.string()),
  eventKind: v.optional(eventKind),
  // Enriched at query time with photo + socalUserId joined from googleAccounts.
  attendees: v.optional(v.array(resolvedAttendee)),
});

const calendarAccessRole = v.union(
  v.literal("owner"),
  v.literal("writer"),
  v.literal("reader"),
  v.literal("freeBusyReader"),
);

const eventWithCalendar = v.object({
  event: eventDoc,
  calendar: v.object({
    _id: v.id("calendars"),
    summary: v.string(),
    summaryOverride: v.optional(v.string()),
    backgroundColor: v.string(),
    foregroundColor: v.string(),
    googleAccountId: v.id("googleAccounts"),
    googleAccountName: v.optional(v.string()),
    googleAccountEmail: v.string(),
    accessRole: calendarAccessRole,
  }),
});

type ResolvedAttendee = {
  email: string;
  displayName?: string;
  responseStatus?:
    | "needsAction"
    | "declined"
    | "tentative"
    | "accepted";
  self?: boolean;
  organizer?: boolean;
  photoUrl?: string;
  socalUserId?: Id<"users">;
};

export const listForUserInRange = query({
  args: {
    userId: v.id("users"),
    start: v.number(),
    end: v.number(),
  },
  returns: v.array(eventWithCalendar),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const rawEvents: Array<{
      event: Doc<"events">;
      calendar: {
        _id: Id<"calendars">;
        summary: string;
        summaryOverride?: string;
        backgroundColor: string;
        foregroundColor: string;
        googleAccountId: Id<"googleAccounts">;
        googleAccountName?: string;
        googleAccountEmail: string;
        accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
      };
    }> = [];

    for (const acc of accounts) {
      const cals = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", acc._id))
        .collect();
      for (const cal of cals) {
        if (!cal.isEnabled) continue;
        // True overlap semantics: return events where [event.start, event.end)
        // intersects [args.start, args.end) — i.e. start < windowEnd AND
        // end > windowStart. Convex indexes only support a range on the last
        // key, so we can't express both constraints in a single index lookup.
        // Instead we bound the start range by MAX_EVENT_SPAN_MS (events
        // longer than a year are exceedingly rare in a calendar app) and
        // filter by end > windowStart in memory. Bump the constant if a
        // multi-year event ever gets missed.
        const evts = await ctx.db
          .query("events")
          .withIndex("by_calendar_and_start", (q) =>
            q
              .eq("calendarId", cal._id)
              .gte("start", args.start - MAX_EVENT_SPAN_MS)
              .lt("start", args.end),
          )
          .collect();
        for (const ev of evts) {
          if (ev.status === "cancelled") continue;
          if (ev.end <= args.start) continue;
          rawEvents.push({
            event: ev,
            calendar: {
              _id: cal._id,
              summary: cal.summary,
              summaryOverride: cal.summaryOverride,
              backgroundColor: cal.colorOverride ?? cal.backgroundColor,
              foregroundColor: cal.foregroundColor,
              googleAccountId: cal.googleAccountId,
              googleAccountName: acc.name,
              googleAccountEmail: acc.email,
              accessRole: cal.accessRole,
            },
          });
        }
      }
    }

    // Resolve attendee photos: email → googleAccount → (pictureUrl, userId)
    // → user.photoStorageId → signed URL. Socal's own stored photo wins over
    // the Google avatar when both exist so the picture matches what the user
    // sees elsewhere in the app.
    const emails = new Set<string>();
    for (const { event } of rawEvents) {
      if (!event.attendees) continue;
      for (const a of event.attendees) emails.add(a.email.toLowerCase());
    }

    const resolved = new Map<
      string,
      { photoUrl?: string; socalUserId?: Id<"users"> }
    >();
    for (const email of emails) {
      const acc = await ctx.db
        .query("googleAccounts")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (!acc) {
        resolved.set(email, {});
        continue;
      }
      const user = await ctx.db.get(acc.userId);
      let photoUrl: string | undefined;
      if (user?.photoStorageId && !user.useDefaultAvatar) {
        const url = await ctx.storage.getUrl(user.photoStorageId);
        if (url) photoUrl = url;
      }
      if (!photoUrl && acc.pictureUrl) photoUrl = acc.pictureUrl;
      resolved.set(email, { photoUrl, socalUserId: acc.userId });
    }

    const results = rawEvents.map(({ event, calendar }) => {
      let enrichedAttendees: ResolvedAttendee[] | undefined;
      if (event.attendees && event.attendees.length > 0) {
        enrichedAttendees = event.attendees.map((a) => {
          const r = resolved.get(a.email.toLowerCase()) ?? {};
          return {
            email: a.email,
            displayName: a.displayName,
            responseStatus: a.responseStatus,
            self: a.self,
            organizer: a.organizer,
            photoUrl: r.photoUrl,
            socalUserId: r.socalUserId,
          };
        });
      }
      return {
        event: { ...event, attendees: enrichedAttendees },
        calendar,
      };
    });

    results.sort((a, b) => a.event.start - b.event.start);
    return results;
  },
});

// Top-N words pulled from the user's own event titles over the last ~180 days.
// Fed into the draft-event "what?" autofill so the suggestions reflect how THIS
// user actually names things (e.g. "standup", "1:1", "Barry's"). Short stop-
// words (a/the/on/with/etc.) are filtered so completions are substantive.
const COMMON_WORDS_LOOKBACK_DAYS = 180;
const COMMON_WORDS_TOP_N = 100;
const COMMON_WORD_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "will",
  "your",
  "you",
  "are",
  "was",
  "has",
  "have",
  "our",
  "out",
  "via",
  "new",
  "not",
]);

export const commonSummaryWords = query({
  args: { userId: v.id("users") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - COMMON_WORDS_LOOKBACK_DAYS * 86400_000;
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const freq = new Map<string, number>();
    for (const acc of accounts) {
      const cals = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", acc._id))
        .collect();
      for (const cal of cals) {
        const evts = await ctx.db
          .query("events")
          .withIndex("by_calendar_and_start", (q) =>
            q.eq("calendarId", cal._id).gte("start", cutoff),
          )
          .collect();
        for (const ev of evts) {
          if (ev.status === "cancelled") continue;
          for (const token of ev.summary.toLowerCase().split(/[^a-z0-9']+/)) {
            if (token.length < 3) continue;
            if (COMMON_WORD_STOPWORDS.has(token)) continue;
            freq.set(token, (freq.get(token) ?? 0) + 1);
          }
        }
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, COMMON_WORDS_TOP_N)
      .map(([word]) => word);
  },
});

// The N most recent events the signed-in user was invited to (by anyone).
// "Invited to" = user is an attendee but not the organizer. Ordered by the
// event row's creation time (proxy for "when the invite arrived in your
// calendar"), newest first. If the organizer happens to be another socal
// user we enrich with their photo/name; otherwise we fall back to the
// Google-reported displayName/email.
const NOTIFICATIONS_LIMIT = 4;

export const listRecentInvitesForUser = query({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      eventId: v.id("events"),
      calendarId: v.id("calendars"),
      summary: v.string(),
      start: v.number(),
      end: v.number(),
      allDay: v.boolean(),
      status: eventStatus,
      responseStatus: v.optional(attendeeResponseStatus),
      invitedAt: v.number(),
      organizerName: v.optional(v.string()),
      organizerEmail: v.optional(v.string()),
      organizerPhotoUrl: v.optional(v.string()),
      calendarColor: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (accounts.length === 0) return [];

    type Row = {
      eventId: Id<"events">;
      calendarId: Id<"calendars">;
      summary: string;
      start: number;
      end: number;
      allDay: boolean;
      status: "confirmed" | "tentative" | "cancelled";
      responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
      invitedAt: number;
      organizerEmail: string;
      organizerName?: string;
      calendarColor: string;
    };
    const rows: Row[] = [];

    for (const acc of accounts) {
      const cals = await ctx.db
        .query("calendars")
        .withIndex("by_account", (q) => q.eq("googleAccountId", acc._id))
        .collect();
      for (const cal of cals) {
        const evts = await ctx.db
          .query("events")
          .withIndex("by_calendar", (q) => q.eq("calendarId", cal._id))
          .collect();
        for (const ev of evts) {
          if (!ev.attendees) continue;
          const selfAttendee = ev.attendees.find((a) => a.self === true);
          if (!selfAttendee) continue;
          if (selfAttendee.organizer === true) continue;
          const organizer = ev.attendees.find((a) => a.organizer === true);
          if (!organizer) continue;
          rows.push({
            eventId: ev._id,
            calendarId: cal._id,
            summary: ev.summary,
            start: ev.start,
            end: ev.end,
            allDay: ev.allDay,
            status: ev.status,
            responseStatus: selfAttendee.responseStatus,
            invitedAt: ev._creationTime,
            organizerEmail: organizer.email.toLowerCase(),
            organizerName: organizer.displayName,
            calendarColor: cal.colorOverride ?? cal.backgroundColor,
          });
        }
      }
    }

    rows.sort((a, b) => b.invitedAt - a.invitedAt);
    const top = rows.slice(0, NOTIFICATIONS_LIMIT);

    // Resolve organizer photo/name for the few rows we'll actually render.
    const out: Array<Row & { organizerPhotoUrl?: string }> = [];
    for (const row of top) {
      const orgAcc = await ctx.db
        .query("googleAccounts")
        .withIndex("by_email", (q) => q.eq("email", row.organizerEmail))
        .first();
      let organizerName = row.organizerName;
      let organizerPhotoUrl: string | undefined;
      if (orgAcc !== null) {
        const orgUser = await ctx.db.get(orgAcc.userId);
        if (orgUser?.photoStorageId && !orgUser.useDefaultAvatar) {
          const url = await ctx.storage.getUrl(orgUser.photoStorageId);
          if (url) organizerPhotoUrl = url;
        }
        if (!organizerPhotoUrl && orgAcc.pictureUrl) {
          organizerPhotoUrl = orgAcc.pictureUrl;
        }
        if (!organizerName && orgUser !== null) {
          const full = `${orgUser.firstName} ${orgUser.lastName}`.trim();
          if (full) organizerName = full;
        }
        if (!organizerName) organizerName = orgAcc.name;
      }
      out.push({ ...row, organizerName, organizerPhotoUrl });
    }

    return out;
  },
});

// --- Sync --------------------------------------------------------------

type GoogleEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

type GoogleAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
};

type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  htmlLink?: string;
  updated?: string;
  attendees?: GoogleAttendee[];
  eventType?: string;
  colorId?: string;
};

type EventsListResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type NormalizedAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  organizer?: boolean;
};

type NormalizedEvent = {
  googleEventId: string;
  summary: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  updatedAt: number;
  eventKind: "event" | "workingLocation" | "task";
  attendees?: NormalizedAttendee[];
  colorId?: string;
};

type EventChange =
  | { kind: "upsert"; event: NormalizedEvent }
  | { kind: "delete"; googleEventId: string };

function parseTime(t: GoogleEventTime | undefined): {
  ms: number;
  allDay: boolean;
} {
  if (!t) return { ms: 0, allDay: false };
  if (t.dateTime) {
    return { ms: new Date(t.dateTime).getTime(), allDay: false };
  }
  if (t.date) {
    // `date` is YYYY-MM-DD with no timezone. Anchor to midnight UTC so the
    // date itself survives regardless of viewer timezone.
    return { ms: new Date(`${t.date}T00:00:00Z`).getTime(), allDay: true };
  }
  return { ms: 0, allDay: false };
}

function normalize(
  ev: GoogleEvent,
  meta: { googleCalendarId: string; calendarSummary: string },
): EventChange | null {
  if (!ev.id) return null;
  if (ev.status === "cancelled" && !ev.summary && !ev.start && !ev.end) {
    return { kind: "delete", googleEventId: ev.id };
  }
  const start = parseTime(ev.start);
  const end = parseTime(ev.end);
  // Keep only real attendees with emails (Google may include resource rows
  // for conference rooms and equipment; skip those).
  const attendees = ev.attendees
    ?.filter((a): a is GoogleAttendee & { email: string } =>
      !!a.email && !a.resource,
    )
    .map<NormalizedAttendee>((a) => ({
      email: a.email.toLowerCase(),
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
      organizer: a.organizer,
    }));
  return {
    kind: "upsert",
    event: {
      googleEventId: ev.id,
      summary: ev.summary ?? "(no title)",
      description: ev.description,
      location: ev.location,
      start: start.ms,
      end: end.ms || start.ms,
      allDay: start.allDay,
      status: ev.status ?? "confirmed",
      htmlLink: ev.htmlLink,
      updatedAt: ev.updated ? new Date(ev.updated).getTime() : Date.now(),
      eventKind: normalizeEventKind(ev, meta),
      attendees: attendees && attendees.length > 0 ? attendees : undefined,
      colorId: ev.colorId,
    },
  };
}

function normalizeEventKind(
  ev: GoogleEvent,
  meta: { googleCalendarId: string; calendarSummary: string },
): "event" | "workingLocation" | "task" {
  if (ev.eventType === "workingLocation") return "workingLocation";
  const calendarLabel = `${meta.googleCalendarId} ${meta.calendarSummary}`
    .toLowerCase()
    .trim();
  if (looksLikeTasksCalendar(meta.calendarSummary, meta.googleCalendarId)) {
    return "task";
  }
  return "event";
}

function looksLikeTasksCalendar(summary: string, googleCalendarId: string): boolean {
  const normalizedSummary = summary.toLowerCase().trim();
  const normalizedId = googleCalendarId.toLowerCase();
  return (
    normalizedSummary === "tasks" ||
    normalizedSummary === "task" ||
    normalizedId.includes("#tasks") ||
    normalizedId.includes("tasks")
  );
}

export const syncCalendar = action({
  args: { calendarId: v.id("calendars") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const meta = await ctx.runQuery(internal.events._getCalendarForSync, {
      calendarId: args.calendarId,
    });
    if (meta === null) return null;

    const token = await getValidAccessToken(ctx, meta.googleAccountId);

    const base = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        meta.googleCalendarId,
      )}/events`,
    );
    base.searchParams.set("singleEvents", "true");
    base.searchParams.set("maxResults", "2500");
    const usingSyncToken = Boolean(meta.syncToken);
    if (usingSyncToken) {
      base.searchParams.set("syncToken", meta.syncToken!);
    } else {
      const now = Date.now();
      base.searchParams.set(
        "timeMin",
        new Date(now - INITIAL_PAST_DAYS * 86400_000).toISOString(),
      );
      base.searchParams.set(
        "timeMax",
        new Date(now + INITIAL_FUTURE_DAYS * 86400_000).toISOString(),
      );
      base.searchParams.set("orderBy", "startTime");
    }

    const changes: EventChange[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    while (true) {
      const url = new URL(base);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 410 && usingSyncToken) {
        // Sync token expired — clear it; next call re-pulls the window.
        await ctx.runMutation(internal.events._resetSync, {
          calendarId: args.calendarId,
        });
        return null;
      }
      if (!res.ok) {
        throw new Error(
          `events.list failed: ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as EventsListResponse;
      if (body.items) {
        for (const ev of body.items) {
          const change = normalize(ev, {
            googleCalendarId: meta.googleCalendarId,
            calendarSummary: meta.summary,
          });
          if (change) changes.push(change);
        }
      }
      pageToken = body.nextPageToken;
      if (!pageToken) {
        nextSyncToken = body.nextSyncToken;
        break;
      }
    }

    await ctx.runMutation(internal.events._applyChanges, {
      calendarId: args.calendarId,
      changes,
      nextSyncToken,
    });

    // Initial-pull garbage collection. When we ask Google without a sync
    // token (first pull, or after a 410, or after forceResyncUser clears it),
    // Google silently OMITS deleted events instead of emitting delete deltas
    // — deletion deltas only exist in the syncToken delta stream. So any
    // local row in the initial-pull window that isn't in the response is
    // stale and must be removed explicitly; otherwise deletes made upstream
    // while we were offline, or before a full resync, stick around forever.
    if (!usingSyncToken) {
      const now = Date.now();
      const seen: string[] = [];
      for (const c of changes) {
        if (c.kind === "upsert") seen.push(c.event.googleEventId);
        else seen.push(c.googleEventId);
      }
      await ctx.runMutation(internal.events._gcMissingEvents, {
        calendarId: args.calendarId,
        windowStart: now - INITIAL_PAST_DAYS * 86400_000,
        windowEnd: now + INITIAL_FUTURE_DAYS * 86400_000,
        seenGoogleEventIds: seen,
      });
    }
    return null;
  },
});

// Delete local event rows in [windowStart, windowEnd) whose googleEventId
// is not in `seenGoogleEventIds`. Called after an initial/full pull of a
// calendar so upstream deletes that happened while the syncToken stream
// was broken get reconciled. Restricted to the window so events outside it
// (older history, far-future) aren't accidentally wiped.
export const _gcMissingEvents = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    windowStart: v.number(),
    windowEnd: v.number(),
    seenGoogleEventIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = new Set(args.seenGoogleEventIds);
    const rows = await ctx.db
      .query("events")
      .withIndex("by_calendar_and_start", (q) =>
        q
          .eq("calendarId", args.calendarId)
          .gte("start", args.windowStart)
          .lt("start", args.windowEnd),
      )
      .collect();
    for (const row of rows) {
      if (!seen.has(row.googleEventId)) {
        await ctx.db.delete(row._id);
      }
    }
    return null;
  },
});

export const syncUser = action({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const cals = await ctx.runQuery(internal.calendars._listEnabledForUser, {
      userId: args.userId,
    });
    for (const c of cals) {
      try {
        const needsKindBackfill = await ctx.runQuery(
          internal.events._calendarNeedsKindBackfill,
          { calendarId: c._id },
        );
        if (needsKindBackfill) {
          await ctx.runMutation(internal.events._resetSync, {
            calendarId: c._id,
          });
        }
        // Colors pulled from Google land via the `colorId` field added in
        // the color-sync feature. Calendars synced before that shipped have
        // events with no colorId; run a one-shot full re-pull per calendar
        // so those events pick up their colors. Guarded by a per-calendar
        // marker so it only fires once.
        const needsColorIdBackfill = await ctx.runQuery(
          internal.events._calendarNeedsColorIdBackfill,
          { calendarId: c._id },
        );
        if (needsColorIdBackfill) {
          await ctx.runMutation(
            internal.events._resetSyncForColorIdBackfill,
            { calendarId: c._id },
          );
        }
        await ctx.runAction(api.events.syncCalendar, { calendarId: c._id });
      } catch (err) {
        // Isolate per-calendar failures so one bad calendar doesn't stop
        // the rest.
        console.error(
          `syncCalendar failed for ${c._id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return null;
  },
});

// --- Write path --------------------------------------------------------

// Move/resize a single timed event. Issues events.patch against Google, then
// applies the change locally immediately (optimistic) so the live query
// repaints without waiting for a full sync. A background incremental sync
// reconciles with whatever Google ended up writing (handles the recurring-
// instance exception case automatically).
export const patchEventTimes = action({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    start: v.number(),
    end: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.end <= args.start) {
      throw new ConvexError("End must be after start");
    }
    const ctxEv = await ctx.runQuery(internal.events._getEventWriteContext, {
      eventId: args.eventId,
    });
    if (ctxEv === null) throw new ConvexError("Event not found");
    if (ctxEv.userId !== args.userId) throw new ConvexError("Forbidden");
    if (ctxEv.accessRole !== "owner" && ctxEv.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }
    if (ctxEv.allDay) {
      throw new ConvexError("All-day event move not yet supported");
    }

    const token = await getValidAccessToken(ctx, ctxEv.googleAccountId);
    const timeZone = ctxEv.calendarTimeZone ?? "UTC";
    const body = {
      start: {
        dateTime: new Date(args.start).toISOString(),
        timeZone,
      },
      end: {
        dateTime: new Date(args.end).toISOString(),
        timeZone,
      },
    };
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      ctxEv.googleCalendarId,
    )}/events/${encodeURIComponent(ctxEv.googleEventId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `events.patch failed: ${res.status} ${await res.text()}`,
      );
    }

    await ctx.runMutation(internal.events._applyLocalTimeUpdate, {
      eventId: args.eventId,
      start: args.start,
      end: args.end,
    });

    // Fire-and-forget reconciliation. Any server-side edits (e.g., conflict
    // resolution, recurring-instance exception creation) land via sync.
    await ctx.runAction(api.events.syncCalendar, {
      calendarId: ctxEv.calendarId,
    });
    return null;
  },
});

export const _getEventWriteContext = internalQuery({
  args: { eventId: v.id("events") },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      calendarId: v.id("calendars"),
      googleAccountId: v.id("googleAccounts"),
      googleCalendarId: v.string(),
      googleEventId: v.string(),
      accessRole: v.union(
        v.literal("owner"),
        v.literal("writer"),
        v.literal("reader"),
        v.literal("freeBusyReader"),
      ),
      allDay: v.boolean(),
      calendarTimeZone: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const ev = await ctx.db.get(args.eventId);
    if (ev === null) return null;
    const cal = await ctx.db.get(ev.calendarId);
    if (cal === null) return null;
    const account = await ctx.db.get(cal.googleAccountId);
    if (account === null) return null;
    return {
      userId: account.userId,
      calendarId: cal._id,
      googleAccountId: cal.googleAccountId,
      googleCalendarId: cal.googleCalendarId,
      googleEventId: ev.googleEventId,
      accessRole: cal.accessRole,
      allDay: ev.allDay,
      calendarTimeZone: cal.timeZone,
    };
  },
});

export const _applyLocalTimeUpdate = internalMutation({
  args: {
    eventId: v.id("events"),
    start: v.number(),
    end: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      start: args.start,
      end: args.end,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Delete an event. Calls Google events.delete; drops the local row on success
// so the live query hides it immediately. Background sync reconciles.
export const deleteEvent = action({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ctxEv = await ctx.runQuery(internal.events._getEventWriteContext, {
      eventId: args.eventId,
    });
    if (ctxEv === null) throw new ConvexError("Event not found");
    if (ctxEv.userId !== args.userId) throw new ConvexError("Forbidden");
    if (ctxEv.accessRole !== "owner" && ctxEv.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }

    const token = await getValidAccessToken(ctx, ctxEv.googleAccountId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      ctxEv.googleCalendarId,
    )}/events/${encodeURIComponent(ctxEv.googleEventId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // 410 Gone means already deleted — treat as success.
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      throw new Error(
        `events.delete failed: ${res.status} ${await res.text()}`,
      );
    }

    await ctx.runMutation(internal.events._applyLocalDelete, {
      eventId: args.eventId,
    });
    await ctx.runAction(api.events.syncCalendar, {
      calendarId: ctxEv.calendarId,
    });
    return null;
  },
});

export const _applyLocalDelete = internalMutation({
  args: { eventId: v.id("events") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ev = await ctx.db.get(args.eventId);
    if (ev) await ctx.db.delete(args.eventId);
    return null;
  },
});

export const updateEventColor = mutation({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    colorOverride: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      args.colorOverride !== null &&
      !/^#[0-9a-fA-F]{6}$/.test(args.colorOverride)
    ) {
      throw new ConvexError("Color must be a hex value");
    }
    const ev = await ctx.db.get(args.eventId);
    if (ev === null) throw new ConvexError("Event not found");
    const cal = await ctx.db.get(ev.calendarId);
    if (cal === null) throw new ConvexError("Calendar not found");
    const account = await ctx.db.get(cal.googleAccountId);
    if (account === null || account.userId !== args.userId) {
      throw new ConvexError("Forbidden");
    }
    if (cal.accessRole !== "owner" && cal.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }
    await ctx.db.patch(args.eventId, {
      colorOverride: args.colorOverride ?? undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Patch arbitrary fields on an event. Times, if provided, must be consistent
// (end > start; allDay flag must match the dateTime vs date shape).
export const updateEventFields = action({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (
      args.start !== undefined &&
      args.end !== undefined &&
      args.end <= args.start
    ) {
      throw new ConvexError("End must be after start");
    }
    const ctxEv = await ctx.runQuery(internal.events._getEventWriteContext, {
      eventId: args.eventId,
    });
    if (ctxEv === null) throw new ConvexError("Event not found");
    if (ctxEv.userId !== args.userId) throw new ConvexError("Forbidden");
    if (ctxEv.accessRole !== "owner" && ctxEv.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }

    const token = await getValidAccessToken(ctx, ctxEv.googleAccountId);
    const timeZone = ctxEv.calendarTimeZone ?? "UTC";
    const body: Record<string, unknown> = {};
    if (args.summary !== undefined) body.summary = args.summary;
    if (args.description !== undefined) body.description = args.description;
    if (args.location !== undefined) body.location = args.location;
    if (args.attendees !== undefined) {
      body.attendees = normalizeAttendeeEmails(args.attendees).map((email) => ({
        email,
      }));
    }
    if (args.start !== undefined) {
      body.start = ctxEv.allDay
        ? { date: toYMD(args.start) }
        : { dateTime: new Date(args.start).toISOString(), timeZone };
    }
    if (args.end !== undefined) {
      body.end = ctxEv.allDay
        ? { date: toYMD(args.end) }
        : { dateTime: new Date(args.end).toISOString(), timeZone };
    }

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      ctxEv.googleCalendarId,
    )}/events/${encodeURIComponent(ctxEv.googleEventId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `events.patch failed: ${res.status} ${await res.text()}`,
      );
    }

    await ctx.runMutation(internal.events._applyLocalFields, {
      eventId: args.eventId,
      summary: args.summary,
      description: args.description,
      location: args.location,
      attendees:
        args.attendees === undefined
          ? undefined
          : normalizeAttendeeEmails(args.attendees).map((email) => ({
              email,
              responseStatus: "needsAction" as const,
            })),
      start: args.start,
      end: args.end,
    });
    await ctx.runAction(api.events.syncCalendar, {
      calendarId: ctxEv.calendarId,
    });
    return null;
  },
});

export const _applyLocalFields = internalMutation({
  args: {
    eventId: v.id("events"),
    summary: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(rawAttendee)),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.description !== undefined) patch.description = args.description;
    if (args.location !== undefined) patch.location = args.location;
    if (args.attendees !== undefined) patch.attendees = args.attendees;
    if (args.start !== undefined) patch.start = args.start;
    if (args.end !== undefined) patch.end = args.end;
    await ctx.db.patch(args.eventId, patch);
    return null;
  },
});

// Create a new timed event on the given calendar. Inserts locally after
// Google confirms, then kicks off a sync to capture anything Google added
// (e.g., htmlLink, creator info).
export const createEvent = action({
  args: {
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    summary: v.string(),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
  },
  returns: v.id("events"),
  handler: async (ctx, args): Promise<Id<"events">> => {
    if (args.end <= args.start) {
      throw new ConvexError("End must be after start");
    }
    const ctxCal = await ctx.runQuery(internal.events._getCalendarWriteContext, {
      calendarId: args.calendarId,
    });
    if (ctxCal === null) throw new ConvexError("Calendar not found");
    if (ctxCal.userId !== args.userId) throw new ConvexError("Forbidden");
    if (ctxCal.accessRole !== "owner" && ctxCal.accessRole !== "writer") {
      throw new ConvexError("Calendar is read-only");
    }

    const token = await getValidAccessToken(ctx, ctxCal.googleAccountId);
    const timeZone = ctxCal.timeZone ?? "UTC";
    const body: Record<string, unknown> = {
      summary: args.summary,
      start: args.allDay
        ? { date: toYMD(args.start) }
        : { dateTime: new Date(args.start).toISOString(), timeZone },
      end: args.allDay
        ? { date: toYMD(args.end) }
        : { dateTime: new Date(args.end).toISOString(), timeZone },
    };
    if (args.description) body.description = args.description;
    if (args.location) body.location = args.location;
    const attendees = normalizeAttendeeEmails(args.attendees ?? []);
    if (attendees.length > 0) {
      body.attendees = attendees.map((email) => ({ email }));
    }

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      ctxCal.googleCalendarId,
    )}/events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `events.insert failed: ${res.status} ${await res.text()}`,
      );
    }
    const created = (await res.json()) as {
      id: string;
      htmlLink?: string;
      updated?: string;
    };

    const insertedId = await ctx.runMutation(internal.events._insertLocalEvent, {
      calendarId: args.calendarId,
      googleEventId: created.id,
      summary: args.summary,
      description: args.description,
      location: args.location,
      attendees:
        attendees.length > 0
          ? attendees.map((email) => ({
              email,
              responseStatus: "needsAction" as const,
            }))
          : undefined,
      start: args.start,
      end: args.end,
      allDay: args.allDay,
      htmlLink: created.htmlLink,
    });
    await ctx.runAction(api.events.syncCalendar, {
      calendarId: args.calendarId,
    });
    return insertedId;
  },
});

export const _getCalendarWriteContext = internalQuery({
  args: { calendarId: v.id("calendars") },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      googleAccountId: v.id("googleAccounts"),
      googleCalendarId: v.string(),
      accessRole: v.union(
        v.literal("owner"),
        v.literal("writer"),
        v.literal("reader"),
        v.literal("freeBusyReader"),
      ),
      timeZone: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (cal === null) return null;
    const account = await ctx.db.get(cal.googleAccountId);
    if (account === null) return null;
    return {
      userId: account.userId,
      googleAccountId: cal.googleAccountId,
      googleCalendarId: cal.googleCalendarId,
      accessRole: cal.accessRole,
      timeZone: cal.timeZone,
    };
  },
});

export const _insertLocalEvent = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    googleEventId: v.string(),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(rawAttendee)),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
    htmlLink: v.optional(v.string()),
  },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_calendar_and_event", (q) =>
        q
          .eq("calendarId", args.calendarId)
          .eq("googleEventId", args.googleEventId),
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("events", {
      calendarId: args.calendarId,
      googleEventId: args.googleEventId,
      summary: args.summary,
      description: args.description,
      location: args.location,
      attendees: args.attendees,
      start: args.start,
      end: args.end,
      allDay: args.allDay,
      status: "confirmed",
      eventKind: "event",
      htmlLink: args.htmlLink,
      updatedAt: Date.now(),
    });
  },
});

function normalizeAttendeeEmails(attendees: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of attendees) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

// YYYY-MM-DD in UTC (matches how we parse all-day dates on read).
function toYMD(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --- internal helpers --------------------------------------------------

export const _getCalendarForSync = internalQuery({
  args: { calendarId: v.id("calendars") },
  returns: v.union(
    v.object({
      googleAccountId: v.id("googleAccounts"),
      googleCalendarId: v.string(),
      summary: v.string(),
      syncToken: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const cal = await ctx.db.get(args.calendarId);
    if (cal === null) return null;
    return {
      googleAccountId: cal.googleAccountId,
      googleCalendarId: cal.googleCalendarId,
      summary: cal.summary,
      syncToken: cal.syncToken,
    };
  },
});

export const _applyChanges = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    changes: v.array(
      v.union(
        v.object({
          kind: v.literal("upsert"),
          event: v.object({
            googleEventId: v.string(),
            summary: v.string(),
            description: v.optional(v.string()),
            location: v.optional(v.string()),
            start: v.number(),
            end: v.number(),
            allDay: v.boolean(),
            status: eventStatus,
            htmlLink: v.optional(v.string()),
            updatedAt: v.number(),
            eventKind,
            attendees: v.optional(v.array(rawAttendee)),
            colorId: v.optional(v.string()),
          }),
        }),
        v.object({
          kind: v.literal("delete"),
          googleEventId: v.string(),
        }),
      ),
    ),
    nextSyncToken: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const change of args.changes) {
      if (change.kind === "delete") {
        const existing = await ctx.db
          .query("events")
          .withIndex("by_calendar_and_event", (q) =>
            q
              .eq("calendarId", args.calendarId)
              .eq("googleEventId", change.googleEventId),
          )
          .unique();
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }
      const existing = await ctx.db
        .query("events")
        .withIndex("by_calendar_and_event", (q) =>
          q
            .eq("calendarId", args.calendarId)
            .eq("googleEventId", change.event.googleEventId),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, change.event);
      } else {
        await ctx.db.insert("events", {
          calendarId: args.calendarId,
          ...change.event,
        });
      }
    }
    await ctx.db.patch(args.calendarId, {
      syncToken: args.nextSyncToken,
      lastSyncedAt: Date.now(),
    });
    return null;
  },
});

export const _resetSync = internalMutation({
  args: { calendarId: v.id("calendars") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.calendarId, { syncToken: undefined });
    return null;
  },
});

// Clears the saved Google sync token on every calendar the user owns, then
// runs a full syncUser. Escape hatch for when the incremental syncToken has
// drifted (Google occasionally misses delete deltas after long token lifetimes
// or token re-issuance) and the user's view no longer matches Google's truth.
// More expensive than regular sync because it re-pulls the INITIAL_* window
// per calendar — but only fires when the user explicitly asks for it.
export const forceResyncUser = action({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const cals = await ctx.runQuery(internal.calendars._listEnabledForUser, {
      userId: args.userId,
    });
    for (const c of cals) {
      await ctx.runMutation(internal.events._resetSync, { calendarId: c._id });
    }
    await ctx.runAction(api.events.syncUser, { userId: args.userId });
    return null;
  },
});

// True when this calendar has never been touched by the colorId backfill.
// We only want to force-reset a calendar's sync token once per deploy of
// the colorId feature; after that, normal incremental sync keeps colorId
// up to date.
export const _calendarNeedsColorIdBackfill = internalQuery({
  args: { calendarId: v.id("calendars") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarId);
    if (calendar === null) return false;
    return calendar.colorIdBackfilledAt === undefined;
  },
});

// Atomic "run the one-time backfill for this calendar": clear the sync
// token (so the next fetch is a full initial pull and returns every event
// with its current colorId) and stamp the marker so we don't do it again.
// If the subsequent sync errors out, the marker is still set — but the
// cleared syncToken means the retry will also be a full pull, so existing
// events still get their colors on the next attempt.
export const _resetSyncForColorIdBackfill = internalMutation({
  args: { calendarId: v.id("calendars") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.calendarId, {
      syncToken: undefined,
      colorIdBackfilledAt: Date.now(),
    });
    return null;
  },
});

export const _calendarNeedsKindBackfill = internalQuery({
  args: { calendarId: v.id("calendars") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarId);
    if (calendar === null) return false;
    const events = await ctx.db
      .query("events")
      .withIndex("by_calendar", (q) => q.eq("calendarId", args.calendarId))
      .take(50);
    return events.some(
      (event) =>
        event.eventKind === undefined ||
        (looksLikeTasksCalendar(calendar.summary, calendar.googleCalendarId) &&
          event.eventKind !== "task"),
    );
  },
});
