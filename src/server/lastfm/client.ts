import "server-only";
import { setTimeout as wait } from "node:timers/promises";
import { getPool } from "../db";
import { required } from "../env";
import {
  checkProviderError,
  LIMIT,
  malformed,
  parsePage,
  parseUser,
  ProviderError,
  providerBusy,
  unavailableProfile,
  type Window,
} from "./parse";

const API = "https://ws.audioscrobbler.com/2.0/";
export const REQUEST_MS = 5_000;
export const COMMIT_RESERVE_MS = 3_000;
const RESPONSE_LIMIT = 2 * 1024 * 1024;

export type ImportDeadline = number;
export class OutOfTime extends Error {}

export function hasRequestTime(deadline: ImportDeadline, delay = 0): boolean {
  return deadline - performance.now() >= REQUEST_MS + COMMIT_RESERVE_MS + delay;
}

async function takeStart(deadline: ImportDeadline): Promise<void> {
  const pool = getPool();
  while (hasRequestTime(deadline)) {
    const reserved = await pool.query(`
      UPDATE provider_gate SET next_start_at = clock_timestamp() + interval '1 second'
      WHERE id = 1 AND next_start_at <= clock_timestamp() AND backoff_until <= clock_timestamp()
      RETURNING id`);
    if (reserved.rowCount) {
      if (!hasRequestTime(deadline)) throw new OutOfTime();
      return;
    }
    const {
      rows: [gate],
    } = await pool.query<{ wait_ms: number; backoff_ms: number }>(`
      SELECT greatest(0, extract(epoch FROM (next_start_at - clock_timestamp())) * 1000)::float8 AS wait_ms,
             greatest(0, extract(epoch FROM (backoff_until - clock_timestamp())) * 1000)::float8 AS backoff_ms
      FROM provider_gate WHERE id = 1`);
    if (!gate) throw new Error("Provider gate not initialized");
    if (gate.backoff_ms > 0)
      throw providerBusy(Math.ceil(gate.backoff_ms / 1000));
    const delay = Math.max(15, Math.ceil(gate.wait_ms));
    if (!hasRequestTime(deadline, delay)) break;
    await wait(delay);
  }
  throw new OutOfTime();
}

async function setBackoff(seconds: number): Promise<void> {
  await getPool().query(
    `UPDATE provider_gate
    SET backoff_until = greatest(backoff_until, clock_timestamp() + $1 * interval '1 second') WHERE id = 1`,
    [seconds],
  );
}

export function retryDelay(value: string | null, now = Date.now()): number {
  if (value !== null && /^\d+$/.test(value)) {
    const seconds = Number(value);
    if (Number.isSafeInteger(seconds) && seconds <= 253_402_300_799)
      return Math.max(1, seconds);
  } else if (value) {
    const time = Date.parse(value);
    if (Number.isFinite(time))
      return Math.max(1, Math.ceil((time - now) / 1000));
  }
  return 60;
}

async function readBody(response: Response): Promise<unknown> {
  if (!response.body) throw malformed();
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT) {
    await response.body.cancel();
    throw malformed();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        await reader.cancel();
        throw malformed();
      }
      try {
        text += decoder.decode(part.value, { stream: true });
      } catch {
        await reader.cancel();
        throw malformed();
      }
    }
    try {
      return JSON.parse(text + decoder.decode()) as unknown;
    } catch {
      throw malformed();
    }
  } finally {
    reader.releaseLock();
  }
}

const temporary = () =>
  new ProviderError(
    "provider_temporary",
    "Last.fm is temporarily unavailable. Try again later.",
    "temporary",
  );

export function lastFm(transport: typeof fetch = fetch) {
  async function call(
    method: "user.getInfo" | "user.getRecentTracks",
    username: string,
    params: Record<string, string>,
    deadline: ImportDeadline,
  ) {
    const url = new URL(API);
    url.search = new URLSearchParams({
      method,
      user: username,
      api_key: required("LASTFM_API_KEY"),
      format: "json",
      ...params,
    }).toString();
    await takeStart(deadline);
    const signal = AbortSignal.timeout(REQUEST_MS);
    const recent = method === "user.getRecentTracks";
    try {
      const response = await transport(url, {
        headers: {
          "User-Agent": "Afterhours/1.0 (private listening dashboard)",
          Accept: "application/json",
        },
        redirect: "manual",
        cache: "no-store",
        signal,
      });
      const retryAfter = retryDelay(response.headers.get("retry-after"));
      if (response.status === 429) {
        await response.body?.cancel();
        throw providerBusy(retryAfter);
      }
      if (response.status >= 500) {
        await response.body?.cancel();
        throw temporary();
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw malformed();
      }
      const body = await readBody(response);
      checkProviderError(body, recent, retryAfter);
      if (!response.ok) {
        if (recent && [403, 404].includes(response.status))
          throw unavailableProfile();
        throw new ProviderError(
          "provider_failure",
          "Last.fm could not complete the request.",
          "permanent",
        );
      }
      return body;
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === "rate" && error.retryAfter)
          await setBackoff(error.retryAfter);
        throw error;
      }
      throw temporary();
    }
  }

  return {
    async user(username: string, deadline: ImportDeadline) {
      return parseUser(await call("user.getInfo", username, {}, deadline));
    },
    async page(username: string, window: Window, deadline: ImportDeadline) {
      const params = {
        extended: "0",
        limit: String(LIMIT),
        page: String(window.page),
        from: String(window.from - 1),
        to: String(window.to + 1),
      };
      try {
        return parsePage(
          await call("user.getRecentTracks", username, params, deadline),
          window,
        );
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          error.kind !== "temporary" ||
          !hasRequestTime(deadline, 1000)
        )
          throw error;
        await wait(1000);
        return parsePage(
          await call("user.getRecentTracks", username, params, deadline),
          window,
        );
      }
    },
  };
}

export type LastFm = ReturnType<typeof lastFm>;
