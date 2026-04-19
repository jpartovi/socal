import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getValidAccessToken } from "./googleTokens";

const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

const contactItem = v.object({
  name: v.string(),
  phone: v.string(),
  photoUrl: v.union(v.string(), v.null()),
});

type GoogleConnection = {
  names?: Array<{ displayName?: string }>;
  phoneNumbers?: Array<{ value?: string; canonicalForm?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
};

type ConnectionsResponse = {
  connections?: GoogleConnection[];
  nextPageToken?: string;
};

// Lists People-API contacts across every Google account the user has
// connected, de-duped by phone number. Returns only contacts with both a name
// and a phone number. Silently skips accounts that haven't granted the
// contacts scope (the caller handles the "needs reconnect" UX).
export const listContacts = action({
  args: { userId: v.id("users") },
  returns: v.object({
    contacts: v.array(contactItem),
    needsReconnect: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const accounts = await ctx.runQuery(api.googleAccounts.listByUser, {
      userId: args.userId,
    });

    const byPhone = new Map<
      string,
      { name: string; phone: string; photoUrl: string | null }
    >();
    let anyGranted = false;

    for (const account of accounts) {
      const full = await ctx.runQuery(internal.googleAccounts._getById, {
        accountId: account._id,
      });
      console.log(
        `listContacts: account ${account._id} (${account.email}) scope="${full?.scope ?? ""}"`,
      );
      try {
        const token = await getValidAccessToken(ctx, account._id);
        let totalReturned = 0;
        let hadName = 0;
        let hadPhone = 0;
        let hadBoth = 0;
        let pageToken: string | undefined;
        let firstPage = true;
        do {
          const url = new URL(
            "https://people.googleapis.com/v1/people/me/connections",
          );
          url.searchParams.set("personFields", "names,phoneNumbers,photos");
          url.searchParams.set("pageSize", "500");
          if (pageToken) url.searchParams.set("pageToken", pageToken);

          const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!res.ok) {
            console.error(
              `People API ${res.status} for account ${account._id} (${account.email}): ${await res.text()}`,
            );
            break;
          }

          if (firstPage) anyGranted = true;
          firstPage = false;

          const body = (await res.json()) as ConnectionsResponse;
          const conns = body.connections ?? [];
          totalReturned += conns.length;
          for (const c of conns) {
            const name = c.names?.[0]?.displayName?.trim();
            const phone =
              c.phoneNumbers?.[0]?.canonicalForm?.trim() ??
              c.phoneNumbers?.[0]?.value?.trim();
            if (name) hadName++;
            if (phone) hadPhone++;
            if (!name || !phone) continue;
            hadBoth++;
            if (!byPhone.has(phone)) {
              const photo = c.photos?.find((p) => !p.default)?.url ?? null;
              byPhone.set(phone, { name, phone, photoUrl: photo });
            }
          }
          pageToken = body.nextPageToken;
        } while (pageToken);
        console.log(
          `listContacts: account ${account.email} returned=${totalReturned} withName=${hadName} withPhone=${hadPhone} both=${hadBoth}`,
        );
      } catch (err) {
        console.error("listContacts failed for account", account._id, err);
      }
    }

    return {
      contacts: Array.from(byPhone.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      needsReconnect: !anyGranted,
    };
  },
});

// Exposed so the client can check whether any connected account has the
// contacts scope (to hide the button entirely when nobody has granted it).
export const CONTACTS_READ_SCOPE = CONTACTS_SCOPE;
