import { DateTime } from "luxon";

export function dateLabel(value: string, zone: string): string {
  return DateTime.fromISO(value, { zone, locale: "en" }).toFormat(
    "MMM d, yyyy '·' h:mm a ZZZZ",
  );
}
