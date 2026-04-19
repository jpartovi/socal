import { ConvexError } from "convex/values";

// Normalize a user-entered phone number to E.164-ish format so that equality
// lookups in `users.by_phone_number` and `phoneInvites.by_phone_number` match
// regardless of how the number was typed (spaces, dashes, parens, leading +).
//
// Rules:
//   - Strip everything that isn't a digit (remember whether the input had a +).
//   - If original started with "+": `+${digits}` (preserve country code).
//   - Else if 10 digits: assume US/Canada, prepend "+1".
//   - Else if 11 digits starting with "1": treat as US/Canada, prepend "+".
//   - Otherwise: reject with a clear error.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ConvexError("Phone number is required");
  }
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length === 0) {
    throw new ConvexError("Phone number must contain digits");
  }
  if (hadPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  throw new ConvexError(
    "Phone number must include a country code (e.g. +44…) or be a 10-digit US/Canada number",
  );
}
