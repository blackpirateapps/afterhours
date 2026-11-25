import { z } from "zod";
import { getAuth, requireOwner } from "@/server/auth";
import { appOrigin } from "@/server/env";
import { AppError } from "@/server/errors";
import { assertOrigin, readJson, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const socialInput = z.strictObject({
  provider: z.literal("github"),
  callbackURL: z.string(),
  errorCallbackURL: z.string(),
});

async function handle(request: Request) {
  return route("auth", async () => {
    const path = new URL(request.url).pathname;
    const key = `${request.method} ${path}`;
    switch (key) {
      case "POST /api/auth/sign-in/social": {
        assertOrigin(request);
        const input = await readJson(request.clone(), socialInput);
        const origin = appOrigin();
        if (
          input.callbackURL !== `${origin}/dashboard` ||
          input.errorCallbackURL !== `${origin}/sign-in`
        ) {
          throw new AppError(
            400,
            "invalid_callback",
            "The sign-in destination is invalid.",
          );
        }
        break;
      }
      case "GET /api/auth/get-session":
        await requireOwner(request.headers);
        break;
      case "POST /api/auth/sign-out":
        assertOrigin(request);
        break;
      case "GET /api/auth/callback/github":
        break;
      default:
        throw new AppError(
          404,
          "auth_route",
          "This sign-in action is unavailable.",
        );
    }
    const response = await getAuth().handler(request);
    if (response.status >= 400) {
      const body = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      const invited = body?.code === "INVITE_REQUIRED";
      if (key === "GET /api/auth/callback/github") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${appOrigin()}/sign-in?error=${invited ? "invite_required" : "sign_in_failed"}`,
          },
        });
      }
      throw new AppError(
        invited ? 403 : response.status,
        invited ? "invite_required" : "auth_failed",
        invited
          ? "This GitHub account needs an invite."
          : "GitHub sign-in could not be completed.",
      );
    }
    return response;
  });
}

export { handle as GET, handle as POST };
