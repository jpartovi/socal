import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

// Convex's runtime exposes env vars on process.env. The backend tsconfig
// doesn't include @types/node, so declare the shape we touch.
declare const process: { env: Record<string, string | undefined> };

const REFRESH_BUFFER_MS = 60_000;

type RefreshResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

// Returns a non-expired access token for the given Google account. Refreshes
// via the stored refresh token if needed and writes the new values back.
export async function getValidAccessToken(
  ctx: ActionCtx,
  accountId: Id<"googleAccounts">,
): Promise<string> {
  const account = await ctx.runQuery(internal.googleAccounts._getById, {
    accountId,
  });
  if (account === null) {
    throw new Error("Google account not found");
  }

  if (account.accessTokenExpiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    throw new Error(
      "Access token expired and no refresh token is stored. Reconnect this Google account.",
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET not configured in Convex env");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as RefreshResponse;

  await ctx.runMutation(internal.googleAccounts._updateTokens, {
    accountId,
    accessToken: body.access_token,
    accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
    refreshToken: body.refresh_token,
    scope: body.scope,
  });

  return body.access_token;
}
