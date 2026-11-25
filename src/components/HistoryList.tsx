"use client";

import { useState } from "react";
import type { HistoryFilters, HistoryItem } from "@/server/queries/history";
import { api } from "./api";
import { PlayRows } from "./Listening";
import styles from "./ui.module.css";

type Results = { items: HistoryItem[]; nextCursor: string | null };

export function HistoryList({
  initial,
  filters,
  timeZone,
}: {
  initial: Results;
  filters: HistoryFilters;
  timeZone: string;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState(0);
  async function load() {
    if (!data.nextCursor) return;
    setBusy(true);
    setFailed(false);
    setAdded(0);
    try {
      const params = new URLSearchParams({
        ...filters,
        cursor: data.nextCursor,
      });
      const next = await api<Results>(`/api/history?${params}`);
      setData({
        items: [...data.items, ...next.items],
        nextCursor: next.nextCursor,
      });
      setAdded(next.items.length);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!data.items.length)
    return (
      <p className={styles.muted}>
        No completed plays match this search and range.
      </p>
    );
  return (
    <>
      <PlayRows items={data.items} timeZone={timeZone} />
      <p className={styles.srOnly} role="status">
        {busy
          ? "Loading more plays"
          : added
            ? `${added} more plays loaded`
            : ""}
      </p>
      {failed && (
        <p role="alert" className={styles.error}>
          More plays could not be loaded. Try again.
        </p>
      )}
      <div className={styles.loadMore}>
        {data.nextCursor ? (
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={load}
          >
            {busy ? "Loading…" : failed ? "Retry loading more" : "Load more"}
          </button>
        ) : (
          <p className={styles.muted}>End of history for this range.</p>
        )}
      </div>
    </>
  );
}
