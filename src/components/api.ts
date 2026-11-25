"use client";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly waitSeconds: number,
  ) {
    super(message);
  }
}

export async function api<T = undefined>(
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new RequestError(
      payload?.error?.message ??
        "Afterhours could not complete the request. Try again.",
      Number(response.headers.get("retry-after")) || 0,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
