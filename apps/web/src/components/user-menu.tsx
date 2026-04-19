"use client";

import { api } from "@socal/backend/convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@socal/ui/components/dropdown-menu";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";

export function UserMenu() {
  const router = useRouter();
  const { userId, signOut } = useAuth();
  const user = useQuery(api.users.getById, userId ? { userId } : "skip");
  const accounts = useQuery(
    api.googleAccounts.listByUser,
    userId ? { userId } : "skip",
  );

  if (!user) return null;

  const name = `${user.firstName} ${user.lastName}`;
  const pictureUrl =
    user.photoUrl ??
    (user.useDefaultAvatar !== false
      ? accounts?.find((a) => a.pictureUrl)?.pictureUrl
      : undefined);
  const initials =
    (user.firstName[0] ?? "").toUpperCase() +
    (user.lastName[0] ?? "").toUpperCase();

  function handleSignOut() {
    signOut();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={name}
          title={name}
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs font-medium text-muted-foreground transition hover:bg-muted/70"
        >
          {pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pictureUrl}
              alt={name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : user.useDefaultAvatar === false ? (
            <StickFigureAvatar className="h-5 w-5" />
          ) : (
            <span>{initials || "?"}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl">
        <DropdownMenuItem
          onSelect={() => router.push("/profile")}
          className="rounded-xl"
        >
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => router.push("/friends")}
          className="rounded-xl"
        >
          Friends
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => router.push("/calendar-accounts")}
          className="rounded-xl"
        >
          Calendar accounts
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => router.push("/keyboard-shortcuts")}
          className="rounded-xl"
        >
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSignOut} className="rounded-xl">
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StickFigureAvatar({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="6.5" r="3" />
      <path d="M12 9.5v6" />
      <path d="M7.5 12.5h9" />
      <path d="M12 15.5l-4 5" />
      <path d="M12 15.5l4 5" />
    </svg>
  );
}
