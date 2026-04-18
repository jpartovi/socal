import { Button } from "@socal/ui/components/button";

export default function Home() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">socal</h1>
      <p className="text-lg text-muted-foreground">
        Next.js + Convex + shadcn/ui monorepo. iOS app coming later.
      </p>

      <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">
        {convexUrl ? (
          <>
            <span className="font-medium">Convex:</span> connected to{" "}
            <code className="rounded bg-muted px-1 py-0.5">{convexUrl}</code>
          </>
        ) : (
          <>
            <span className="font-medium">Convex:</span> not yet configured. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              pnpm -F @socal/backend convex dev
            </code>{" "}
            to create a deployment.
          </>
        )}
      </div>

      <div className="flex gap-3">
        <Button>Primary</Button>
        <Button variant="outline">Secondary</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Read <code className="font-mono">AGENTS.md</code> at the repo root for the full monorepo
        plan.
      </p>
    </main>
  );
}
