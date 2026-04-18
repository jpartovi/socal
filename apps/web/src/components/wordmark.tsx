import type { HTMLAttributes } from "react";

type WordmarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASSES: Record<NonNullable<WordmarkProps["size"]>, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-6xl",
};

export function Wordmark({
  size = "md",
  className = "",
  ...rest
}: WordmarkProps) {
  return (
    <span
      {...rest}
      aria-label="SoCal"
      className={`font-display italic leading-none tracking-tight ${SIZE_CLASSES[size]} ${className}`}
    >
      SoCal
    </span>
  );
}
