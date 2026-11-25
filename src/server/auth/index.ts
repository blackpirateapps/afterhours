import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/auth-schema";
import { allowedIds } from "../env";
import { AppError } from "../errors";
import { authOptions, githubIdentityAllowed } from "./options";

function createAuth() {
  return betterAuth({
    ...authOptions(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      transaction: true,
    }),
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  return (auth ??= createAuth());
}

export async function requireOwner(headers: Headers) {
  const ids = allowedIds();
  const session = await getAuth().api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session)
    throw new AppError(401, "sign_in_required", "Sign in to continue.");
  const identities = await getDb()
    .select({ id: schema.account.accountId })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, session.user.id),
        eq(schema.account.providerId, "github"),
      ),
    );
  if (
    identities.length !== 1 ||
    !githubIdentityAllowed(identities[0].id, ids)
  ) {
    throw new AppError(
      403,
      "invite_required",
      "This GitHub account needs an invite.",
    );
  }
  return {
    id: session.user.id,
    name: session.user.name,
    image: session.user.image,
  };
}
