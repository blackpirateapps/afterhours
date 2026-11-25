import "server-only";
import { DateTime } from "luxon";
import type { Range } from "@/shared/validation";

export const DAY = 86_400;
export const RETENTION_SECONDS = 90 * DAY;

export function rangeWindow(range: Range, zone: string, now = new Date()) {
  const days = Number.parseInt(range, 10);
  const today = DateTime.fromJSDate(now, { zone })
    .setLocale("en")
    .startOf("day");
  const first = today.minus({ days: days - 1 });
  return {
    start: first.toJSDate(),
    end: today.plus({ days: 1 }).toJSDate(),
    dates: Array.from({ length: days }, (_, index) =>
      first.plus({ days: index }).toISODate()!,
    ),
  };
}
