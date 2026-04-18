"use client";

import { api } from "@socal/backend/convex/_generated/api";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@socal/ui/components/input-otp";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/lib/auth";

const PENDING_PHONE_KEY = "socal.pendingPhone";
const CODE_LENGTH = 6;

export default function VerifyPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const verifyCode = useMutation(api.users.verifyCode);

  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(PENDING_PHONE_KEY);
    if (!stored) {
      router.replace("/login");
      return;
    }
    setPhoneNumber(stored);
  }, [router]);

  async function submit(value: string) {
    if (!phoneNumber || submittedRef.current) return;
    submittedRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await verifyCode({ phoneNumber, code: value });
      if (result.user) {
        window.localStorage.removeItem(PENDING_PHONE_KEY);
        signIn(result.user._id);
        router.replace("/");
      } else {
        router.replace("/onboarding");
      }
    } catch (err) {
      const message =
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Invalid code";
      setError(message);
      setCode("");
      submittedRef.current = false;
      setIsSubmitting(false);
    }
  }

  function handleChange(value: string) {
    setCode(value);
    if (error) setError(null);
    if (value.length === CODE_LENGTH) {
      void submit(value);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <Wordmark size="lg" className="mb-10" />
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <InputOTP
          maxLength={CODE_LENGTH}
          value={code}
          onChange={handleChange}
          disabled={isSubmitting}
          autoFocus
          containerClassName="gap-3"
        >
          <InputOTPGroup className="gap-3">
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <InputOTPSlot
                key={i}
                index={i}
                aria-invalid={error ? true : undefined}
                className="size-12 rounded-2xl border text-xl shadow-none first:rounded-l-2xl last:rounded-r-2xl"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </div>
    </main>
  );
}
