"use client";

import Link from "next/link";

import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";

type Shortcut = { keys: string[]; description: string };
type Group = { label: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    label: "Views",
    items: [
      { keys: ["a"], description: "Agenda" },
      { keys: ["d"], description: "Day" },
      { keys: ["x"], description: "4-day" },
      { keys: ["w"], description: "Week" },
      { keys: ["m"], description: "Month" },
    ],
  },
  {
    label: "Navigate",
    items: [
      { keys: ["t"], description: "Jump to today" },
      { keys: ["j", "←"], description: "Previous period" },
      { keys: ["k", "→"], description: "Next period" },
    ],
  },
  {
    label: "Actions",
    items: [
      { keys: ["c"], description: "Focus the quick-create input" },
      { keys: ["["], description: "Toggle calendars sidebar" },
      { keys: ["r"], description: "Sync calendars now" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
  {
    label: "Event popover",
    items: [
      { keys: ["e"], description: "Edit the open event" },
      { keys: ["⌫", "del"], description: "Delete the open event" },
      { keys: ["esc"], description: "Close the popover" },
    ],
  },
];

export default function KeyboardShortcutsPage() {
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
          {GROUPS.map((group) => (
            <Section key={group.label} label={group.label}>
              <List>
                {group.items.map((item) => (
                  <Row key={item.description}>
                    <span className="min-w-0 truncate text-base">
                      {item.description}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-xs text-muted-foreground">
                              or
                            </span>
                          )}
                          <kbd className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border bg-muted px-2 text-xs font-medium tracking-wide">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </Row>
                ))}
              </List>
            </Section>
          ))}
        </section>
      </main>
    </RequireAuth>
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
      <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      {children}
    </div>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border">{children}</ul>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex h-14 items-center justify-between gap-3 px-4">
      {children}
    </li>
  );
}
