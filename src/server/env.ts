import "server-only";
import { configurationError } from "./errors";

export function allowedIds(raw = process.env.APP_ALLOWED_GITHUB_IDS): string[] {
  const ids = raw?.split(",").map((item) => item.trim()) ?? [];
  if (
    ids.length < 1 ||
    ids.length > 10 ||
    ids.some((id) => !/^[1-9]\d*$/.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw configurationError();
  }
  return ids;
}

export function appOrigin(): string {
  try {
    const raw = required("BETTER_AUTH_URL");
    const origin = new URL(raw);
    if (
      raw !== origin.origin ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          !process.env.VERCEL_ENV &&
          isLoopback(origin.hostname)
        ))
    ) {
      throw configurationError();
    }
    return origin.origin;
  } catch {
    throw configurationError();
  }
}

export function isLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

export function required(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) throw configurationError();
  return value;
}

export function secret(key: "BETTER_AUTH_SECRET" | "CRON_SECRET"): string {
  const value = required(key);
  if (Buffer.byteLength(value) < 32) throw configurationError();
  return value;
}

export function databaseConfig(key: "DATABASE_URL" | "DATABASE_URL_UNPOOLED") {
  try {
    const url = new URL(required(key));
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length < 2
    ) {
      throw configurationError();
    }
    const local = isLoopback(url.hostname);
    if (local && process.env.VERCEL_ENV) throw configurationError();
    if (!local) {
      if (
        !url.hostname.endsWith(".neon.tech") ||
        url.hostname.includes("-pooler.") !== (key === "DATABASE_URL") ||
        !["require", "verify-full"].includes(
          url.searchParams.get("sslmode") ?? "",
        )
      )
        throw configurationError();
    }
    // Read the endpoint directly so DSN options cannot override the host, database, or TLS verification.
    return {
      host: url.hostname === "[::1]" ? "::1" : url.hostname,
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      ssl: local ? (false as const) : { rejectUnauthorized: true },
      enableChannelBinding:
        !local && url.searchParams.get("channel_binding") === "require",
    };
  } catch {
    throw configurationError();
  }
}
