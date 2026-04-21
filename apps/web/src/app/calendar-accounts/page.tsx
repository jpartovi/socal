"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@socal/ui/components/dropdown-menu";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/lib/auth";

export default function CalendarAccountsPage() {
  return (
    <RequireAuth>
      <main className="min-h-screen">
        <header className="flex items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Home">
            <Wordmark size="sm" />
          </Link>
          <UserMenu />
        </header>
        <CalendarAccountsContent />
      </main>
    </RequireAuth>
  );
}

function CalendarAccountsContent() {
  const { userId } = useAuth();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const warning = searchParams.get("warning");

  const accounts = useQuery(
    api.googleAccounts.listByUser,
    userId ? { userId } : "skip",
  );
  const user = useQuery(
    api.users.getById,
    userId ? { userId } : "skip",
  );
  const primaryAccount = useQuery(
    api.googleAccounts.getPrimaryForUser,
    userId ? { userId } : "skip",
  );

  if (!userId || !accounts || user === undefined) return null;

  const effectivePrimaryId: Id<"googleAccounts"> | undefined =
    user.primaryGoogleAccountId ?? primaryAccount?._id;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-6">
      <h1 className="text-lg font-medium">Calendar accounts</h1>

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Couldn&apos;t connect: {decodeURIComponent(error)}
        </p>
      )}
      {warning && (
        <p className="rounded-xl border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Connected, but loading calendars failed:{" "}
          {decodeURIComponent(warning)}
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calendar accounts connected yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((acc) => (
            <AccountRow
              key={acc._id}
              userId={userId}
              account={acc}
              isPrimary={
                effectivePrimaryId !== undefined && acc._id === effectivePrimaryId
              }
            />
          ))}
        </ul>
      )}

      <a href={`/api/auth/google/start?userId=${userId}`}>
        <Button className="h-11 w-full rounded-2xl text-base">
          {accounts.length === 0
            ? "Connect a Google account"
            : "Connect another account"}
        </Button>
      </a>
    </section>
  );
}

type AccountSummary = {
  _id: Id<"googleAccounts">;
  _creationTime: number;
  email: string;
  name?: string;
  pictureUrl?: string;
  connectedAt: number;
};

function AccountRow({
  userId,
  account,
  isPrimary,
}: {
  userId: Id<"users">;
  account: AccountSummary;
  isPrimary: boolean;
}) {
  const disconnect = useMutation(api.googleAccounts.disconnect);
  const setPrimaryGoogleAccount = useMutation(
    api.googleAccounts.setPrimaryGoogleAccount,
  );

  return (
    <li className="flex items-center gap-2 rounded-2xl border px-3 py-3">
      <span className="flex w-8 shrink-0 justify-center">
        {isPrimary ? (
          <span
            title="Default Google account — assistant proposals, quick-create, and friend calendar invites use this account"
            className="text-amber-500 dark:text-amber-400"
            aria-hidden
          >
            <StarFilledIcon className="h-4 w-4" />
          </span>
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{account.email}</span>
        {account.name && (
          <span className="truncate text-xs text-muted-foreground">
            {account.name}
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-xl p-0 text-muted-foreground"
            aria-label="Account options"
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {!isPrimary ? (
            <DropdownMenuItem
              onClick={() =>
                setPrimaryGoogleAccount({
                  userId,
                  googleAccountId: account._id,
                })
              }
            >
              Make default
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => disconnect({ userId, accountId: account._id })}
          >
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function StarFilledIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M8 1.5l1.85 3.76 4.15.6-3 2.92.71 4.14L8 11.9l-3.71 1.95.71-4.14-3-2.92 4.15-.6L8 1.5z" />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}
