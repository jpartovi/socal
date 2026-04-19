"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgendaView } from "@/components/calendar/agenda-view";
import { CalendarsSidebar } from "@/components/calendar/calendars-sidebar";
import {
  DaysView,
  type DraftCalendarEvent,
} from "@/components/calendar/days-view";
import { EventQuickCreate } from "@/components/calendar/event-quick-create";
import {
  type CalendarView,
  navigate,
  numDaysFor,
  rangeFor,
  startOfDay,
  titleFor,
} from "@/components/calendar/lib";
import { MonthView } from "@/components/calendar/month-view";
import { TimezoneBanner } from "@/components/calendar/timezone-banner";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";
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

  // Global shortcuts: sidebar toggle + open shortcut reference.
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

  const syncUser = useAction(api.events.syncUser);
  const patchEventTimes = useAction(api.events.patchEventTimes);
  const createEvent = useAction(api.events.createEvent);
  const defaultCalendar = useQuery(
    api.calendars.defaultWritableCalendar,
    userId ? { userId } : "skip",
  );
  const defaultCalendarId = defaultCalendar?._id ?? null;

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
      if (!defaultCalendar) return;
      setCreatedEventId(null);
      setCommittedDraftEventId(null);
      setDraftEvent({
        id: `draft-${args.start}-${args.end}-${Date.now()}`,
        calendarId: defaultCalendar._id,
        calendarName: defaultCalendar.summaryOverride ?? defaultCalendar.summary,
        backgroundColor:
          defaultCalendar.colorOverride ?? defaultCalendar.backgroundColor,
        foregroundColor: defaultCalendar.foregroundColor,
        start: args.start,
        end: args.end,
      });
    },
    [defaultCalendar],
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

  // Fire a sync on mount per signed-in user. Incremental sync is cheap; the
  // live query will repaint once rows land.
  useEffect(() => {
    if (!userId) return;
    syncUser({ userId }).catch((err) => {
      console.error("syncUser failed", err);
    });
  }, [userId, syncUser]);

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
          if (userId) syncUser({ userId }).catch(() => {});
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToday, goPrev, goNext, syncUser, userId]);

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
      />
      {events === undefined ? (
        <p className="px-2 py-8 text-sm text-muted-foreground">Loading…</p>
      ) : view === "agenda" ? (
        <AgendaView events={events} anchor={effectiveAnchor} />
      ) : view === "month" ? (
        <MonthView events={events} anchor={effectiveAnchor} />
      ) : (
        <DaysView
          events={events}
          anchor={effectiveAnchor}
          numDays={numDaysFor(view)}
          onMoveEvent={onMoveEvent}
          onCreateEvent={defaultCalendarId ? onCreateEvent : null}
          draftEvent={draftEvent}
          onDraftDismiss={() => setDraftEvent(null)}
          onDraftCommit={commitDraftEvent}
          createdEventId={createdEventId}
          onCreateDismiss={() => setCreatedEventId(null)}
        />
      )}
      <div className="mx-auto w-full max-w-2xl pt-1">
        <EventQuickCreate />
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
}: {
  view: CalendarView;
  setView: (v: CalendarView) => void;
  title: string;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-xl"
          onClick={onToday}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl"
          onClick={onPrev}
          aria-label="Previous"
        >
          ‹
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl"
          onClick={onNext}
          aria-label="Next"
        >
          ›
        </Button>
        <span className="ml-2 text-base font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-1 rounded-xl border p-1">
        {VIEW_BUTTONS.map((b) => (
          <button
            key={b.view}
            type="button"
            onClick={() => setView(b.view)}
            className={`rounded-lg px-2.5 py-1 text-xs ${
              b.view === view
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
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
