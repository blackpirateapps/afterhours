import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";
import { HistoryList } from "@/components/HistoryList";
import { EmptyConnection, Heading, SourceCredit } from "@/components/Listening";
import { RangeSelect } from "@/components/RangeSelect";
import styles from "@/components/ui.module.css";
import { pageOwner } from "@/server/auth/page";
import { AppError } from "@/server/errors";
import { getHistory, historyFilters } from "@/server/queries/history";
import { getConnection, getPreferences } from "@/server/sync/connections";

export const metadata: Metadata = { title: "History" };

export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; q?: string | string[] }>;
}) {
  const { id } = await pageOwner();
  const [connection, { timeZone }, raw] = await Promise.all([
    getConnection(id),
    getPreferences(id),
    searchParams,
  ]);
  if (!connection)
    return (
      <>
        <Heading title="Listening history" />
        <EmptyConnection />
      </>
    );
  let filters;
  try {
    filters = historyFilters(raw.range, raw.q);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <>
        <Heading title="Listening history" />
        <section className={styles.card}>
          <h2>Check your filters</h2>
          <p role="alert" className={styles.error}>
            Choose a supported range and enter up to 100 characters.
          </p>
          <Link className={styles.secondary} href="/history">
            Reset filters
          </Link>
        </section>
        <SourceCredit />
      </>
    );
  }
  const result = await getHistory(id, timeZone, filters);
  return (
    <>
      <Heading title="Listening history" />
      <form className={styles.filters} action="/history">
        <label className={styles.search}>
          <span className={styles.srOnly}>
            Search tracks, artists, or albums
          </span>
          <Search size={20} aria-hidden="true" />
          <input
            name="q"
            placeholder="Search tracks, artists, or albums"
            defaultValue={filters.q}
          />
        </label>
        <RangeSelect range={filters.range} id="history-range" />
        <button type="submit" className={styles.secondary}>
          Apply filters
        </button>
      </form>
      <section className={styles.card}>
        <h2>Completed plays</h2>
        <HistoryList
          key={JSON.stringify([filters, timeZone, result.items[0]?.id])}
          initial={result}
          filters={filters}
          timeZone={timeZone}
        />
      </section>
      <SourceCredit />
    </>
  );
}
