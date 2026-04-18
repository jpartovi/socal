"use client";

import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Wordmark } from "@/components/wordmark";

const PENDING_PHONE_KEY = "socal.pendingPhone";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const router = useRouter();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) return;
    window.localStorage.setItem(PENDING_PHONE_KEY, trimmed);
    router.push("/login/verify");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <Wordmark size="lg" className="mb-10" />
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
          className="h-12 rounded-2xl px-5 text-base md:text-base"
        />
        <Button
          type="submit"
          disabled={!phone.trim()}
          className="h-12 rounded-2xl text-base"
        >
          Continue
        </Button>
      </form>
    </main>
  );
}
