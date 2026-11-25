import styles from "@/components/ui.module.css";

export default function Loading() {
  return (
    <p className={styles.emptyNotice} role="status">
      Loading listening data…
    </p>
  );
}
