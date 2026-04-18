"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { Button } from "@socal/ui/components/button";
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

  if (!user) return null;

  const name = `${user.firstName} ${user.lastName}`;

  function handleSignOut() {
    signOut();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-10 rounded-full px-4">
          {name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-2xl">
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
        <DropdownMenuItem onSelect={handleSignOut} className="rounded-xl">
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
