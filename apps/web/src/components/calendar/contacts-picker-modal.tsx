"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import { useAction, useMutation } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Contact = {
  name: string;
  phone: string;
  photoUrl: string | null;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; contacts: Contact[]; needsReconnect: boolean }
  | { kind: "error"; message: string };

export function ContactsPickerModal({
  userId,
  onClose,
  notify,
}: {
  userId: Id<"users">;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const listContacts = useAction(api.googleContacts.listContacts);
  const sendRequestByPhone = useMutation(api.friendships.sendRequestByPhone);

  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [smsStep, setSmsStep] = useState<Contact[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    listContacts({ userId })
      .then((result) => {
        if (cancelled) return;
        setState({
          kind: "loaded",
          contacts: result.contacts,
          needsReconnect: result.needsReconnect,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load contacts",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [listContacts, userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (state.kind !== "loaded") return [];
    const q = filter.trim().toLowerCase();
    if (!q) return state.contacts;
    return state.contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q),
    );
  }, [state, filter]);

  const toggle = (phone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  async function handleFileUpload(file: File) {
    try {
      const text = await file.text();
      const parsed = parseVCards(text);
      if (parsed.length === 0) {
        notify("No contacts with phone numbers found in that file.");
        return;
      }
      setState((prev) => {
        const existing =
          prev.kind === "loaded" ? prev.contacts : ([] as Contact[]);
        const byPhone = new Map<string, Contact>();
        for (const c of existing) byPhone.set(c.phone, c);
        for (const c of parsed) {
          if (!byPhone.has(c.phone)) byPhone.set(c.phone, c);
        }
        const contacts = Array.from(byPhone.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        return { kind: "loaded", contacts, needsReconnect: false };
      });
      notify(`Loaded ${parsed.length} contact${parsed.length > 1 ? "s" : ""}.`);
    } catch {
      notify("Couldn't read that file.");
    }
  }

  async function handleSend() {
    if (state.kind !== "loaded" || selected.size === 0 || isSending) return;
    setIsSending(true);
    let onPlatform = 0;
    let failed = 0;
    const needSms: Contact[] = [];
    for (const contact of state.contacts) {
      if (!selected.has(contact.phone)) continue;
      try {
        const result = await sendRequestByPhone({
          fromUserId: userId,
          phoneNumber: contact.phone,
        });
        if (result.status === "no_user") {
          needSms.push(contact);
        } else {
          onPlatform++;
        }
      } catch {
        failed++;
      }
    }
    setIsSending(false);
    if (onPlatform > 0) {
      notify(
        `${onPlatform} invite${onPlatform > 1 ? "s" : ""} sent on Socal.`,
      );
    } else if (failed > 0 && needSms.length === 0) {
      notify("Couldn't send invites.");
    }
    if (needSms.length > 0) {
      setSmsStep(needSms);
    } else {
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add from contacts"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-2xl border bg-popover p-5 text-popover-foreground shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            {smsStep === null
              ? "Add people from contacts"
              : "Invite them via text"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = "";
          }}
        />

        {smsStep !== null && (
          <>
            <p className="text-xs text-muted-foreground">
              These {smsStep.length} aren&apos;t on Socal yet. Tap to open
              Messages with an invite pre-filled.
            </p>
            <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {smsStep.map((contact) => (
                <li key={contact.phone}>
                  <a
                    href={smsInviteLink(contact.phone)}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-[10px] font-medium text-muted-foreground">
                      {initials(contact.name)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">{contact.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {contact.phone}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-md border px-2 py-1 text-xs">
                      Text
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t pt-3">
              <Button type="button" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}

        {smsStep === null && state.kind === "loading" && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Loading contacts…
          </p>
        )}

        {smsStep === null && state.kind === "error" && (
          <p className="py-4 text-xs text-destructive">{state.message}</p>
        )}

        {smsStep === null && state.kind === "loaded" && state.needsReconnect && (
          <div className="flex flex-col gap-3 py-4 text-xs text-muted-foreground">
            <p>
              Socal needs permission to read your Google contacts. Reconnect your
              Google account to grant access.
            </p>
            <Link
              href="/calendar-accounts"
              onClick={onClose}
              className="self-start rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Reconnect
            </Link>
          </div>
        )}

        {smsStep === null && state.kind === "loaded" && !state.needsReconnect && (
          <>
            {state.contacts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">
                  No contacts with phone numbers were found in your Google
                  account.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload a .vcf file
                </Button>
                <p className="max-w-xs text-[11px] leading-4 text-muted-foreground">
                  On a Mac: open Contacts, select all (⌘A), File → Export →
                  Export vCard.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="search"
                    placeholder="Search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-9 flex-1 rounded-md text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Upload .vcf
                  </button>
                </div>
                <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  {filtered.map((contact) => {
                    const checked = selected.has(contact.phone);
                    return (
                      <li key={contact.phone}>
                        <button
                          type="button"
                          onClick={() => toggle(contact.phone)}
                          aria-pressed={checked}
                          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                              checked
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {checked && (
                              <svg
                                viewBox="0 0 12 12"
                                className="h-2.5 w-2.5"
                                fill="none"
                                stroke="white"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                              </svg>
                            )}
                          </span>
                          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-[10px] font-medium text-muted-foreground">
                            {contact.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={contact.photoUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              initials(contact.name)
                            )}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">
                              {contact.name}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {contact.phone}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                  {filtered.length === 0 && (
                    <li className="py-4 text-center text-xs text-muted-foreground">
                      No matches.
                    </li>
                  )}
                </ul>
              </>
            )}
          </>
        )}

        {smsStep === null && state.kind === "loaded" && !state.needsReconnect && state.contacts.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isSending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSend}
                disabled={isSending || selected.size === 0}
              >
                {isSending ? "Sending…" : "Send invites"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function smsInviteLink(phone: string): string {
  const body =
    "make plans w me on socal!! https://socal.example.com (link coming soon)";
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "").toUpperCase() +
    (parts[parts.length - 1]?.[0] ?? "").toUpperCase()
  );
}

// Minimal vCard 3.0/4.0 parser. Handles line folding, FN/N for name, and
// TEL (preferring CELL/MOBILE/IPHONE types). One contact per vCard, first
// phone only. Photos are ignored.
function parseVCards(text: string): Contact[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VCARD/gi).slice(1);
  const out: Contact[] = [];
  for (const block of blocks) {
    const endIdx = block.search(/END:VCARD/i);
    if (endIdx === -1) continue;
    const lines = block.slice(0, endIdx).split(/\r?\n/);
    let fn = "";
    let nName = "";
    const tels: Array<{ value: string; isCell: boolean }> = [];
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const head = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      const prop = head.split(";")[0].toUpperCase();
      if (prop === "FN") {
        fn = value.trim();
      } else if (prop === "N" && !nName) {
        const [family, given] = value.split(";");
        nName = [given?.trim(), family?.trim()].filter(Boolean).join(" ");
      } else if (prop === "TEL") {
        const cleaned = value.replace(/[^\d+]/g, "");
        if (cleaned) {
          tels.push({
            value: cleaned,
            isCell: /CELL|MOBILE|IPHONE/i.test(head),
          });
        }
      }
    }
    const name = fn || nName;
    const tel = tels.find((t) => t.isCell) ?? tels[0];
    if (!name || !tel) continue;
    out.push({ name, phone: tel.value, photoUrl: null });
  }
  return out;
}
