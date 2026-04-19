"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@socal/ui/components/popover";
import { useAction } from "convex/react";
import { useState, type ReactNode } from "react";

import { formatTime } from "@/components/calendar/lib";
import type { EventRow } from "@/components/calendar/types";
import { useAuth } from "@/lib/auth";

export function EventPopover({
  row,
  children,
}: {
  row: EventRow;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEditing(false);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-80 p-4 text-sm"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        {editing ? (
          <EventEditForm
            row={row}
            onDone={() => {
              setEditing(false);
              setOpen(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <EventPopoverBody
            row={row}
            onEdit={() => setEditing(true)}
            onDeleted={() => setOpen(false)}
            onClose={() => setOpen(false)}
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
  const { userId } = useAuth();
  const deleteEvent = useAction(api.events.deleteEvent);
  const [deleting, setDeleting] = useState(false);
  const { event, calendar } = row;
  const calendarName = calendar.summaryOverride ?? calendar.summary;
  const timeLabel = formatEventTimeRange(
    event.start,
    event.end,
    event.allDay,
  );
  const descriptionText = event.description
    ? stripHtml(event.description)
    : null;
  const canEdit = writable(row);

  const handleDelete = async () => {
    if (!userId) return;
    if (!confirm("Delete this event?")) return;
    setDeleting(true);
    try {
      await deleteEvent({ userId, eventId: event._id });
      onDeleted();
    } catch (err) {
      console.error("deleteEvent failed", err);
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 -mt-2 flex items-center justify-end gap-0.5">
        {canEdit && (
          <>
            <IconButton onClick={onEdit} label="Edit">
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={handleDelete}
              disabled={deleting}
              label="Delete"
            >
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
          style={{ backgroundColor: calendar.backgroundColor }}
        />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-lg font-medium leading-tight">
            {event.summary || "(no title)"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{timeLabel}</p>
        </div>
      </div>

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
        <span className="text-xs text-muted-foreground">{calendarName}</span>
      </Row>
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
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
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
  onCancel,
}: {
  row: EventRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { userId } = useAuth();
  const updateEventFields = useAction(api.events.updateEventFields);
  const [summary, setSummary] = useState(row.event.summary);
  const [location, setLocation] = useState(row.event.location ?? "");
  const [description, setDescription] = useState(
    row.event.description ? stripHtml(row.event.description) : "",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await updateEventFields({
        userId,
        eventId: row.event._id,
        summary: summary.trim() || "(no title)",
        location,
        description,
      });
      onDone();
    } catch (err) {
      console.error("updateEventFields failed", err);
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-2 h-3 w-3 shrink-0 rounded-[3px]"
          style={{ backgroundColor: row.calendar.backgroundColor }}
        />
        <Input
          autoFocus
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Add title"
          className="h-8 text-sm font-medium"
        />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Location</span>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Add location"
          className="h-8 text-xs"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add description"
          rows={4}
          className="resize-y rounded-md border bg-background px-2 py-1 text-xs leading-snug outline-none focus:ring-2 focus:ring-ring/40"
        />
      </label>

      <p className="text-[11px] text-muted-foreground">
        Drag the event on the grid to change its time.
      </p>

      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          Save
        </Button>
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
