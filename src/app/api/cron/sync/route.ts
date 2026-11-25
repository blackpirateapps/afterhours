import { json, route } from "@/server/http";
import { authorizeCron, runCron } from "@/server/sync/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export function GET(request: Request) {
  return route("sync.cron", async () => {
    authorizeCron(request);
    return json(await runCron());
  });
}
