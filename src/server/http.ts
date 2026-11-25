import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { appOrigin } from "./env";
import { AppError } from "./errors";

export const privateHeaders = { "Cache-Control": "private, no-store" };
const inputError = () =>
  new AppError(
    400,
    "invalid_input",
    "Check the information submitted and try again.",
  );

export function assertOrigin(request: Request): void {
  if (request.headers.get("origin") !== appOrigin()) {
    throw new AppError(
      403,
      "invalid_origin",
      "This request must come from Afterhours.",
    );
  }
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" ||
    Number(request.headers.get("content-length")) > 4096 ||
    !request.body
  )
    throw inputError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        void reader.cancel().catch(() => undefined);
        throw inputError();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    const result = schema.safeParse(JSON.parse(body + decoder.decode()));
    if (result.success) return result.data;
  } catch {
    throw inputError();
  } finally {
    reader.releaseLock();
  }
  throw inputError();
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: privateHeaders });
}

export async function route(
  operation: string,
  work: () => Promise<Response>,
): Promise<Response> {
  const requestId = randomUUID();
  const started = performance.now();
  let result = "ok";
  try {
    const response = await work();
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    response.headers.set("X-Request-Id", requestId);
    result = String(response.status);
    return response;
  } catch (error) {
    const known =
      error instanceof AppError
        ? error
        : new AppError(
            500,
            "unavailable",
            "Afterhours could not complete the request.",
          );
    result = known.code;
    return Response.json(
      { error: { code: known.code, message: known.message }, requestId },
      {
        status: known.status,
        headers: {
          ...privateHeaders,
          "X-Request-Id": requestId,
          ...(known.retryAfter && { "Retry-After": String(known.retryAfter) }),
        },
      },
    );
  } finally {
    console.info(
      JSON.stringify({
        requestId,
        operation,
        result,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
}
