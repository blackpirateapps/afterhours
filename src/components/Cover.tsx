"use client";

import { useState } from "react";
import { approvedCover } from "@/shared/media";
import styles from "./ui.module.css";

export function Cover({
  url,
  eager = false,
}: {
  url?: string | null;
  eager?: boolean;
}) {
  const allowed = approvedCover(url);
  const [failed, setFailed] = useState<string | null>(null);
  const source =
    allowed && failed !== allowed ? allowed : "/record-fallback.svg";
  function fallback(image: HTMLImageElement | null) {
    if (
      image &&
      allowed === source &&
      image.complete &&
      image.naturalWidth === 0
    ) {
      setFailed(allowed);
    }
  }
  return (
    // Last.fm covers load directly with the browser and a restricted referrer policy.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.cover}
      src={source}
      alt=""
      width={120}
      height={120}
      loading={eager ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      ref={fallback}
      onError={(event) => fallback(event.currentTarget)}
    />
  );
}
