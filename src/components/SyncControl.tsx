"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Progress } from "@/server/sync/connections";
import { dateLabel } from "@/shared/display";
import { api, RequestError } from "./api";
import styles from "./ui.module.css";

export async function syncNow() {
  return api<Progress>("/api/lastfm/sync", "POST");
}

const stateText = {
  idle: "Ready",
  pending: "Import pending",
  running: "Syncing",
  success: "Up to date",
  error: "Sync needs attention",
};

export function SyncControl({
  progress,
  timeZone,
  heading = "Last.fm sync",
}: {
  progress: Progress;
  timeZone: string;
  heading?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [responseWait, setResponseWait] = useState(0);
  const until = Math.max(
    progress.nextAllowedAt ? Date.parse(progress.nextAllowedAt) : 0,
    responseWait,
  );
  const [expiredUntil, setExpiredUntil] = useState(0);
  const coolingDown = until > expiredUntil;
  useEffect(() => {
    if (!until) return;
    const timer = window.setTimeout(
      () => setExpiredUntil(until),
      Math.max(0, until - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [until]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const status = await syncNow();
      if (status.nextAllowedAt)
        setResponseWait(Date.parse(status.nextAllowedAt));
    } catch (error) {
      if (error instanceof RequestError && error.waitSeconds)
        setResponseWait(Date.now() + error.waitSeconds * 1000);
      setMessage(
        error instanceof Error
          ? error.message
          : "Sync could not start. Try again.",
      );
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.syncHeading}>
        <div>
          <h2>{heading}</h2>
          <p className={styles.muted} aria-live="polite">
            {busy ? "Syncing…" : stateText[progress.state]}
          </p>
        </div>
        <button
          className={styles.secondary}
          type="button"
          disabled={busy || coolingDown}
          onClick={start}
        >
          <RefreshCw size={18} aria-hidden="true" /> Sync now
        </button>
      </div>
      <p className={styles.syncDetail}>
        {progress.lastSuccessfulSyncAt ? (
          <>
            Last successful sync{" "}
            <time dateTime={progress.lastSuccessfulSyncAt}>
              {dateLabel(progress.lastSuccessfulSyncAt, timeZone)}
            </time>
          </>
        ) : (
          "No successful sync yet."
        )}
      </p>
      {coolingDown && (
        <p className={styles.syncDetail}>
          Next manual sync {dateLabel(new Date(until).toISOString(), timeZone)}
        </p>
      )}
      <p className={styles.syncDetail}>
        First import covers up to 30 days or 2,000 plays. History keeps up to 90
        elapsed days and 10,000 plays.
      </p>
      <p className={styles.syncDetail}>
        {progress.initialStatus === "pending"
          ? `First import pending · ${progress.initialImported.toLocaleString("en")} plays imported`
          : progress.initialStatus === "capped"
            ? "First import reached the 2,000-play cap."
            : "First import finished."}
      </p>
      {progress.retentionGap && (
        <p className={styles.syncDetail}>
          Some earlier history was outside the retention window when syncing
          resumed.
        </p>
      )}
      {progress.errorCode === "profile_unavailable" && (
        <p className={styles.error}>
          Last.fm history is private or unavailable. Check the connection in{" "}
          <Link href="/profile#connection">Profile</Link>.
        </p>
      )}
      {progress.errorCode === "storage_limit" && (
        <p className={styles.error}>Import paused: storage limit reached.</p>
      )}
      {progress.errorCode &&
        !["profile_unavailable", "storage_limit"].includes(
          progress.errorCode,
        ) &&
        !message && (
          <p className={styles.error}>
            {progress.errorCode === "provider_configuration"
              ? "The Last.fm connection needs operator attention."
              : "The latest sync was interrupted. You can try again."}
          </p>
        )}
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
    </section>
  );
}
