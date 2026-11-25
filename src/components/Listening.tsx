import Link from "next/link";
import type { RankItem } from "@/server/queries/stats";
import type { HistoryItem } from "@/server/queries/history";
import { dateLabel } from "@/shared/display";
import { Cover } from "./Cover";
import styles from "./ui.module.css";

const number = new Intl.NumberFormat("en");

export function SourceCredit() {
  return (
    <footer className={styles.credit}>
      Listening data and artwork from <a href="https://www.last.fm/">Last.fm</a>
      . Licensed under the{" "}
      <a href="https://www.last.fm/api/tos">Last.fm API Terms</a>.
    </footer>
  );
}

export function Heading({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={styles.heading}>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Metrics({
  items,
}: {
  items: { count: number; label: string }[];
}) {
  return (
    <dl className={styles.metrics}>
      {items.map(({ count, label }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{number.format(count)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RankList({
  title,
  items,
  artistRank = false,
}: {
  title: string;
  items: RankItem[];
  artistRank?: boolean;
}) {
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      {items.length ? (
        <ol className={styles.rank}>
          {items.map((item, index) => (
            <li key={JSON.stringify([item.name, item.artist])}>
              <span className={styles.rankIndex} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.rankCover}>
                <Cover url={item.cover} eager={artistRank && index < 4} />
              </span>
              <div className={styles.rankInfo}>
                <strong>{item.name}</strong>
                {!artistRank && (
                  <span className={styles.muted}>{item.artist}</span>
                )}
                <progress
                  value={item.count}
                  max={items[0].count}
                  aria-hidden="true"
                />
              </div>
              <span className={styles.rankCount}>
                {number.format(item.count)}
                <span className={styles.srOnly}> plays</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No plays to rank.</p>
      )}
    </section>
  );
}

export function PlayRows({
  items,
  timeZone,
}: {
  items: HistoryItem[];
  timeZone: string;
}) {
  return (
    <ol className={styles.plays}>
      {items.map((item, index) => (
        <li key={item.id}>
          <span className={styles.playCover}>
            <Cover url={item.cover} eager={index < 5} />
          </span>
          <div className={styles.playName}>
            <strong>{item.track}</strong>
            <span>{item.artist}</span>
          </div>
          {item.album && <span className={styles.playAlbum}>{item.album}</span>}
          <time dateTime={item.playedAt}>
            {dateLabel(item.playedAt, timeZone)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function EmptyConnection() {
  return (
    <section className={styles.card}>
      <h2>Connect Last.fm</h2>
      <p>
        Import your completed listens to start seeing your listening history.
      </p>
      <Link className={styles.primary} href="/profile#connection">
        Go to Profile
      </Link>
    </section>
  );
}
