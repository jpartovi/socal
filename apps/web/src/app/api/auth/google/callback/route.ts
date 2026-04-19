import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse, type NextRequest } from "next/server";

const STATE_COOKIE = "google_oauth_state";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

type UserInfo = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

function errorRedirect(req: NextRequest, message: string) {
  const url = new URL("/calendar-accounts", req.nextUrl.origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const googleError = req.nextUrl.searchParams.get("error");
  if (googleError) {
    return errorRedirect(req, googleError);
  }
  if (!code || !stateParam) {
    return errorRedirect(req, "missing_code_or_state");
  }

  let parsedState: { nonce: string; userId: string };
  try {
    parsedState = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf8"),
    );
  } catch {
    return errorRedirect(req, "bad_state");
  }

  const cookieNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== parsedState.nonce) {
    return errorRedirect(req, "state_mismatch");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!clientId || !clientSecret || !redirectUri || !convexUrl) {
    return errorRedirect(req, "server_misconfigured");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return errorRedirect(req, "token_exchange_failed");
  }
  const tokens = (await tokenRes.json()) as TokenResponse;

  const userinfoRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!userinfoRes.ok) {
    return errorRedirect(req, "userinfo_failed");
  }
  const info = (await userinfoRes.json()) as UserInfo;

  const convex = new ConvexHttpClient(convexUrl);
  let accountId;
  try {
    accountId = await convex.mutation(api.googleAccounts.upsertFromOAuth, {
      userId: parsedState.userId as Id<"users">,
      googleSub: info.sub,
      email: info.email,
      name: info.name,
      pictureUrl: info.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upsert_failed";
    return errorRedirect(req, encodeURIComponent(msg));
  }

  // Populate the calendar list so the user sees their calendars immediately
  // on redirect. Failures here shouldn't abort the flow — the account is
  // connected regardless; the page can surface a Retry.
  try {
    await convex.action(api.calendars.discoverForAccount, {
      googleAccountId: accountId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "calendar_discovery_failed";
    const url = new URL("/calendar-accounts", req.nextUrl.origin);
    url.searchParams.set("warning", encodeURIComponent(msg));
    const res = NextResponse.redirect(url);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  const success = NextResponse.redirect(
    new URL("/calendar-accounts", req.nextUrl.origin),
  );
  success.cookies.delete(STATE_COOKIE);
  return success;
}
