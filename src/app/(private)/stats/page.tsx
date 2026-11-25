import type { Metadata } from "next";
import Link from "next/link";
import {
  EmptyConnection,
  Heading,
  Metrics,
  RankList,
  SourceCredit,
} from "@/components/Listening";
import { PlayChart } from "@/components/PlayChart";
import { RangeSelect } from "@/components/RangeSelect";
import styles from "@/components/ui.module.css";
import { pageOwner } from "@/server/auth/page";
import { getStats } from "@/server/queries/stats";
import { getConnection, getPreferences } from "@/server/sync/connections";
import { rangeInput } from "@/shared/validation";

export const metadata: Metadata = { title: "Stats" };

export default async function Stats({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { id } = await pageOwner();
  const [connection, { timeZone }, query] = await Promise.all([
    getConnection(id),
    getPreferences(id),
    searchParams,
  ]);
  if (!connection)
    return (
      <>
        <Heading title="Listening stats" />
        <EmptyConnection />
      </>
    );
  const range = rangeInput.safeParse(query.range ?? "30d");
  if (!range.success)
    return (
      <>
        <Heading title="Listening stats" />
        <section className={styles.card}>
          <h2>Choose a date range</h2>
          <p role="alert" className={styles.error}>
            This date range is unavailable.
          </p>
          <Link className={styles.secondary} href="/stats">
            Reset range
          </Link>
        </section>
        <SourceCredit />
      </>
    );
  const stats = await getStats(id, timeZone, range.data);
  return (
    <>
      <Heading title="Listening stats">
        <form action="/stats">
          <RangeSelect range={range.data} id="stats-range" autoSubmit />
          <noscript>
            <button type="submit" className={styles.secondary}>
              Apply range
            </button>
          </noscript>
        </form>
      </Heading>
      <Metrics
        items={[
          { count: stats.totals.plays, label: "plays" },
          { count: stats.totals.artists, label: "artists" },
          { count: stats.totals.albums, label: "albums" },
        ]}
      />
      {!stats.totals.plays && (
        <p className={styles.emptyNotice}>No listening history in this range</p>
      )}
      <div className={styles.statsGrid}>
        <PlayChart daily={stats.daily} />
        <RankList title="Top artists" items={stats.rank.artists} artistRank />
      </div>
      <div className={styles.equalGrid}>
        <RankList
          title={`Top tracks · ${stats.totals.tracks.toLocaleString("en")} unique`}
          items={stats.rank.tracks}
        />
        <RankList title="Top albums" items={stats.rank.albums} />
      </div>
      <SourceCredit />
    </>
  );
}
