import { requireOwner } from "@/server/auth";
import { assertOrigin, json, readJson, route } from "@/server/http";
import { setPreferences } from "@/server/sync/connections";
import { preferencesInput } from "@/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PATCH(request: Request) {
  return route("preferences", async () => {
    assertOrigin(request);
    const owner = await requireOwner(request.headers);
    const preferences = await readJson(request, preferencesInput);
    return json(await setPreferences(owner.id, preferences));
  });
}
