import "server-only";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { allowedIds, appOrigin, required, secret } from "../env";

export function githubIdentityAllowed(
  value: unknown,
  ids = allowedIds(),
): boolean {
  return (
    ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
      (typeof value === "string" && /^[1-9]\d*$/.test(value))) &&
    ids.includes(String(value))
  );
}

export function authOptions() {
  const baseURL = appOrigin();
  return {
    appName: "Afterhours",
    baseURL,
    secret: secret("BETTER_AUTH_SECRET"),
    trustedOrigins: [baseURL],
    socialProviders: {
      github: {
        clientId: required("GITHUB_CLIENT_ID"),
        clientSecret: required("GITHUB_CLIENT_SECRET"),
        overrideUserInfoOnSignIn: true,
        mapProfileToUser(profile) {
          if (!githubIdentityAllowed(profile.id)) {
            throw new APIError("FORBIDDEN", {
              code: "INVITE_REQUIRED",
              message: "This GitHub account needs an invite.",
            });
          }
          return {};
        },
      },
    },
    emailAndPassword: { enabled: false },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
      storeAccountCookie: false,
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https:"),
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    logger: { disabled: true },
    onAPIError: { errorURL: `${baseURL}/sign-in` },
  } satisfies BetterAuthOptions;
}
