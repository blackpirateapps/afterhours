import { requireOwner } from "@/server/auth";
import { AppError } from "@/server/errors";
import { json, route } from "@/server/http";
import { getHistory, historyFilters } from "@/server/queries/history";
import { getPreferences } from "@/server/sync/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return route("history", async () => {
    const owner = await requireOwner(request.headers);
    const params = new URL(request.url).searchParams;
    for (const key of ["range", "q", "cursor"]) {
      if (params.getAll(key).length > 1)
        throw new AppError(
          400,
          "invalid_filters",
          "Check the range, search, or page link.",
        );
    }
    const filters = historyFilters(params.get("range"), params.get("q"));
    const { timeZone } = await getPreferences(owner.id);
    return json(
      await getHistory(owner.id, timeZone, filters, params.get("cursor")),
    );
  });
}
