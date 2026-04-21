import * as React from "react";

import { cn } from "@socal/ui/lib/utils";

const SIZE_CLASSES = {
  xs: "size-5 text-[8px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export type AvatarSize = keyof typeof SIZE_CLASSES;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

type AvatarProps = {
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
  ringClassName?: string;
};

function Avatar({
  name,
  photoUrl,
  size = "sm",
  className,
  ringClassName,
}: AvatarProps) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted font-medium text-muted-foreground",
        SIZE_CLASSES[size],
        ringClassName,
        className,
      )}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  );
}

export { Avatar };
