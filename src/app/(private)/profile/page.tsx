import type { Metadata } from "next";
import { ArrowRight, Play, UsersRound } from "lucide-react";
import Link from "next/link";
import { Cover } from "@/components/Cover";
import { SourceCredit } from "@/components/Listening";
import {
  ConnectionForm,
  PreferenceForm,
  SignOut,
} from "@/components/ProfileActions";
import { SyncControl } from "@/components/SyncControl";
import styles from "@/components/ui.module.css";
import { pageOwner } from "@/server/auth/page";
import { getRecap } from "@/server/queries/stats";
import {
  getConnection,
  getPreferences,
  progress,
} from "@/server/sync/connections";
import { lastFmProfile } from "@/shared/media";

export const metadata: Metadata = { title: "Profile" };

function approvedAvatar(image?: string | null) {
  if (!image) return null;
  try {
    const url = new URL(image);
    return url.origin === "https://avatars.githubusercontent.com" &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default async function Profile() {
  const owner = await pageOwner();
  const [connection, preferences] = await Promise.all([
    getConnection(owner.id),
    getPreferences(owner.id),
  ]);
  const recap = connection
    ? await getRecap(owner.id, preferences.timeZone)
    : null;
  const avatar = approvedAvatar(owner.image);
  const initials = owner.name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => [...part][0])
    .join("")
    .toUpperCase();
  return (
    <>
      <header className={styles.profileHeading}>
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={avatar}
                width={128}
                height={128}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span aria-hidden="true">{initials || "A"}</span>
            )}
          </span>
          <div>
            <h1>{owner.name || "Your profile"}</h1>
            {connection && (
              <a href={lastFmProfile(connection.username)}>
                @{connection.username}
              </a>
            )}
          </div>
        </div>
        <SignOut />
      </header>
      {recap && (
        <div className={styles.profileGrid}>
          <section className={styles.card}>
            <h2>Top albums</h2>
            {recap.rank.albums.length ? (
              <ul className={styles.albums}>
                {recap.rank.albums
                  .slice(0, 4)
                  .map(({ name, artist, cover }) => (
                    <li key={JSON.stringify([name, artist])}>
                      <Cover url={cover} eager />
                      <strong>{name}</strong>
                      <span>{artist}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={styles.muted}>No albums played this month.</p>
            )}
          </section>
          <section className={styles.card}>
            <h2>{recap.month} recap</h2>
            <dl className={styles.recap}>
              <div>
                <Play aria-hidden="true" />
                <dt>plays</dt>
                <dd>{recap.totals.plays.toLocaleString("en")}</dd>
              </div>
              <div>
                <UsersRound aria-hidden="true" />
                <dt>artists</dt>
                <dd>{recap.totals.artists.toLocaleString("en")}</dd>
              </div>
            </dl>
            <Link className={styles.recapLink} href="/stats">
              View listening stats <ArrowRight aria-hidden="true" size={21} />
            </Link>
          </section>
        </div>
      )}
      <div className={styles.profileGrid}>
        <div className={styles.stack}>
          <ConnectionForm username={connection?.username} />
          {connection && (
            <SyncControl
              progress={progress(connection)}
              timeZone={preferences.timeZone}
            />
          )}
        </div>
        <PreferenceForm preferences={preferences} suggestZone={!connection} />
      </div>
      {connection && <SourceCredit />}
    </>
  );
}
