"use client";

import Link from "next/link";

import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";

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
        <section className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-6">
          <h1 className="text-lg font-medium">Calendar accounts</h1>
          <p className="text-sm text-muted-foreground">
            No calendar accounts connected yet.
          </p>
        </section>
      </main>
    </RequireAuth>
  );
}
