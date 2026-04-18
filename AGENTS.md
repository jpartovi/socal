# socal — monorepo guide for agents

This file preserves the intent, architecture, and deferred decisions of the `socal` monorepo. Read it before making structural changes. Update it when you make decisions that future contributors (human or agent) will need to understand.

## Purpose

`socal` is a monorepo for three things that share as much as possible:

1. **A Next.js web app** (`apps/web`) — exists today.
2. **A native iOS Swift app** (`apps/ios`) — planned, not yet built.
3. **A shared Convex backend** (`packages/backend`) — TypeScript, consumed by both clients.

The goal is to maximize what's shared without overfitting. We deliberately scaffolded a lean starting point and documented the extension path rather than building everything up front.

## Current state vs. planned state

| Area | Current | Planned |
| --- | --- | --- |
| Web app | `apps/web` (Next.js 16, Tailwind, App Router, shadcn/ui) | — |
| Backend | `packages/backend` (Convex) | — |
| Shared UI | `packages/ui` (shadcn/ui) | — |
| iOS app | — | `apps/ios/Socal/` (native Xcode, Swift, `ConvexMobile` via SPM) |
| Auth | none; bare `<ConvexProvider>` | TBD provider (see "Adding auth") |
| Shared TS code | — | `packages/shared` (zod schemas, enums) when ≥ 2 workspaces need the same thing |
| Design tokens | — | `packages/design-tokens` + Style Dictionary → TS + `Tokens.swift` when real designs exist |
| CI | — | `.github/workflows/web.yml` (Linux) when repo has a remote; `ios.yml` (macOS-14) when iOS lands |

## Folder layout

### Today

```
socal/
├── apps/
│   └── web/                    # Next.js 16 + Tailwind + App Router
├── packages/
│   ├── backend/                # Convex: schema.ts, convex/
│   └── ui/                     # shadcn/ui components
├── AGENTS.md
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── .gitignore
```

### Long-term target

```
socal/
├── apps/
│   ├── web/
│   └── ios/
│       └── Socal/              # Xcode project, SwiftUI
├── packages/
│   ├── backend/
│   ├── ui/
│   ├── shared/                 # TS enums, zod schemas (add when needed)
│   └── design-tokens/          # JSON → TS + Tokens.swift (add when needed)
├── .github/workflows/
│   ├── web.yml
│   └── ios.yml
├── AGENTS.md
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── .gitignore
```

## Stack decisions and rationale

- **pnpm 10 + Turborepo 2** — 2026 consensus for small JS monorepos. pnpm gives strict isolation and `workspace:*`; Turborepo gives remote cache + affected-only builds. Nx would be overkill here.
- **Convex in `packages/backend`** — matches the shape of the closest official Convex monorepo template (Expo + Next.js variant). Web imports `@socal/backend/convex/_generated/api` for end-to-end types.
- **shadcn/ui in `packages/ui`** — installed via `npx shadcn@latest init` in monorepo mode. Web-only; iOS can't share React components.
- **Next.js App Router** — default for new projects in 2026.
- **iOS at `apps/ios/`, not top-level `ios/`** — mirrors the Convex template. Xcode/SPM/fastlane/Xcode Cloud don't care where the `.xcodeproj` lives. Keeps turbo filters and CI paths uniform.
- **iOS is NOT a pnpm workspace** — when `apps/ios/` lands, do not add it to `pnpm-workspace.yaml`. It has no `package.json` and the pnpm-workspace globs (`apps/*`, `packages/*`) would otherwise pick it up. Options when that happens: (a) change glob to `apps/web` + keep `packages/*`, or (b) put a stub `package.json` with `"private": true` in `apps/ios/` — (a) is cleaner.

## The "defer until needed" principle

We deliberately did not build these things up front. Add each one only when you have a concrete reason to.

### Auth

**When to add:** the first feature that genuinely requires "who is the current user?" (not before).

**Provider:** deliberately undecided. Evaluate options at decision time (Convex Auth, Auth0, custom OIDC, etc.). Each has tradeoffs around iOS minimum version, hosted UI vs. native UI, pricing, and account-linking support — revisit when the choice actually matters.

**General shape of the change, regardless of provider:**
1. Add `packages/backend/convex/auth.config.ts` configured for the chosen provider.
2. Web: swap the bare `<ConvexProvider>` in `apps/web/src/app/providers.tsx` for the provider's Convex integration (e.g., `<ConvexProviderWithAuth>`). Install the provider's Next.js SDK.
3. iOS (when it exists): swap `ConvexClient` for `ConvexClientWithAuth` using the provider's `AuthProvider` implementation. Install the provider's Swift SDK via SPM.
4. Gate features that need a user with `ctx.auth.getUserIdentity()` on the server.

### iOS app (`apps/ios/`)

**When to add:** when you're ready to actually build iOS features.

