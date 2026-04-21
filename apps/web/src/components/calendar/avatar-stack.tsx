import { Avatar, type AvatarSize } from "@socal/ui/components/avatar";
import { cn } from "@socal/ui/lib/utils";

export type StackedPerson = {
  key: string;
  name: string;
  photoUrl?: string | null;
};

type AvatarStackProps = {
  people: StackedPerson[];
  max?: number;
  size?: AvatarSize;
  className?: string;
};

export function AvatarStack({
  people,
  max = 3,
  size = "sm",
  className,
}: AvatarStackProps) {
  if (people.length === 0) return null;
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  return (
    <div className={cn("flex items-center", className)}>
      {visible.map((p, i) => (
        <Avatar
          key={p.key}
          name={p.name}
          photoUrl={p.photoUrl ?? undefined}
          size={size}
          className={i === 0 ? "border-0" : "-ml-1.5 border-0"}
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            "-ml-1.5 inline-flex shrink-0 items-center justify-center rounded-full bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground",
            size === "xs" ? "h-5 min-w-5" : "h-6 min-w-6",
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
