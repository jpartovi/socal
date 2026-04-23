"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { Avatar } from "@socal/ui/components/avatar";
import { Input } from "@socal/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@socal/ui/components/popover";
import { useAction, useMutation } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  EVENT_COLOR_SWATCHES,
  eventColor,
} from "@/components/calendar/colors";
import { formatTime } from "@/components/calendar/lib";
import type { EventRow } from "@/components/calendar/types";
import { useAuth } from "@/lib/auth";
import { useUndo } from "@/lib/undo";

export function EventPopover({
  row,
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultEditing = false,
}: {
  row: EventRow;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultEditing?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [editing, setEditing] = useState(defaultEditing);

  // When opened programmatically with defaultEditing, jump straight into edit.
  useEffect(() => {
    if (open && defaultEditing) setEditing(true);
  }, [open, defaultEditing]);

  const handleOpenChange = (o: boolean) => {
    if (!isControlled) setInternalOpen(o);
    controlledOnOpenChange?.(o);
    if (!o) setEditing(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className={
          editing
            ? "w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-lg p-0 text-sm"
            : "w-80 p-4 text-sm"
        }
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        {editing ? (
          <EventEditForm
            row={row}
            onDone={() => {
              setEditing(false);
              handleOpenChange(false);
            }}
          />
        ) : (
          <EventPopoverBody
            row={row}
            onEdit={() => setEditing(true)}
            onDeleted={() => handleOpenChange(false)}
            onClose={() => handleOpenChange(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function writable(row: EventRow): boolean {
  const r = row.calendar.accessRole;
  return r === "owner" || r === "writer";
}

function EventPopoverBody({
  row,
  onEdit,
  onDeleted,
  onClose,
}: {
  row: EventRow;
  onEdit: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { requestDelete } = useUndo();
  const { userId } = useAuth();
  const updateEventColor = useMutation(api.events.updateEventColor);
  const { event, calendar } = row;
  const color = eventColor(row);
  const accountName = calendar.googleAccountName ?? calendar.googleAccountEmail;
  const timeLabel = formatEventTimeRange(
    event.start,
    event.end,
    event.allDay,
  );
  const descriptionText = event.description
    ? stripHtml(event.description)
    : null;
  const canEdit = writable(row);

  const handleDelete = () => {
    requestDelete(event._id);
    onDeleted();
  };

  const setColor = (nextColor: string | null) => {
    if (!userId) return;
    updateEventColor({
      userId,
      eventId: event._id,
      colorOverride: nextColor,
    }).catch((err) => {
      console.error("updateEventColor failed", err);
    });
  };

  // Popover-scoped shortcuts: e = edit, Delete/Backspace = delete. The popover
  // itself handles Escape via Radix.
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
      if ((e.key === "e" || e.key === "E") && canEdit) {
        e.preventDefault();
        onEdit();
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        canEdit
      ) {
        e.preventDefault();
        handleDelete();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleDelete closes over requestDelete/onDeleted which are stable from
    // their hooks/callers; re-binding on every keystroke isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, onEdit]);

  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 -mt-2 flex items-center justify-end gap-0.5">
        {canEdit && (
          <>
            <IconButton onClick={onEdit} label="Edit">
              <EditIcon />
            </IconButton>
            <IconButton onClick={handleDelete} label="Delete">
              <TrashIcon />
            </IconButton>
          </>
        )}
        <IconButton onClick={onClose} label="Close">
          <CloseIcon />
        </IconButton>
      </div>

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-medium leading-tight">
            {event.summary || "(no title)"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{timeLabel}</p>
        </div>
      </div>

      {event.attendees && event.attendees.length > 0 && (
        <Row icon={<PeopleIcon />}>
          <div className="flex flex-col gap-1.5">
            {event.attendees
              .filter((a) => !a.self)
              .map((a) => (
                <div key={a.email} className="flex items-center gap-2">
                  <Avatar
                    name={a.displayName ?? a.email}
                    photoUrl={a.photoUrl ?? null}
                    size="xs"
                    className="size-5 border-0"
                  />
                  <span className="truncate text-xs">
                    {a.displayName ?? a.email}
                  </span>
                </div>
              ))}
          </div>
        </Row>
      )}

      {event.location && (
        <Row icon={<LocationIcon />}>{event.location}</Row>
      )}

      {descriptionText && (
        <Row icon={<DescriptionIcon />}>
          <p className="whitespace-pre-wrap break-words text-xs leading-snug text-foreground/80">
            {descriptionText}
          </p>
        </Row>
      )}

      <Row icon={<CalendarIcon />}>
        <span className="text-xs text-muted-foreground">{accountName}</span>
      </Row>

      {canEdit && (
        <div className="pl-6">
          <div className="grid grid-cols-9 gap-1">
            <button
              type="button"
              className="h-5 w-5 rounded-full border border-border"
              style={{ backgroundColor: calendar.backgroundColor }}
              onClick={() => setColor(null)}
              aria-label="Use calendar color"
              title="Use calendar color"
            />
            {EVENT_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`h-5 w-5 rounded-full border transition ${
                  color.toLowerCase() === swatch.toLowerCase()
                    ? "border-foreground ring-2 ring-ring"
                    : "border-transparent hover:border-foreground/40"
                }`}
                style={{ backgroundColor: swatch }}
                onClick={() => setColor(swatch)}
                aria-label={`Set event color ${swatch}`}
                title={swatch}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.05] active:scale-[0.95] hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" />
      <path d="M10 4l2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5" />
      <path d="M4.5 4.5l.5 8a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5l.5-8" />
      <path d="M7 7.5v4M9 7.5v4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function EventEditForm({
  row,
  onDone,
}: {
  row: EventRow;
  onDone: () => void;
}) {
  const { userId } = useAuth();
  const { showUndoToast } = useUndo();
  const updateEventFields = useAction(api.events.updateEventFields);
  const [summary, setSummary] = useState(
    row.event.summary === "(no title)" ? "" : row.event.summary,
  );
  const [who, setWho] = useState(
    row.event.attendees?.map((a) => a.email).join(", ") ?? "",
  );
  const [location, setLocation] = useState(row.event.location ?? "");
  const lastSavedRef = useRef({
    summary: row.event.summary,
    location: row.event.location ?? "",
    attendees: row.event.attendees?.map((a) => a.email.toLowerCase()) ?? [],
  });

  const handleSave = async ({ close }: { close: boolean }) => {
    if (!userId) return;
    const nextSummary = summary.trim() || "(no title)";
    const prevSummary = lastSavedRef.current.summary;
    const prevLocation = lastSavedRef.current.location;
    const nextAttendees = parseAttendeeInput(who);
    const prevAttendees = lastSavedRef.current.attendees;
    const prevDescription = row.event.description ?? "";
    const unchanged =
      nextSummary === lastSavedRef.current.summary && location === prevLocation;
    const attendeesUnchanged = sameStringArray(nextAttendees, prevAttendees);
    if (unchanged && attendeesUnchanged) {
      if (close) onDone();
      return;
    }
    if (close) onDone();
    try {
      await updateEventFields({
        userId,
        eventId: row.event._id,
        summary: nextSummary,
        location,
        attendees: nextAttendees,
      });
      lastSavedRef.current = {
        summary: nextSummary,
        location,
        attendees: nextAttendees,
      };
      showUndoToast({
        message: "Event updated",
        onUndo: () => {
          updateEventFields({
            userId,
            eventId: row.event._id,
            summary: prevSummary,
            location: prevLocation,
            description: prevDescription,
            attendees: prevAttendees,
          }).catch((err) => {
            console.error("updateEventFields undo failed", err);
          });
        },
      });
    } catch (err) {
      console.error("updateEventFields failed", err);
    }
  };

  function submitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void handleSave({ close: true });
  }

  useEffect(() => {
    const nextSummary = summary.trim() || "(no title)";
    const unchanged =
      nextSummary === lastSavedRef.current.summary &&
      location === lastSavedRef.current.location &&
      sameStringArray(parseAttendeeInput(who), lastSavedRef.current.attendees);
    if (unchanged) return;
    const id = window.setTimeout(() => {
      void handleSave({ close: false });
    }, 900);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, who, location]);

  return (
    <div
      className="bg-card text-card-foreground"
      onKeyDownCapture={(e) => {
        if (e.key !== "Enter") return;
        const target = e.target as HTMLElement | null;
        if (target?.tagName !== "INPUT") return;
        e.preventDefault();
        void handleSave({ close: true });
      }}
    >
      <div className="flex h-9 items-center justify-between bg-muted/50 px-4">
        <span className="text-base text-muted-foreground">=</span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => void handleSave({ close: true })}
          aria-label="Close"
        >
          x
        </button>
      </div>
      <div className="space-y-4 px-8 pb-6 pt-5">
        <Input
          autoFocus
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={submitOnEnter}
          placeholder="what?"
          className="h-12 rounded-none border-0 border-b bg-transparent px-0 text-3xl font-normal shadow-none placeholder:text-muted-foreground/45 focus-visible:ring-0"
        />
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Event
          </span>
          {["Task", "Out of office", "Focus time", "Working location"].map(
            (label) => (
              <span
                key={label}
                className="px-2 py-2 text-sm font-medium text-muted-foreground"
              >
                {label}
              </span>
            ),
          )}
        </div>
        <div className="grid grid-cols-[24px_1fr] items-center gap-x-4 gap-y-3">
          <ClockIcon />
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {new Date(row.event.start).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            {formatTime(row.event.start)} - {formatTime(row.event.end)}
          </div>
          <PeopleIcon />
          <Input
            value={who}
            onChange={(e) => setWho(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="who?"
            className="h-9 border-0 bg-transparent px-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
          />
          <LocationIcon />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="where?"
            className="h-9 border-0 bg-transparent px-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
          />
          <CalendarIcon />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {row.calendar.googleAccountName ??
                row.calendar.googleAccountEmail}
            </span>
            <span
              aria-hidden
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: eventColor(row) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-sm text-foreground/90">{children}</div>
    </div>
  );
}

function formatEventTimeRange(
  start: number,
  end: number,
  allDay: boolean,
): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };

  if (allDay) {
    const inclusiveEnd = new Date(end - 1);
    if (sameYMD(startDate, inclusiveEnd)) {
      return `${startDate.toLocaleDateString(undefined, dateOpts)} · all day`;
    }
    return `${startDate.toLocaleDateString(undefined, dateOpts)} – ${inclusiveEnd.toLocaleDateString(undefined, dateOpts)}`;
  }

  if (sameYMD(startDate, endDate)) {
    return `${startDate.toLocaleDateString(undefined, dateOpts)} · ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${startDate.toLocaleDateString(undefined, dateOpts)} ${formatTime(start)} – ${endDate.toLocaleDateString(undefined, dateOpts)} ${formatTime(end)}`;
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseAttendeeInput(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of value.split(/[\s,;]+/)) {
    const email = token.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M6.5 8.25a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
      <path d="M1.75 13.25c.6-2.25 2.2-3.5 4.75-3.5s4.15 1.25 4.75 3.5" />
      <path d="M11 4.25a2.25 2.25 0 0 1 0 4.25" />
      <path d="M11.75 9.75c1.4.45 2.25 1.55 2.5 3.25" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <path d="M8 14s5-4.5 5-8.5a5 5 0 10-10 0C3 9.5 8 14 8 14z" />
      <circle cx="8" cy="5.5" r="1.75" />
    </svg>
  );
}

function DescriptionIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-4 w-4"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" strokeLinecap="round" />
    </svg>
  );
}
