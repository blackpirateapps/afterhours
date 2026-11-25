import { requireOwner } from "@/server/auth";
import { assertOrigin, json, readJson, route } from "@/server/http";
import { connect, disconnect } from "@/server/sync/connections";
import { connectionInput } from "@/shared/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function POST(request: Request) {
  return route("connection.create", async () => {
    assertOrigin(request);
    const owner = await requireOwner(request.headers);
    const { username } = await readJson(request, connectionInput);
    const result = await connect(owner.id, username);
    return json(
      { username: result.username, progress: result.progress },
      result.status,
    );
  });
}

export function DELETE(request: Request) {
  return route("connection.delete", async () => {
    assertOrigin(request);
    const owner = await requireOwner(request.headers);
    await disconnect(owner.id);
    return new Response(null, { status: 204 });
  });
}
