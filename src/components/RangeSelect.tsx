"use client";

import { ChevronDown } from "lucide-react";
import type { Range } from "@/shared/validation";
import styles from "./ui.module.css";

export function RangeSelect({
  range,
  id,
  autoSubmit = false,
}: {
  range: Range;
  id: string;
  autoSubmit?: boolean;
}) {
  return (
    <label className={styles.select} htmlFor={id}>
      <span className={styles.srOnly}>Date range</span>
      <select
        id={id}
        name="range"
        defaultValue={range}
        onChange={
          autoSubmit
            ? (event) => event.currentTarget.form?.requestSubmit()
            : undefined
        }
      >
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
      <ChevronDown aria-hidden="true" size={18} />
    </label>
  );
}
