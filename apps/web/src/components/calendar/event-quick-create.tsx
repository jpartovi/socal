"use client";

import { useState, type KeyboardEvent } from "react";

export function EventQuickCreate() {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const text = value.trim();
    if (!text) return;
    // TODO: wire up to natural-language event creation.
    console.log("create event:", text);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = value.trim().length > 0;

  return (
    <div className="flex h-10 items-center gap-2 rounded-full border bg-background px-4 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Make some plans"
        className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-label="Create event"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition disabled:opacity-40 hover:bg-primary/90"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
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
  );
}
