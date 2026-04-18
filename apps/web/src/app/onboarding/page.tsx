"use client";

import { api } from "@socal/backend/convex/_generated/api";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/lib/auth";

const PENDING_PHONE_KEY = "socal.pendingPhone";

export default function OnboardingPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const createUser = useMutation(api.users.create);

  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(PENDING_PHONE_KEY);
    if (!stored) {
      router.replace("/login");
      return;
    }
    setPhoneNumber(stored);
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!phoneNumber || isSubmitting) return;
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) return;

    setIsSubmitting(true);
    try {
      const newId = await createUser({
        phoneNumber,
        firstName: first,
        lastName: last,
      });
      window.localStorage.removeItem(PENDING_PHONE_KEY);
      signIn(newId);
      router.replace("/");
    } catch {
      setIsSubmitting(false);
    }
  }

  const inputClass = "h-12 rounded-2xl px-5 text-base md:text-base";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <Wordmark size="lg" className="mb-10" />
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3"
      >
        <Input
          type="text"
          autoComplete="given-name"
          placeholder="first name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          disabled={isSubmitting}
          autoFocus
          className={inputClass}
        />
        <Input
          type="text"
          autoComplete="family-name"
          placeholder="last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          disabled={isSubmitting}
          className={inputClass}
        />
        <Button
          type="submit"
          disabled={
            isSubmitting || !firstName.trim() || !lastName.trim() || !phoneNumber
          }
          className="h-12 rounded-2xl text-base"
        >
          Continue
        </Button>
      </form>
    </main>
  );
}
