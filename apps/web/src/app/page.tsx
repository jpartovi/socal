"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgendaView } from "@/components/calendar/agenda-view";
import { CalendarsSidebar } from "@/components/calendar/calendars-sidebar";
import { DaysView } from "@/components/calendar/days-view";
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

const SIDEBAR_OPEN_KEY = "socal.sidebarOpen";

export default function Home() {
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

function CalendarHome() {
  const { userId } = useAuth();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const { start, end } = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const events = useQuery(
    api.events.listForUserInRange,
    userId ? { userId, start: start.getTime(), end: end.getTime() } : "skip",
  );

  const syncUser = useAction(api.events.syncUser);
  const patchEventTimes = useAction(api.events.patchEventTimes);
  const createEvent = useAction(api.events.createEvent);
  const defaultCalendarId = useQuery(
    api.calendars.defaultWritable,
    userId ? { userId } : "skip",
  );

  const onMoveEvent = useCallback(
    async (args: { eventId: Id<"events">; start: number; end: number }) => {
      if (!userId) return;
      try {
        await patchEventTimes({ userId, ...args });
      } catch (err) {
        console.error("patchEventTimes failed", err);
      }
    },
    [userId, patchEventTimes],
  );

  const onCreateEvent = useCallback(
    async (args: { start: number; end: number }) => {
      if (!userId || !defaultCalendarId) return;
      try {
        await createEvent({
          userId,
          calendarId: defaultCalendarId,
          summary: "(no title)",
          start: args.start,
          end: args.end,
          allDay: false,
        });
      } catch (err) {
        console.error("createEvent failed", err);
      }
    },
    [userId, defaultCalendarId, createEvent],
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
    () => setAnchor((a) => navigate(view, a, -1)),
    [view],
  );
  const goNext = useCallback(
    () => setAnchor((a) => navigate(view, a, 1)),
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
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToday, goPrev, goNext]);

  if (!userId) return null;

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-2 px-6 pb-3 pt-1">
      <Toolbar
        view={view}
        setView={setView}
        title={titleFor(view, anchor)}
        onToday={goToday}
        onPrev={goPrev}
        onNext={goNext}
      />
      {events === undefined ? (
        <p className="px-2 py-8 text-sm text-muted-foreground">Loading…</p>
      ) : view === "agenda" ? (
        <AgendaView events={events} anchor={anchor} />
      ) : view === "month" ? (
        <MonthView events={events} anchor={anchor} />
      ) : (
        <DaysView
          events={events}
          anchor={anchor}
          numDays={numDaysFor(view)}
          onMoveEvent={onMoveEvent}
          onCreateEvent={defaultCalendarId ? onCreateEvent : null}
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
