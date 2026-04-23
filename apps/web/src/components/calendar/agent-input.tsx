"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useAgentQueue } from "@/lib/agent-queue";
import { useAuth } from "@/lib/auth";

type TaggedFriend = { name: string; userId: Id<"users"> };

// Slash chips surface the kinds of requests the agent handles — discoverable
// from a glance instead of guessing from an empty placeholder. Clicking a chip
// prefills the slug and focuses the input so the user can keep typing. The
// agent prompt teaches the model what each slug means, so we don't need
// client-side routing.
const SLASH_CHIPS: { slug: string; hint: string }[] = [
  { slug: "/meet", hint: "schedule with someone" },
  { slug: "/reschedule", hint: "move something" },
  { slug: "/protect", hint: "block focus time" },
];

// Scheduling-word vocabulary. Common words a user types when making plans —
// ghost-completed without any tagging so the user can breeze through
// "coffee with jude tomorrow morning" by typing ~half the characters. Ordered
// roughly by frequency; findCompletion picks the first prefix match.
const SCHEDULING_WORDS = [
  // meals
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "coffee",
  "drinks",
  // activities
  "walk",
  "run",
  "workout",
  "yoga",
  "gym",
  "hike",
  // social verbs
  "meet",
  "meeting",
  "hangout",
  "catchup",
  "call",
  "chat",
  // times of day
  "morning",
  "afternoon",
  "evening",
  "tonight",
  "noon",
  // relative dates
  "today",
  "tomorrow",
  "weekend",
  // weekdays
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  // work / life
  "standup",
  "interview",
  "presentation",
  "class",
  "study",
  "flight",
  "appointment",
];

type Completion =
  | {
      kind: "friend";
      ghost: string;
      friend: { firstName: string; userId: Id<"users"> };
    }
  | { kind: "word"; ghost: string; word: string };

// Cursor-style autocomplete: given the current value, find the partial token
// at the end of the string (e.g. "lunch with jud" → "jud") and match it
// against friend first names first, then the scheduling vocabulary. Returns
// the first candidate whose target has MORE characters than the partial (so
// there's always something to ghost). Case-insensitive match; preserves the
// user's original casing on the partial they already typed.
function findCompletion(
  value: string,
  friends: ReadonlyArray<{ firstName: string; userId: Id<"users"> }>,
  caretAtEnd: boolean,
): Completion | null {
  if (!caretAtEnd) return null;
  const match = /(\S+)$/.exec(value);
  if (!match) return null;
  const partial = match[1];
  if (partial.length < 1) return null;
  const lower = partial.toLowerCase();
  const friend = friends.find(
    (f) =>
      f.firstName.toLowerCase().startsWith(lower) &&
      f.firstName.length > partial.length,
  );
  if (friend) {
    return {
      kind: "friend",
      friend,
      ghost: friend.firstName.slice(partial.length),
    };
  }
  const word = SCHEDULING_WORDS.find(
    (w) => w.startsWith(lower) && w.length > partial.length,
  );
  if (word) {
    return { kind: "word", word, ghost: word.slice(partial.length) };
  }
  return null;
}