**How to add:**
1. Create `apps/ios/Socal/` via Xcode → new iOS App project.
2. Add `ConvexMobile` via Swift Package Manager: `https://github.com/get-convex/convex-swift` (current: 0.8.x, Feb 2026).
3. Create an `Env.swift` (or use build config user-defined settings) that reads the Convex deployment URL. Point dev builds at your Convex dev deployment, prod at your prod deployment.
4. Start with bare `ConvexClient` (unauthenticated). Swap to `ConvexClientWithAuth` when auth lands.
5. **iOS ↔ Convex type sharing is manual.** There is no TS→Swift codegen for Convex as of 2026. You write `Decodable` Swift structs that mirror Convex function return shapes. Use `@ConvexInt` / `@ConvexFloat` property wrappers for BigInt/number fields. See [Convex Swift data types](https://docs.convex.dev/client/swift/data-types).
6. **Do not add `apps/ios` to `pnpm-workspace.yaml`.** See the note in "Stack decisions" above.
7. **Do not add iOS to the Turbo graph.** Build it with `xcodebuild` on a macOS runner. Add `.github/workflows/ios.yml`.
8. Commit `Package.resolved` (2026 Swift community consensus; required for Xcode Cloud).
9. The `.gitignore` already includes iOS patterns (`DerivedData/`, `xcuserdata/`, `.build/`) so nothing noisy leaks into git on day 1.

### `packages/shared`

**When to add:** when you have TS code used in ≥ 2 workspaces (e.g., a zod schema used in both `apps/web` and `packages/backend` validators, or an enum used by both).

**How to add:** `pnpm init` inside `packages/shared`, name it `@socal/shared`, point its `main`/`exports` at a built `dist/` or use `"source"` conditions for zero-build TS imports. Consume via `"@socal/shared": "workspace:*"`.

### `packages/design-tokens`

**When to add:** when real designs exist and you need one source of truth for colors/spacing/typography across web and iOS.

**How to add:** single JSON token source + [Style Dictionary](https://amzn.github.io/style-dictionary/) emitting TS (`apps/web`) and `Tokens.swift` (`apps/ios`). Add a `tools/swift-tokens/` script to the codegen pipeline.

### CI

**When to add:** when the repo has a remote (GitHub) and at least one other person is contributing, or when you want PR checks before merging.

**How to add:**
1. Create `.github/workflows/web.yml` on `ubuntu-latest`: checkout → `pnpm/action-setup@v4` → `actions/setup-node@v4` with `cache: pnpm` → `pnpm install --frozen-lockfile` → `pnpm turbo run lint typecheck build --filter=web...`. Pass a placeholder `NEXT_PUBLIC_CONVEX_URL` env to make build deterministic.
2. When `apps/ios/` lands, add `.github/workflows/ios.yml` on `macos-14`: checkout → `xcodebuild -project apps/ios/Socal/Socal.xcodeproj test`. Do not reuse the Linux job's cache keys.
3. Consider enabling Turborepo remote cache (Vercel) — works across OSes, but ensure iOS-only files aren't inputs to web tasks.

## Known constraints and gotchas (permanent record)

- **No official template for this exact stack.** No public GitHub monorepo combines Next.js + Convex + native-Swift iOS. The Convex Expo monorepo template is the closest model and we copy its `apps/*` + `packages/*` + `packages/backend` shape.
- **Convex Swift has no TS→Swift codegen.** Accept manually-written `Decodable` structs. Only invest in OpenAPI-based codegen if drift becomes painful.
- **Keep folder names lowercase.** Linux CI is case-sensitive; macOS is not. A capitalized folder that "works locally" can break CI.
- **Commit `pnpm-lock.yaml` and (when iOS lands) `Package.resolved`.**
- **iOS is not in the Turbo graph.** CI splits: Linux for JS tasks, macOS for `xcodebuild`. Turbo remote cache works across OSes, but iOS-only files must not be inputs to web tasks.
- **CocoaPods + pnpm** can clash via `use_frameworks!` symlinks ([pnpm/pnpm#5385](https://github.com/pnpm/pnpm/issues/5385)). Irrelevant for pure-native Swift (which is what we're doing). Only matters if the iOS app ever consumes `node_modules`.

## Common commands

```bash
pnpm install                                # install all workspaces
pnpm dev                                    # run web + backend in parallel
pnpm build                                  # build everything
pnpm lint                                   # lint everything
pnpm typecheck                              # typecheck everything

pnpm -F web dev                             # just the web app
pnpm -F web build
pnpm -F @socal/backend dev                  # start Convex dev deployment (first run: login + create deployment)
pnpm -F @socal/backend deploy               # deploy backend to prod
# `pnpm -F <pkg> <name>` runs the npm script `<name>`, not a binary. To invoke
# the convex CLI directly in the backend workspace, use `pnpm -F @socal/backend exec convex <args>`.
```

## First-time setup notes

On a fresh clone:

```bash
pnpm install
pnpm -F @socal/backend dev                  # first run: logs you in + creates a dev deployment; writes CONVEX_DEPLOYMENT/CONVEX_URL/CONVEX_SITE_URL into packages/backend/.env.local
# Then copy the URL into the web app's env so the client can find the deployment:
echo "NEXT_PUBLIC_CONVEX_URL=$(grep '^CONVEX_URL=' packages/backend/.env.local | cut -d= -f2)" > apps/web/.env.local
# in another terminal:
pnpm -F web dev
```

Or simply run `pnpm dev` once the backend deployment is set up.

## Useful links

- Convex docs: https://docs.convex.dev
- Convex Swift SDK: https://github.com/get-convex/convex-swift
- Convex Swift docs: https://docs.convex.dev/client/swift
- Convex Swift data types: https://docs.convex.dev/client/swift/data-types
- Convex auth overview: https://docs.convex.dev/auth
- shadcn/ui monorepo: https://ui.shadcn.com/docs/monorepo
- Turborepo docs: https://turbo.build/repo/docs
