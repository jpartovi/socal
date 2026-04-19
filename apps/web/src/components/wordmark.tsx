import type { HTMLAttributes } from "react";

type WordmarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "sm" | "md" | "lg";
  showMark?: boolean;
};

const SIZE_CLASSES: Record<NonNullable<WordmarkProps["size"]>, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-6xl",
};

const MARK_CLASSES: Record<NonNullable<WordmarkProps["size"]>, string> = {
  sm: "h-5 w-5",
  md: "h-7 w-7",
  lg: "h-10 w-10",
};

export function Wordmark({
  size = "md",
  showMark = true,
  className = "",
  ...rest
}: WordmarkProps) {
  return (
    <span
      {...rest}
      aria-label="SoCal"
      className={`inline-flex items-center gap-2 font-display italic leading-none tracking-tight ${SIZE_CLASSES[size]} ${className}`}
    >
      {showMark && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand-mark.png"
          alt=""
          className={`${MARK_CLASSES[size]} object-contain`}
        />
      )}
      SoCal
    </span>
  );
}
