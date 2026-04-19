"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
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

  if (!userId || !accounts) return null;

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
            <AccountRow key={acc._id} userId={userId} account={acc} />
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
}: {
  userId: Id<"users">;
  account: AccountSummary;
}) {
  const disconnect = useMutation(api.googleAccounts.disconnect);

  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{account.email}</span>
        {account.name && (
          <span className="truncate text-xs text-muted-foreground">
            {account.name}
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 shrink-0 rounded-xl px-3 text-muted-foreground"
        onClick={() => disconnect({ userId, accountId: account._id })}
      >
        Disconnect
      </Button>
    </li>
  );
}
