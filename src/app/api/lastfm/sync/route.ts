import { requireOwner } from "@/server/auth";
import { assertOrigin, json, route } from "@/server/http";
import { runSync } from "@/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function POST(request: Request) {
  return route("sync.manual", async () => {
    assertOrigin(request);
    const owner = await requireOwner(request.headers);
    return json(await runSync(owner.id, { manual: true }));
  });
}
