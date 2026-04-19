"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/lib/auth";

const UNDO_MS = 5000;

type ShowUndoArgs = {
  message: string;
  onUndo: () => void;
  onExpire?: () => void;
};

type UndoContextValue = {
  pendingDeletes: ReadonlySet<Id<"events">>;
  requestDelete: (eventId: Id<"events">) => void;
  showUndoToast: (args: ShowUndoArgs) => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

type UiToast = { id: number; message: string };

type Entry = {
  onUndo: () => void;
  onExpire?: () => void;
  timer: ReturnType<typeof setTimeout>;
};

export function UndoProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const deleteEvent = useAction(api.events.deleteEvent);
  const [toasts, setToasts] = useState<UiToast[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<Id<"events">>>(
    () => new Set(),
  );
  const entries = useRef(new Map<number, Entry>());
  const nextId = useRef(1);
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const removeToastUi = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const showUndoToast = useCallback(
    (args: ShowUndoArgs) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, message: args.message }]);
      const timer = setTimeout(() => {
        entries.current.delete(id);
        removeToastUi(id);
        args.onExpire?.();
      }, UNDO_MS);
      entries.current.set(id, {
        onUndo: args.onUndo,
        onExpire: args.onExpire,
        timer,
      });
    },
    [removeToastUi],
  );

  // Undo: cancel timer, skip onExpire, run onUndo, hide toast.
  const handleUndo = useCallback(
    (id: number) => {
      const entry = entries.current.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      entries.current.delete(id);
      removeToastUi(id);
      entry.onUndo();
    },
    [removeToastUi],
  );

  // Dismiss: hide toast UI only. Timer keeps running so onExpire still fires.
  const handleDismiss = useCallback(
    (id: number) => {
      removeToastUi(id);
    },
    [removeToastUi],
  );

  const requestDelete = useCallback(
    (eventId: Id<"events">) => {
      setPendingDeletes((s) => {
        const next = new Set(s);
        next.add(eventId);
        return next;
      });
      showUndoToast({
        message: "Event deleted",
        onUndo: () => {
          setPendingDeletes((s) => {
            const next = new Set(s);
            next.delete(eventId);
            return next;
          });
        },
        onExpire: () => {
          const uid = userIdRef.current;
          const clearPending = () =>
            setPendingDeletes((s) => {
              const next = new Set(s);
              next.delete(eventId);
              return next;
            });
          if (!uid) {
            clearPending();
            return;
          }
          // Keep the event hidden until the server delete completes — otherwise
          // it briefly reappears between onExpire firing and the Convex query
          // removing the row. On failure we clear as well so the event comes
          // back rather than staying hidden forever.
          deleteEvent({ userId: uid, eventId })
            .catch((err) => {
              console.error("deleteEvent failed", err);
            })
            .finally(clearPending);
        },
      });
    },
    [deleteEvent, showUndoToast],
  );

  useEffect(() => {
    const map = entries.current;
    return () => {
      for (const e of map.values()) clearTimeout(e.timer);
      map.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ pendingDeletes, requestDelete, showUndoToast }),
    [pendingDeletes, requestDelete, showUndoToast],
  );

  return (
    <UndoContext.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onUndo={handleUndo} onDismiss={handleDismiss} />
    </UndoContext.Provider>
  );
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndo must be used inside <UndoProvider>");
  return ctx;
}

function Toasts({
  toasts,
  onUndo,
  onDismiss,
}: {
  toasts: UiToast[];
  onUndo: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          onUndo={() => onUndo(t.id)}
          onDismiss={() => onDismiss(t.id)}
        />
      ))}
    </div>
  );
}

function Toast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-1 rounded-md border bg-background py-2 pl-4 pr-2 text-sm text-foreground shadow-sm"
    >
      <span className="pr-3">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="h-4 w-4"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
