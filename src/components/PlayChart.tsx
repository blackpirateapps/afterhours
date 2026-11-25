"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayCount } from "@/server/queries/stats";
import styles from "./ui.module.css";

const formatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const full = new Intl.DateTimeFormat("en", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function shortDate(date: string) {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}

function countTicks(daily: DayCount[]) {
  const max = Math.max(4, ...daily.map(({ count }) => count));
  const target = Math.max(1, max / 8);
  const base = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10]
    .map((value) => Math.ceil(value * base))
    .find((value) => value >= target)!;
  return Array.from(
    { length: Math.ceil(max / step) + 1 },
    (_, index) => index * step,
  );
}

export function PlayChart({ daily }: { daily: DayCount[] }) {
  const ticks = countTicks(daily);
  return (
    <section className={`${styles.card} ${styles.chartCard}`}>
      <h2>Plays over time</h2>
      <div className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 536, height: 254 }}
        >
          <LineChart
            data={daily}
            margin={{ top: 8, bottom: 7, left: 0, right: 14 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="var(--chart-grid)" syncWithTicks />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={32}
              tick={{ fill: "var(--text)", fontSize: 14 }}
              stroke="var(--border)"
            />
            <YAxis
              allowDecimals={false}
              domain={[0, ticks.at(-1)!]}
              ticks={ticks}
              width={35}
              tick={{ fill: "var(--text)", fontSize: 14 }}
              stroke="var(--border)"
            />
            <Tooltip
              labelFormatter={(date) =>
                full.format(new Date(`${date}T00:00:00Z`))
              }
              formatter={(value) => [value, "Plays"]}
              isAnimationActive={false}
              contentStyle={{
                background: "var(--aside)",
                borderColor: "var(--border)",
                borderRadius: 8,
              }}
              labelStyle={{ color: "var(--text)" }}
              itemStyle={{ color: "var(--accent)" }}
            />
            <Line
              dataKey="count"
              type="linear"
              stroke="var(--accent)"
              strokeWidth={2.7}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className={styles.chartData}>
        <summary>View daily play counts</summary>
        <table>
          <caption className={styles.srOnly}>Daily play counts</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Plays</th>
            </tr>
          </thead>
          <tbody>
            {daily.map(({ date, count }) => (
              <tr key={date}>
                <th scope="row">
                  {full.format(new Date(`${date}T00:00:00Z`))}
                </th>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
