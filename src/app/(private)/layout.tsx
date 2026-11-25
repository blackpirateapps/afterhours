import { Navigation } from "@/components/Navigation";
import styles from "@/components/ui.module.css";
import { pageOwner } from "@/server/auth/page";
import { getPreferences } from "@/server/sync/connections";

export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = await pageOwner();
  const { reduceMotion } = await getPreferences(owner.id);
  return (
    <div
      className={styles.shell}
      data-reduced={reduceMotion ? "true" : undefined}
    >
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <Navigation />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}
