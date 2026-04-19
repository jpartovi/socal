"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@socal/ui/components/dropdown-menu";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useAuth } from "@/lib/auth";

const SIDEBAR_WIDTH_KEY = "socal.sidebarWidth";
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256;

type CalendarRow = {
  _id: Id<"calendars">;
  googleAccountId: Id<"googleAccounts">;
  googleCalendarId: string;
  summary: string;
  summaryOverride?: string;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  backgroundColor: string;
  foregroundColor: string;
  colorOverride?: string;
  isPrimary: boolean;
  isEnabled: boolean;
  hiddenFromList?: boolean;
};

type Notice = { id: number; message: string };

type FriendEntry = {
  friendshipId: Id<"friendships">;
  user: {
    _id: Id<"users">;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    photoUrl: string | null;
  };
};

const GOOGLE_CALENDAR_COLORS = [
  "#d65a7f",
  "#f06a3a",
  "#d9bf45",
  "#4a9b62",
  "#6f73c8",
  "#a05ab9",
  "#df5a79",
  "#ee7d31",
  "#c1c84d",
  "#4aa69a",
  "#8289c7",
  "#a8877b",
  "#f4511e",
  "#ee9b35",
  "#86ad4f",
  "#4aa3cf",
  "#b7a4d0",
  "#7a7a7a",
  "#e67c73",
  "#f6bf26",
  "#33b679",
  "#3f51b5",
  "#9e69af",
  "#a49d90",
];

export function CalendarsSidebar() {
  const { userId } = useAuth();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const asideRef = useRef<HTMLElement>(null);
  const accounts = useQuery(
    api.googleAccounts.listByUser,
    userId ? { userId } : "skip",
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        setWidth(
          Math.min(
            SIDEBAR_MAX_WIDTH,
            Math.max(SIDEBAR_MIN_WIDTH, parsed),
          ),
        );
      }
    }
  }, []);

  useEffect(() => {
    if (notice === null) return;
    const timeout = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const notify = (message: string) => {
    setNotice({ id: Date.now(), message });
  };

  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!asideRef.current) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = asideRef.current.getBoundingClientRect().width;

      const handleMove = (ev: PointerEvent) => {
        const next = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX)),
        );
        setWidth(next);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setWidth((current) => {
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(current));
          return current;
        });
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [],
  );

  if (!userId) return null;

  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col gap-6 border-r px-4 pb-4 pt-3"
      style={{ width: `${width}px` }}
    >
      <FriendsSection userId={userId} notify={notify} />
      <div className="flex flex-col gap-4">
        {accounts === undefined ? (
          <p className="px-1 text-xs text-muted-foreground">Loading...</p>
        ) : accounts.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            No calendar accounts connected.
          </p>
        ) : (
          accounts.map((acc) => (
            <AccountSection
              key={acc._id}
              userId={userId}
              accountId={acc._id}
              notify={notify}
            />
          ))
        )}
      </div>
      <Link
        href="/calendar-accounts"
        className="mt-auto rounded-md border px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted"
      >
        Manage accounts
      </Link>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={handleResizeStart}
        className="absolute inset-y-0 right-0 w-1.5 translate-x-1/2 cursor-col-resize"
      />
      {notice !== null && (
        <div
          key={notice.id}
          role="status"
          className="fixed bottom-4 left-4 z-50 max-w-80 rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md"
        >
          {notice.message}
        </div>
      )}
    </aside>
  );
}

