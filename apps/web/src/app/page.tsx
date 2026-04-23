"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgendaView } from "@/components/calendar/agenda-view";
import { AgentInput } from "@/components/calendar/agent-input";
import { CalendarsSidebar } from "@/components/calendar/calendars-sidebar";
import {
  DaysView,
  type DraftCalendarEvent,
} from "@/components/calendar/days-view";
import { HighlightProvider } from "@/components/calendar/highlight-context";
import {
  type CalendarView,
  navigate,
  numDaysFor,
  rangeFor,
  startOfDay,
  startOfWeek,
  titleFor,
} from "@/components/calendar/lib";
import { MonthView } from "@/components/calendar/month-view";
import { TimezoneBanner } from "@/components/calendar/timezone-banner";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";
import { AgentQueueProvider, useAgentQueue } from "@/lib/agent-queue";
import { useAuth } from "@/lib/auth";
import { useUndo } from "@/lib/undo";

const SIDEBAR_OPEN_KEY = "socal.sidebarOpen";
const CALENDAR_STATE_KEY = "socal.calendarState";

export default function Home() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored !== null) setSidebarOpen(stored === "1");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "?") {
        e.preventDefault();
        router.push("/keyboard-shortcuts");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSidebar]);

  return (
    <RequireAuth>
      <AgentQueueProvider>
        <main className="flex h-screen min-h-0 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between pl-4 pr-6 py-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? "Hide calendars" : "Show calendars"}
                aria-pressed={sidebarOpen}
                className="hidden h-7 w-7 items-center justify-center rounded-xl hover:bg-muted lg:inline-flex"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand-mark.png"
                  alt=""
                  className={`h-5 w-5 object-contain transition-opacity ${
                    sidebarOpen ? "opacity-100" : "opacity-50"
                  }`}
                />
              </button>
              <Link href="/" aria-label="Home">
                <Wordmark size="sm" showMark={false} />
              </Link>
            </div>
            <UserMenu />
          </header>
          <TimezoneBanner />
          <div className="flex min-h-0 flex-1 items-stretch">
            {sidebarOpen && (
              <div className="hidden lg:flex">
                <CalendarsSidebar />
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <CalendarHome />
            </div>
          </div>
        </main>
      </AgentQueueProvider>
    </RequireAuth>
  );
}

const VIEW_BUTTONS: Array<{ view: CalendarView; label: string; hint?: string }> =
  [
    { view: "agenda", label: "Agenda", hint: "A" },
    { view: "day", label: "Day", hint: "D" },
    { view: "3day", label: "3 days" },
    { view: "4day", label: "4 days", hint: "X" },
    { view: "week", label: "Week", hint: "W" },
    { view: "month", label: "Month", hint: "M" },
  ];

function restoreCalendarState(): { view: CalendarView; anchor: Date } {
  const fallback = { view: "week" as CalendarView, anchor: startOfDay(new Date()) };
  try {
    const raw = window.localStorage.getItem(CALENDAR_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      view?: unknown;
      anchor?: unknown;
    };
    if (!isCalendarView(parsed.view) || typeof parsed.anchor !== "number") {
      return fallback;
    }
    const anchor = new Date(parsed.anchor);
    if (Number.isNaN(anchor.getTime())) return fallback;
    return { view: parsed.view, anchor: startOfDay(anchor) };
  } catch {
    return fallback;
  }
}

function isCalendarView(value: unknown): value is CalendarView {
  return (
    value === "agenda" ||
    value === "day" ||
    value === "3day" ||
    value === "4day" ||
    value === "week" ||
    value === "month"
  );
}

function CalendarHome() {
  const { userId } = useAuth();
  const [calendarStateReady, setCalendarStateReady] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<Date | null>(null);

  useEffect(() => {
    const restored = restoreCalendarState();
    setView(restored.view);
    setAnchor(restored.anchor);
    setCalendarStateReady(true);
  }, []);

  useEffect(() => {
    if (!calendarStateReady || anchor === null) return;
    window.localStorage.setItem(
      CALENDAR_STATE_KEY,
      JSON.stringify({ view, anchor: anchor.getTime() }),
    );
  }, [calendarStateReady, view, anchor]);

  const effectiveAnchor = anchor ?? startOfDay(new Date());
  const { start, end } = useMemo(
    () => rangeFor(view, effectiveAnchor),
    [view, effectiveAnchor],
  );

  const rawEvents = useQuery(
    api.events.listForUserInRange,
    userId ? { userId, start: start.getTime(), end: end.getTime() } : "skip",
  );
  const { pendingDeletes, showUndoToast } = useUndo();
  const events = useMemo(
    () =>
      rawEvents === undefined
        ? undefined
        : pendingDeletes.size === 0
          ? rawEvents
          : rawEvents.filter((row) => !pendingDeletes.has(row.event._id)),
    [rawEvents, pendingDeletes],
  );

  // Pending event proposals in the same window. Rendered as ghost cards
  // alongside real events. Live query so accept/reject removes them
  // immediately without a round-trip.
  const proposals = useQuery(
    api.proposals.listForUserInRange,
    userId ? { userId, start: start.getTime(), end: end.getTime() } : "skip",
  );

  // IDs of proposals the agent just created — paints a sparkle glow for a
  // few seconds so the user's eye lands on the suggestion instead of having
  // to hunt for it in their week.
  const [highlightedProposalIds, setHighlightedProposalIds] = useState<
    Set<Id<"eventProposals">>
  >(new Set());
  // Holds ids we want to jump the calendar to once the live query catches up.
  // Cleared as soon as we find the proposal and move the anchor.
  const [pendingJumpIds, setPendingJumpIds] = useState<
    Id<"eventProposals">[]
  >([]);
  const onProposalsCreated = useCallback((ids: Id<"eventProposals">[]) => {
    if (ids.length === 0) return;
    setHighlightedProposalIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setPendingJumpIds(ids);
    window.setTimeout(() => {
      setHighlightedProposalIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 4000);
  }, []);
  useEffect(() => {
    if (pendingJumpIds.length === 0 || proposals === undefined) return;
    const ids = new Set(pendingJumpIds);
    const matching = proposals.filter((p) => ids.has(p.proposal._id));
    if (matching.length === 0) return;
    const earliest = matching.reduce(
      (acc, p) => (p.proposal.start < acc ? p.proposal.start : acc),
      Number.POSITIVE_INFINITY,
    );
    setAnchor(startOfDay(new Date(earliest)));
    setPendingJumpIds([]);
  }, [pendingJumpIds, proposals]);

  // Bridge: when a queued agent task finishes with new proposal ids, run the
  // same highlight + jump flow that used to fire inside AgentInput. Consumed
  // task ids are tracked in a ref so we don't re-fire if the task lingers a
  // few seconds before the queue drops it.
  const { tasks: agentTasks } = useAgentQueue();
  const consumedTaskIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of agentTasks) {
      if (t.status !== "done") continue;
      if (consumedTaskIds.current.has(t.id)) continue;
      consumedTaskIds.current.add(t.id);
      if (t.proposalIds && t.proposalIds.length > 0) {
        onProposalsCreated(t.proposalIds);
      }
    }
  }, [agentTasks, onProposalsCreated]);

  const syncUser = useAction(api.events.syncUser);
  const forceResyncUser = useAction(api.events.forceResyncUser);
  const patchEventTimes = useAction(api.events.patchEventTimes);
  const createEvent = useAction(api.events.createEvent);
  const writableCalendar = useQuery(
    api.calendars.writableCalendarForUser,
    userId ? { userId } : "skip",
  );
  const writableCalendarId = writableCalendar?._id ?? null;

  const onMoveEvent = useCallback(
    async (args: {
      eventId: Id<"events">;
      start: number;
      end: number;
      oldStart: number;
      oldEnd: number;
    }) => {
      if (!userId) return;
      const { eventId, start, end, oldStart, oldEnd } = args;
      if (start === oldStart && end === oldEnd) return;
      try {
        await patchEventTimes({ userId, eventId, start, end });
        showUndoToast({
          message: "Event moved",
          onUndo: () => {
            patchEventTimes({
              userId,
              eventId,
              start: oldStart,
              end: oldEnd,
            }).catch((err) => {
              console.error("patchEventTimes undo failed", err);
            });
          },
        });
      } catch (err) {
        console.error("patchEventTimes failed", err);
      }
    },
    [userId, patchEventTimes, showUndoToast],
  );

  const [createdEventId, setCreatedEventId] = useState<Id<"events"> | null>(
    null,
  );
  const [draftEvent, setDraftEvent] = useState<DraftCalendarEvent | null>(null);
  const [committedDraftEventId, setCommittedDraftEventId] =
    useState<Id<"events"> | null>(null);

  useEffect(() => {
    if (!committedDraftEventId || events === undefined) return;
    if (!events.some((row) => row.event._id === committedDraftEventId)) return;
    setDraftEvent(null);
    setCommittedDraftEventId(null);
  }, [committedDraftEventId, events]);

  const onCreateEvent = useCallback(
    (args: { start: number; end: number }) => {
      if (!writableCalendar) return;
      setCreatedEventId(null);
      setCommittedDraftEventId(null);
      setDraftEvent({
        id: `draft-${args.start}-${args.end}-${Date.now()}`,
        calendarId: writableCalendar._id,
        calendarName:
          writableCalendar.summaryOverride ?? writableCalendar.summary,
        backgroundColor:
          writableCalendar.colorOverride ?? writableCalendar.backgroundColor,
        foregroundColor: writableCalendar.foregroundColor,
        start: args.start,
        end: args.end,
      });
    },
    [writableCalendar],
  );

  const commitDraftEvent = useCallback(
    async (fields: {
      summary: string;
      location: string;
      attendees: string[];
    }) => {
      if (!userId) throw new Error("Cannot create event without a user.");
      const summary = fields.summary.trim();
      const location = fields.location.trim();
      if (!summary && !location && fields.attendees.length === 0) return;
      const draft = draftEvent;
      if (!draft) throw new Error("Cannot create event without a draft.");
      setDraftEvent((prev) =>
        prev && prev.id === draft.id
          ? { ...prev, summary: summary || "(no title)" }
          : prev,
      );
      try {
        const id = await createEvent({
          userId,
          calendarId: draft.calendarId,
          summary: summary || "(no title)",
          start: draft.start,
          end: draft.end,
          allDay: false,
          location,
          attendees: fields.attendees,
        });
        setCommittedDraftEventId(id);
      } catch (err) {
        console.error("createEvent failed", err);
        throw err;
      }
    },
    [userId, draftEvent, createEvent],
  );

  // Single in-flight sync at a time. Without this guard, mount + focus +
  // visibilitychange + a manual click can all race against each other and
  // against the 5-min server cron on the same calendar document, producing
  // OCC conflicts in `events._applyChanges`. The ref is deliberately global
  // to both effects below and the sync button.
  const syncInFlightRef = useRef(false);
  const runSync = useCallback(() => {
    if (!userId || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    syncUser({ userId })
      .catch((err) => {
        console.error("syncUser failed", err);
      })
      .finally(() => {
        syncInFlightRef.current = false;
      });
  }, [userId, syncUser]);

  // Fire once on mount, then on tab focus/visibility changes. Background
  // freshness is handled by the 5-min server cron — no client-side interval
  // needed (those just pile on OCC conflicts without adding coverage).
  useEffect(() => {
    runSync();
  }, [runSync]);
  useEffect(() => {
    if (!userId) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") runSync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, runSync]);

  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), []);
  const goPrev = useCallback(
    () => setAnchor((a) => navigate(view, a ?? startOfDay(new Date()), -1)),
    [view],
  );
  const goNext = useCallback(
    () => setAnchor((a) => navigate(view, a ?? startOfDay(new Date()), 1)),
    [view],
  );

  // Keyboard shortcuts — match Google Calendar where applicable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case "a":
        case "A":
          setView("agenda");
          break;
        case "d":
        case "D":
          setView("day");
          break;
        case "x":
        case "X":
          setView("4day");
          break;
        case "w":
        case "W":
          setView("week");
          break;
        case "m":
        case "M":
          setView("month");
          break;
        case "t":
        case "T":
          goToday();
          break;
        case "ArrowLeft":
        case "j":
        case "J":
          goPrev();
          break;
        case "ArrowRight":
        case "k":
        case "K":
          goNext();
          break;
        case "c":
        case "C": {
          const input = document.querySelector<HTMLInputElement>(
            "[data-quick-create-input]",
          );
          input?.focus();
          break;
        }
        case "r":
        case "R":
          runSync();
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToday, goPrev, goNext, runSync]);

  if (!userId || !calendarStateReady || anchor === null) return null;

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-2 px-6 pb-3 pt-1">
      <Toolbar
        view={view}
        setView={setView}
        title={titleFor(view, effectiveAnchor)}
        onToday={goToday}
        onPrev={goPrev}
        onNext={goNext}
        onSync={() => {
          if (!userId || syncInFlightRef.current) return;
          syncInFlightRef.current = true;
          forceResyncUser({ userId })
            .catch((err) => {
              console.error("forceResyncUser failed", err);
            })
            .finally(() => {
              syncInFlightRef.current = false;
            });
        }}
      />
      <HighlightProvider ids={highlightedProposalIds}>
        {events === undefined ? (
          <p className="px-2 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : view === "agenda" ? (
          <AgendaView
            events={events}
            proposals={proposals ?? []}
            anchor={effectiveAnchor}
          />
        ) : view === "month" ? (
          <MonthView
            events={events}
            proposals={proposals ?? []}
            anchor={effectiveAnchor}
          />
        ) : (
          <DaysView
            events={events}
            proposals={proposals ?? []}
            anchor={
              view === "week" ? startOfWeek(effectiveAnchor) : effectiveAnchor
            }
            numDays={numDaysFor(view)}
            onMoveEvent={onMoveEvent}
            onCreateEvent={writableCalendarId ? onCreateEvent : null}
            createEventAppearance={
              writableCalendar
                ? {
                    backgroundColor:
                      writableCalendar.colorOverride ??
                      writableCalendar.backgroundColor,
                    foregroundColor: writableCalendar.foregroundColor,
                  }
                : null
            }
            draftEvent={draftEvent}
            onDraftDismiss={() => setDraftEvent(null)}
            onDraftCommit={commitDraftEvent}
            createdEventId={createdEventId}
            onCreateDismiss={() => setCreatedEventId(null)}
          />
        )}
      </HighlightProvider>
      <div className="mx-auto w-full max-w-2xl pt-1">
        <AgentInput />
      </div>
    </section>
  );
}