// Calendar agent entrypoint at the bottom of the home page. Enqueues the
// typed message onto the agent queue — the sidebar renders progress and
// results, so this component stays focused on capture.
export function AgentInput() {
  const { userId } = useAuth();
  const { enqueue } = useAgentQueue();
  const connections = useQuery(
    api.friendships.listConnections,
    userId ? { userId } : "skip",
  );
  const friends = useMemo(
    () =>
      (connections?.friends ?? []).map((c) => ({
        firstName: c.user.firstName,
        userId: c.user._id,
      })),
    [connections],
  );

  const [value, setValue] = useState("");
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  /** Friends accepted via Tab autocomplete. A tag survives as long as its
   *  name still appears as a whole word in the input; if the user deletes
   *  the word, the tag drops automatically on submit. */
  const [tags, setTags] = useState<TaggedFriend[]>([]);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!queueNotice) return;
    const t = window.setTimeout(() => setQueueNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [queueNotice]);

  const completion = useMemo(
    () => findCompletion(value, friends, caretAtEnd),
    [value, friends, caretAtEnd],
  );

  const acceptCompletion = () => {
    if (!completion) return;
    const match = /(\S+)$/.exec(value);
    if (!match) return;
    const partial = match[1];
    const head = value.slice(0, value.length - partial.length);
    const full =
      completion.kind === "friend" ? completion.friend.firstName : completion.word;
    setValue(`${head}${full} `);
    if (completion.kind === "friend") {
      const friend = completion.friend;
      setTags((prev) => {
        if (prev.some((t) => t.userId === friend.userId)) return prev;
        return [...prev, { name: friend.firstName, userId: friend.userId }];
      });
    }
  };

  const handleSubmit = () => {
    const text = value.trim();
    if (!text || !userId) return;
    // Keep only tags whose name still appears as a whole word in the text —
    // drops tags the user deleted without having to track ranges.
    const wordBoundary = (name: string) =>
      new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(\\s|$)`, "i");
    const activeTags = tags.filter((t) => wordBoundary(t.name).test(text));
    const result = enqueue({
      message: text,
      ...(activeTags.length > 0 ? { taggedFriends: activeTags } : {}),
    });
    if (!result.ok) {
      setQueueNotice(
        result.reason === "full"
          ? "Queue is full — wait for one to finish."
          : "Sign in to ask the agent.",
      );
      return;
    }
    setValue("");
    setTags([]);
    setQueueNotice(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && completion) {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const syncCaret = () => {
    const el = inputRef.current;
    if (!el) return;
    const atEnd =
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length;
    setCaretAtEnd(atEnd);
  };

  const canSubmit = value.trim().length > 0 && !!userId;

  return (
    <div className="flex flex-col gap-2">
      {queueNotice !== null && (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/8 px-4 py-2 text-xs text-amber-900 dark:text-amber-100"
        >
          {queueNotice}
        </div>
      )}
      {/* Floating black pill, reference-style. Slash chips sit inside on the
          left as a divider-separated cluster, the free-text input takes the
          middle, and the submit button is a circular icon on the right.
          Single visual unit instead of stacked chips + input. */}
      <div className="flex h-12 items-center gap-1 rounded-full bg-neutral-900 pl-1.5 pr-1.5 text-sm text-neutral-100 shadow-[0_10px_30px_rgba(16,24,40,0.18)] focus-within:ring-2 focus-within:ring-white/20">
        <div className="flex items-center gap-0.5 border-r border-white/10 pr-1.5">
          {SLASH_CHIPS.map((c) => (
            <button
              key={c.slug}
              type="button"
              title={c.hint}
              onClick={() => {
                setValue(`${c.slug} `);
                inputRef.current?.focus();
              }}
              className="rounded-full px-2.5 py-1 text-xs text-neutral-300 transition-transform duration-150 ease-out hover:scale-[1.05] hover:bg-white/10 hover:text-white active:scale-[0.96]"
            >
              {c.slug}
            </button>
          ))}
        </div>
        {/* Ghost-text mirror: an invisible span the same width as the typed
            value pushes the gray ghost suffix to exactly where the caret
            sits, so autocomplete reads inline rather than in a popover. */}
        <div className="relative flex min-w-0 flex-1 items-center">
          {completion !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-2 text-sm"
            >
              <span className="invisible">{value}</span>
              <span className="text-neutral-500">{completion.ghost}</span>
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              syncCaret();
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            placeholder="what do you want to do?"
            className="relative w-full min-w-0 bg-transparent px-2 text-sm text-neutral-50 placeholder:text-neutral-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={!canSubmit}
          aria-label="Ask calendar agent"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-neutral-900 transition-transform duration-150 ease-out hover:scale-[1.05] active:scale-[0.95] disabled:opacity-40"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 13V3" />
            <path d="M4 7l4-4 4 4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
