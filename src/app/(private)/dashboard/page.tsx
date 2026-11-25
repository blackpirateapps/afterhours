import type { Metadata } from "next";
import { Cover } from "@/components/Cover";
import {
  EmptyConnection,
  Heading,
  Metrics,
  PlayRows,
  RankList,
  SourceCredit,
} from "@/components/Listening";
import { PlayChart } from "@/components/PlayChart";
import { SyncControl } from "@/components/SyncControl";
import styles from "@/components/ui.module.css";
import { pageOwner } from "@/server/auth/page";
import { getLatest } from "@/server/queries/history";
import { getStats, retainedCount } from "@/server/queries/stats";
import {
  getConnection,
  getPreferences,
  progress,
} from "@/server/sync/connections";

export const metadata: Metadata = { title: "Home" };

export default async function Dashboard() {
  const { id } = await pageOwner();
  const [connection, { timeZone }] = await Promise.all([
    getConnection(id),
    getPreferences(id),
  ]);
  if (!connection)
    return (
      <>
        <Heading title="Listening dashboard" />
        <EmptyConnection />
      </>
    );
  const now = new Date();
  const [week, count, latest] = await Promise.all([
    getStats(id, timeZone, "7d", now),
    retainedCount(id, now),
    getLatest(id, now),
  ]);
  const recent = latest[0];
  const showSyncFirst =
    connection.state === "error" || connection.initialStatus === "pending";
  const sync = (
    <SyncControl progress={progress(connection)} timeZone={timeZone} />
  );
  return (
    <>
      <Heading title="Listening dashboard" />
      <Metrics
        items={[
          { count, label: "retained plays" },
          { count: week.totals.artists, label: "artists this week" },
          { count: week.totals.tracks, label: "tracks this week" },
        ]}
      />
      {showSyncFirst && <div className={styles.prioritySync}>{sync}</div>}
      <div className={styles.statsGrid}>
        <PlayChart daily={week.daily} />
        <RankList
          title="Top artists · 7 days"
          items={week.rank.artists.slice(0, 5)}
          artistRank
        />
      </div>
      <div className={styles.statsGrid}>
        <section className={styles.card}>
          <h2>Latest plays</h2>
          {latest.length ? (
            <PlayRows items={latest} timeZone={timeZone} />
          ) : (
            <p className={styles.muted}>No completed plays imported yet.</p>
          )}
        </section>
        <div className={styles.stack}>
          <section className={styles.card}>
            <h2>Last played</h2>
            {recent ? (
              <div className={styles.lastPlayed}>
                <span>
                  <Cover url={recent.cover} eager />
                </span>
                <div>
                  <strong>{recent.track}</strong>
                  <p className={styles.muted}>{recent.artist}</p>
                </div>
              </div>
            ) : (
              <p className={styles.muted}>No completed plays saved.</p>
            )}
          </section>
          {!showSyncFirst && sync}
        </div>
      </div>
      <SourceCredit />
    </>
  );
}