function Toolbar({
  view,
  setView,
  title,
  onToday,
  onPrev,
  onNext,
  onSync,
}: {
  view: CalendarView;
  setView: (v: CalendarView) => void;
  title: string;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSync: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-1 pt-2">
      <div className="flex items-end gap-4">
        <TitleDisplay title={title} />
        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            onClick={onToday}
            className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-foreground/80 transition-transform duration-150 ease-out hover:scale-[1.04] hover:bg-foreground/10 active:scale-[0.96]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous"
            className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/60 transition-transform duration-150 ease-out hover:scale-[1.08] hover:bg-foreground/5 hover:text-foreground active:scale-[0.94]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next"
            className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/60 transition-transform duration-150 ease-out hover:scale-[1.08] hover:bg-foreground/5 hover:text-foreground active:scale-[0.94]"
          >
            ›
          </button>
          <button
            type="button"
            onClick={onSync}
            title="Sync from Google Calendar"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-foreground/60 transition-transform duration-150 ease-out hover:scale-[1.08] hover:bg-foreground/5 hover:text-foreground active:scale-[0.94]"
            aria-label="Sync"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
              <path d="M13.5 2.5v3h-3" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-0.5 pb-1">
        {VIEW_BUTTONS.map((b) => (
          <button
            key={b.view}
            type="button"
            onClick={() => setView(b.view)}
            className={`rounded-full px-3 py-1 text-xs transition-transform duration-150 ease-out hover:scale-[1.04] active:scale-[0.96] ${
              b.view === view
                ? "bg-foreground text-background"
                : "text-foreground/55 hover:text-foreground"
            }`}
            title={b.hint ? `${b.label} (${b.hint})` : b.label}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Sans-serif, same size/weight as the weekday number headers ("23", "24",
// "25") — one unified voice for the toolbar row.
function TitleDisplay({ title }: { title: string }) {
  return (
    <h1 className="text-2xl font-medium leading-none tracking-tight text-foreground/90">
      {title}
    </h1>
  );
}
