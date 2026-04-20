"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/lib/auth";

export default function FriendsPage() {
  return (
    <RequireAuth>
      <main className="min-h-screen">
        <header className="flex items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Home">
            <Wordmark size="sm" />
          </Link>
          <UserMenu />
        </header>
        <FriendsContent />
      </main>
    </RequireAuth>
  );
}

function FriendsContent() {
  const { userId } = useAuth();
  const data = useQuery(
    api.friendships.listConnections,
    userId ? { userId } : "skip",
  );

  if (!userId || !data) {
    return null;
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-6">
      <InviteForm userId={userId} />
      {data.incoming.length > 0 && (
        <Section label="Invitations">
          <IncomingList userId={userId} incoming={data.incoming} />
        </Section>
      )}
      <Section label="Friends">
        <FriendList userId={userId} friends={data.friends} />
      </Section>
    </section>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      {children}
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return err.data;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

function InviteForm({ userId }: { userId: Id<"users"> }) {
  const sendRequestByPhone = useMutation(api.friendships.sendRequestByPhone);
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<
    { tone: "error" | "info"; text: string } | null
  >(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await sendRequestByPhone({
        fromUserId: userId,
        phoneNumber: trimmed,
      });
      setPhone("");
      if (result.status === "sent") {
        setMessage({ tone: "info", text: "Request sent" });
      } else if (result.status === "accepted") {
        setMessage({
          tone: "info",
          text: "You're now friends — they'd already sent you a request",
        });
      } else if (result.status === "already_pending") {
        setMessage({ tone: "info", text: "Request already pending" });
      } else if (result.status === "already_friends") {
        setMessage({ tone: "info", text: "You're already friends" });
      } else {
        setMessage({
          tone: "info",
          text: "They're not on socal yet — we'll connect you when they join",
        });
      }
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="phone number"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setMessage(null);
          }}
          disabled={isSubmitting}
          className="h-11 flex-1 rounded-2xl px-4 text-base md:text-base"
        />
        <Button
          type="submit"
          disabled={isSubmitting || !phone.trim()}
          className="h-11 shrink-0 rounded-2xl px-5 text-base"
        >
          Invite
        </Button>
      </div>
      <p
        className={`min-h-4 px-1 text-xs ${
          message?.tone === "error"
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {message?.text ?? ""}
      </p>
    </form>
  );
}

type ConnectionEntry = {
  friendshipId: Id<"friendships">;
  user: {
    _id: Id<"users">;
    firstName: string;
    lastName: string;
    phoneNumber: string;
  };
  iAllowFriend: boolean;
  friendAllowsMe: boolean;
};

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex h-14 items-center justify-between gap-3 px-4">
      {children}
    </li>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border">{children}</ul>
  );
}

function IncomingList({
  userId,
  incoming,
}: {
  userId: Id<"users">;
  incoming: ConnectionEntry[];
}) {
  const accept = useMutation(api.friendships.acceptRequest);
  const remove = useMutation(api.friendships.removeById);

  return (
    <List>
      {incoming.map((entry) => (
        <Row key={entry.friendshipId}>
          <span className="min-w-0 truncate text-base">
            {entry.user.firstName} {entry.user.lastName}
          </span>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              className="h-8 rounded-xl px-3"
              onClick={() =>
                accept({ userId, friendshipId: entry.friendshipId })
              }
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-xl px-3 text-muted-foreground"
              onClick={() =>
                remove({ userId, friendshipId: entry.friendshipId })
              }
            >
              Reject
            </Button>
          </div>
        </Row>
      ))}
    </List>
  );
}

function FriendList({
  userId,
  friends,
}: {
  userId: Id<"users">;
  friends: ConnectionEntry[];
}) {
  const setAgentAccess = useMutation(api.friendships.setAgentAccess);
  if (friends.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">No friends yet.</p>
    );
  }
  return (
    <List>
      {friends.map((entry) => (
        <li
          key={entry.friendshipId}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 flex-col">
            <span className="min-w-0 truncate text-base">
              {entry.user.firstName} {entry.user.lastName}
            </span>
            {!entry.friendAllowsMe && (
              <span className="text-xs text-muted-foreground">
                Not sharing their calendar with you
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant={entry.iAllowFriend ? "secondary" : "ghost"}
            className="h-8 shrink-0 rounded-xl px-3 text-xs"
            onClick={() =>
              setAgentAccess({
                userId,
                otherUserId: entry.user._id,
                allow: !entry.iAllowFriend,
              })
            }
          >
            {entry.iAllowFriend ? "Sharing calendar" : "Share calendar"}
          </Button>
        </li>
      ))}
    </List>
  );
}
