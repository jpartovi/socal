import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phoneNumber: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    photoStorageId: v.optional(v.id("_storage")),
    useDefaultAvatar: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
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
    // Per-direction calendar visibility. Default-on: undefined/true = the
    // other party's agent may read this side's calendar; explicit false
    // means this side has opted out. Friending on a calendar-coordination
    // app implies consent, so we only persist the opt-outs.
    userAAllowsAgentAccess: v.optional(v.boolean()),
    userBAllowsAgentAccess: v.optional(v.boolean()),
  })
    .index("by_pair", ["userA", "userB"])
    .index("by_userA_status", ["userA", "status"])
    .index("by_userB_status", ["userB", "status"]),

  // Pending friend invites sent to a phone number that doesn't yet belong
  // to a socal user. When that phone later signs up, `users.create` converts
  // the matching rows into real pending friendships. Deduped on
  // (fromUserId, phoneNumber).
  phoneInvites: defineTable({
    fromUserId: v.id("users"),
    phoneNumber: v.string(),
    name: v.optional(v.string()),
    invitedAt: v.number(),
  })
    .index("by_from_user", ["fromUserId"])
    .index("by_phone_number", ["phoneNumber"])
    .index("by_from_user_and_phone", ["fromUserId", "phoneNumber"]),

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
    .index("by_user_and_google_sub", ["userId", "googleSub"])
    .index("by_email", ["email"]),

  // One row per calendar visible to a connected Google account — includes
  // the user's own calendars plus every calendar shared with or subscribed
  // by that account. `isEnabled` is socal's local toggle: only enabled
  // calendars contribute events to the socal feed.
  calendars: defineTable({
    googleAccountId: v.id("googleAccounts"),
    googleCalendarId: v.string(),
    summary: v.string(),
    summaryOverride: v.optional(v.string()),
    description: v.optional(v.string()),
    accessRole: v.union(
      v.literal("owner"),
      v.literal("writer"),
      v.literal("reader"),
      v.literal("freeBusyReader"),
    ),
    backgroundColor: v.string(),
    foregroundColor: v.string(),
    colorOverride: v.optional(v.string()),
    isPrimary: v.boolean(),
    isEnabled: v.boolean(),
    hiddenFromList: v.optional(v.boolean()),
    timeZone: v.optional(v.string()),
    // Google `nextSyncToken` for incremental event sync. Empty on first
    // pull or after a 410-Gone reset.
    syncToken: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
  })
    .index("by_account", ["googleAccountId"])
    .index("by_account_and_cal_id", ["googleAccountId", "googleCalendarId"]),

  // One row per calendar event instance (recurring series are pre-expanded
  // into instances by Google when we call events.list?singleEvents=true).
  // `start`/`end` are epoch ms. For all-day events they are midnight UTC on
  // the event's date(s) and `allDay=true`.
  events: defineTable({
    calendarId: v.id("calendars"),
    googleEventId: v.string(),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
    status: v.union(
      v.literal("confirmed"),
      v.literal("tentative"),
      v.literal("cancelled"),
    ),
    htmlLink: v.optional(v.string()),
    updatedAt: v.number(),
    colorOverride: v.optional(v.string()),
    eventKind: v.optional(
      v.union(v.literal("event"), v.literal("workingLocation"), v.literal("task")),
    ),
    // Attendees as reported by Google Calendar. Photos are resolved at query
    // time by joining `email` against googleAccounts → users.
    attendees: v.optional(
      v.array(
        v.object({
          email: v.string(),
          displayName: v.optional(v.string()),
          responseStatus: v.optional(
            v.union(
              v.literal("needsAction"),
              v.literal("declined"),
              v.literal("tentative"),
              v.literal("accepted"),
            ),
          ),
          self: v.optional(v.boolean()),
          organizer: v.optional(v.boolean()),
        }),
      ),
    ),
  })
    .index("by_calendar", ["calendarId"])
    .index("by_calendar_and_event", ["calendarId", "googleEventId"])
    .index("by_calendar_and_start", ["calendarId", "start"]),

  // Agent-authored event proposals awaiting user approval. Rows start
  // `pending`; on accept/reject they're patched to the corresponding terminal
  // status (not deleted) so a future "agent activity" view can render the
  // history. Only `pending` rows are fed back into the calendar UI.
  //
  // Schema is single-purpose for now — every row is a create proposal. When
  // update proposals arrive, promote this to a discriminated union via
  // `v.union` with a `kind` field; both indexes below stay valid because
  // `userId`/`calendarId`/`status`/`start` are common to every branch.
  eventProposals: defineTable({
    userId: v.id("users"),
    calendarId: v.id("calendars"),
    summary: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    proposedAt: v.number(),
    respondedAt: v.optional(v.number()),
    // Set when status transitions to "accepted" so a future audit/history
    // view can link a proposal to the real event it became.
    createdEventId: v.optional(v.id("events")),
  })
    .index("by_user_and_status", ["userId", "status"])
    .index("by_calendar_and_start", ["calendarId", "start"]),
});
