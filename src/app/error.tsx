"use client";

import styles from "@/components/ui.module.css";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className={`${styles.card} ${styles.pageError}`} role="alert">
      <h1>Afterhours is temporarily unavailable</h1>
      <p>Try loading this page again.</p>
      <button className={styles.secondary} type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