function FriendsSection({
  userId,
  notify,
}: {
  userId: Id<"users">;
  notify: (message: string) => void;
}) {
  const data = useQuery(api.friendships.listConnections, { userId });
  const sendRequestByPhone = useMutation(api.friendships.sendRequestByPhone);
  const acceptRequest = useMutation(api.friendships.acceptRequest);
  const removeById = useMutation(api.friendships.removeById);
  const cancelPhoneInvite = useMutation(api.friendships.cancelPhoneInvite);
  const [phone, setPhone] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [isPhoneFormOpen, setIsPhoneFormOpen] = useState(false);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed || isInviting) return;
    setIsInviting(true);
    try {
      const result = await sendRequestByPhone({
        fromUserId: userId,
        phoneNumber: trimmed,
      });
      if (result.status === "no_user") {
        window.location.href = smsInviteLink(trimmed);
        notify("Opening Messages to invite them.");
      } else if (result.status === "already_friends") {
        notify("You're already friends.");
      } else if (result.status === "already_pending") {
        notify("You've already sent them a request.");
      } else {
        notify(result.status === "accepted" ? "Friends!" : "Invite sent.");
      }
      setPhone("");
      setIsPhoneFormOpen(false);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setIsInviting(false);
    }
  }

  if (data === undefined) {
    return (
      <section className="flex flex-col gap-2">
        <h4 className="px-1 pb-0.5 text-[10px] text-muted-foreground/70">
          Friends
        </h4>
        <p className="px-1 text-xs text-muted-foreground">Loading...</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="px-1 pb-0.5 text-[10px] text-muted-foreground/70">
        Friends
      </h4>
      {data.friends.length === 0 &&
      data.incoming.length === 0 &&
      data.outgoing.length === 0 &&
      data.outgoingPhoneInvites.length === 0 ? (
        <p className="px-1 text-[11px] leading-5 text-muted-foreground">
          Add people you want to spend time with
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.incoming.map((entry) => (
            <RequestRow
              key={entry.friendshipId}
              entry={entry}
              action="Accept"
              onAction={() =>
                acceptRequest({ userId, friendshipId: entry.friendshipId })
              }
              onRemove={() =>
                removeById({ userId, friendshipId: entry.friendshipId })
              }
            />
          ))}
          {data.outgoing.map((entry) => (
            <RequestRow
              key={entry.friendshipId}
              entry={entry}
              action="Invited"
              onAction={null}
              onRemove={() =>
                removeById({ userId, friendshipId: entry.friendshipId })
              }
            />
          ))}
          {data.outgoingPhoneInvites.map((invite) => (
            <PhoneInviteRow
              key={invite.inviteId}
              invite={invite}
              onRemove={() =>
                cancelPhoneInvite({ userId, inviteId: invite.inviteId })
              }
            />
          ))}
          {data.friends.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
              {data.friends.map((entry) => (
                <FriendAvatar key={entry.friendshipId} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-col gap-1 px-1">
        {!isPhoneFormOpen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsPhoneFormOpen(true)}
            className="h-8 rounded-md px-2 text-xs"
          >
            Add phone number
          </Button>
        ) : (
          <form onSubmit={handleInvite} className="flex gap-1">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder="phone number"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={isInviting}
              className="h-8 min-w-0 flex-1 rounded-md px-2 text-xs md:text-xs"
            />
            <Button
              type="submit"
              size="sm"
              disabled={isInviting || !phone.trim()}
              className="h-8 rounded-md px-2 text-xs"
            >
              Invite
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function RequestRow({
  entry,
  action,
  onAction,
  onRemove,
}: {
  entry: FriendEntry;
  action: "Accept" | "Invited";
  onAction: (() => void) | null;
  onRemove: () => void;
}) {
  const name = friendName(entry);
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
      <FriendAvatar entry={entry} />
      <span className="min-w-0 flex-1 truncate text-xs" title={name}>
        {name}
      </span>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="rounded-md px-1.5 py-1 text-xs hover:bg-background"
        >
          {action}
        </button>
      ) : (
        <span className="text-[10px] text-muted-foreground">{action}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={onAction ? `Reject ${name}` : `Cancel invite to ${name}`}
      >
        &times;
      </button>
    </div>
  );
}

function PhoneInviteRow({
  invite,
  onRemove,
}: {
  invite: {
    inviteId: Id<"phoneInvites">;
    phoneNumber: string;
    name: string | null;
    invitedAt: number;
  };
  onRemove: () => void;
}) {
  const label = invite.name ?? invite.phoneNumber;
  const initials =
    (invite.name?.trim().split(/\s+/) ?? [])
      .map((p) => p[0]?.toUpperCase() ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join("") || "?";
  return (
    <div
      className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted"
      title={invite.name ? `${invite.name} · ${invite.phoneNumber}` : label}
    >
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-[10px] font-medium text-muted-foreground">
        {initials}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      <span className="text-[10px] text-muted-foreground">Texted</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Cancel invite to ${label}`}
      >
        &times;
      </button>
    </div>
  );
}

function FriendAvatar({ entry }: { entry: FriendEntry }) {
  const name = friendName(entry);
  const initials =
    (entry.user.firstName[0] ?? "").toUpperCase() +
    (entry.user.lastName[0] ?? "").toUpperCase();
  return (
    <span
      title={name}
      className="group relative flex h-12 w-9 shrink-0 items-start justify-center"
    >
      <span className="relative z-10 flex size-9 items-center justify-center overflow-hidden rounded-full border bg-muted text-[11px] font-medium text-muted-foreground transition-transform duration-150 group-hover:-translate-y-1">
        {entry.user.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.user.photoUrl}
            alt={name}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{initials || "?"}</span>
        )}
      </span>
      <FriendStickBody />
    </span>
  );
}

function FriendStickBody() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      className="absolute left-1/2 top-7 h-5 w-5 -translate-x-1/2 -translate-y-1 scale-y-50 text-muted-foreground opacity-0 transition duration-150 group-hover:translate-y-0 group-hover:scale-y-100 group-hover:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.5v7" />
      <path d="M5.5 5.75c1 .6 2.15.9 3.5.9s2.5-.3 3.5-.9" />
      <path d="M9 9.5 6 15" />
      <path d="M9 9.5 12 15" />
    </svg>
  );
}

function friendName(entry: FriendEntry): string {
  return `${entry.user.firstName} ${entry.user.lastName}`;
}

function smsInviteLink(phone: string): string {
  const body =
    "make plans w me on socal!! https://socal.example.com (link coming soon)";
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

function AccountSection({
  userId,
  accountId,
  notify,
}: {
  userId: Id<"users">;
  accountId: Id<"googleAccounts">;
  notify: (message: string) => void;
}) {
  const calendars = useQuery(api.calendars.listByAccount, {
    googleAccountId: accountId,
  });
  const visibleCalendars = calendars?.filter((c) => !c.hiddenFromList) ?? [];

  const mine =
    visibleCalendars.filter(
      (c) => c.accessRole === "owner" || c.accessRole === "writer",
    ) ?? [];
  const others =
    visibleCalendars.filter(
      (c) => c.accessRole === "reader" || c.accessRole === "freeBusyReader",
    ) ?? [];

  const byDisplay = (a: CalendarRow, b: CalendarRow) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  };
  mine.sort(byDisplay);
  others.sort(byDisplay);

  return (
    <div className="flex flex-col gap-2">
      {calendars === undefined ? (
        <p className="px-1 text-xs text-muted-foreground">Loading...</p>
      ) : calendars.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No calendars.</p>
      ) : visibleCalendars.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          All calendars are hidden from this list.
        </p>
      ) : (
        <>
          {mine.length > 0 && (
            <Group
              label="My calendars"
              calendars={mine}
              userId={userId}
              notify={notify}
            />
          )}
          {others.length > 0 && (
            <Group
              label="Other calendars"
              calendars={others}
              userId={userId}
              notify={notify}
            />
          )}
        </>
      )}
    </div>
  );
}

function Group({
  label,
  calendars,
  userId,
  notify,
}: {
  label: string;
  calendars: CalendarRow[];
  userId: Id<"users">;
  notify: (message: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <h4 className="px-1 pb-0.5 text-[10px] text-muted-foreground/70">
        {label}
      </h4>
      <ul className="flex flex-col">
        {calendars.map((c) => (
          <SidebarRow
            key={c._id}
            calendar={c}
            userId={userId}
            notify={notify}
          />
        ))}
      </ul>
    </div>
  );
}

function SidebarRow({
  calendar,
  userId,
  notify,
}: {
  calendar: CalendarRow;
  userId: Id<"users">;
  notify: (message: string) => void;
}) {
  const setEnabled = useMutation(api.calendars.setEnabled);
  const setHiddenFromList = useMutation(api.calendars.setHiddenFromList);
  const setColorOverride = useMutation(api.calendars.setColorOverride);
  const displayOnly = useMutation(api.calendars.displayOnly);
  const unsubscribe = useAction(api.calendars.unsubscribe);
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);
  const name = displayName(calendar);
  const color = calendar.colorOverride ?? calendar.backgroundColor;

  const toggleEnabled = () =>
    setEnabled({
      userId,
      calendarId: calendar._id,
      isEnabled: !calendar.isEnabled,
    });

  const confirmUnsubscribe = async () => {
    if (calendar.isPrimary) return;
    setIsUnsubscribing(true);
    try {
      await unsubscribe({
        userId,
        calendarId: calendar._id,
      });
      setConfirmingUnsubscribe(false);
      notify(`Unsubscribed from ${name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not unsubscribe.");
    } finally {
      setIsUnsubscribing(false);
    }
  };

  return (
    <li className="group/row relative flex items-center rounded-md hover:bg-muted">
      <button
        type="button"
        onClick={toggleEnabled}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
        aria-pressed={calendar.isEnabled}
      >
        <ColorCheckbox color={color} checked={calendar.isEnabled} />
        <span
          className={`truncate text-xs ${
            calendar.isEnabled ? "" : "text-muted-foreground"
          }`}
          title={name}
        >
          {name}
        </span>
      </button>
      {!calendar.isPrimary && (
        <button
          type="button"
          onClick={() => setConfirmingUnsubscribe(true)}
          className="mr-0.5 hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover/row:inline-flex"
          aria-label={`Unsubscribe from ${name}`}
          title={`Unsubscribe from ${name}`}
        >
          <span aria-hidden className="text-lg leading-none">
            &times;
          </span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground group-hover/row:inline-flex data-[state=open]:inline-flex"
            aria-label={`Options for ${name}`}
            title={`Options for ${name}`}
          >
            <span aria-hidden className="flex flex-col gap-0.5">
              <span className="size-1 rounded-full bg-current" />
              <span className="size-1 rounded-full bg-current" />
              <span className="size-1 rounded-full bg-current" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-52">
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => displayOnly({ userId, calendarId: calendar._id })}
          >
            Display this only
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            onSelect={() =>
              setHiddenFromList({
                userId,
                calendarId: calendar._id,
                hiddenFromList: true,
              })
            }
          >
            Hide from list
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" disabled>
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="grid grid-cols-6 gap-1.5 p-2">
            {GOOGLE_CALENDAR_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() =>
                  setColorOverride({
                    userId,
                    calendarId: calendar._id,
                    colorOverride: swatch,
                  })
                }
                className="flex size-5 items-center justify-center rounded-full border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ backgroundColor: swatch }}
                aria-label={`Use color ${swatch}`}
              >
                {color.toLowerCase() === swatch.toLowerCase() && (
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className="size-3"
                    fill="none"
                    stroke="white"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmingUnsubscribe && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`unsubscribe-${calendar._id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        >
          <div className="w-full max-w-xl rounded-md border bg-popover p-6 text-popover-foreground shadow-lg">
            <p
              id={`unsubscribe-${calendar._id}`}
              className="text-sm leading-6 text-muted-foreground"
            >
              Are you sure you want to remove {name}? You&apos;ll no longer
              have access to this calendar and its events. Other people with
              access to the calendar can continue to use it.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingUnsubscribe(false)}
                disabled={isUnsubscribing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmUnsubscribe}
                disabled={isUnsubscribing}
              >
                {isUnsubscribing ? "Removing..." : "Remove calendar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function ColorCheckbox({
  color,
  checked,
}: {
  color: string;
  checked: boolean;
}) {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors"
      style={{
        borderColor: color,
        backgroundColor: checked ? color : "transparent",
      }}
    >
      {checked && (
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="white"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
        </svg>
      )}
    </span>
  );
}

function displayName(c: CalendarRow): string {
  return c.summaryOverride && c.summaryOverride.length > 0
    ? c.summaryOverride
    : c.summary;
}
