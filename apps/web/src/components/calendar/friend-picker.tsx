"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Avatar } from "@socal/ui/components/avatar";
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";

type FriendOption = {
  userId: Id<"users">;
  name: string;
  photoUrl?: string;
};

type FriendPickerProps = {
  userId: Id<"users">;
  selected: Id<"users">[];
  onChange: (next: Id<"users">[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

export function FriendPicker({
  userId,
  selected,
  onChange,
  placeholder = "Add friends",
  autoFocus,
}: FriendPickerProps) {
  const data = useQuery(api.friendships.listConnections, { userId });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allFriends: FriendOption[] = useMemo(
    () =>
      (data?.friends ?? []).map((f) => ({
        userId: f.user._id,
        name: `${f.user.firstName} ${f.user.lastName}`.trim(),
        photoUrl: f.user.photoUrl ?? undefined,
      })),
    [data],
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedOptions = useMemo(
    () => allFriends.filter((f) => selectedSet.has(f.userId)),
    [allFriends, selectedSet],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allFriends
      .filter((f) => !selectedSet.has(f.userId))
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [allFriends, selectedSet, query]);

  function add(friendId: Id<"users">) {
    onChange([...selected, friendId]);
    setQuery("");
    inputRef.current?.focus();
  }
  function remove(friendId: Id<"users">) {
    onChange(selected.filter((id) => id !== friendId));
  }

  return (
    <div className="relative w-full">
      <div
        className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {selectedOptions.map((f) => (
          <span
            key={f.userId}
            className="flex items-center gap-1 rounded-full border bg-muted py-0.5 pl-0.5 pr-1.5 text-xs"
          >
            <Avatar name={f.name} photoUrl={f.photoUrl} size="xs" />
            <span className="truncate">{f.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(f.userId);
              }}
              aria-label={`Remove ${f.name}`}
              className="rounded text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so the click on a dropdown row registers before close.
            setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && query === "" && selected.length > 0) {
              remove(selected[selected.length - 1]);
            } else if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              add(matches[0].userId);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={selectedOptions.length === 0 ? placeholder : ""}
          className="min-w-[8ch] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {matches.map((f) => (
            <button
              key={f.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(f.userId);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Avatar name={f.name} photoUrl={f.photoUrl} size="sm" />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
