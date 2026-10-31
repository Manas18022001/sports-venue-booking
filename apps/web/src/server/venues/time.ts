import { Temporal } from "@js-temporal/polyfill";

export function isLocalDate(value: string): boolean {
  try { Temporal.PlainDate.from(value, { overflow: "reject" }); return /^\d{4}-\d{2}-\d{2}$/.test(value); }
  catch { return false; }
}

export function isTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}

// Calendar arithmetic is essential: a venue-local day can last 23 or 25 hours.
export function localDayBounds(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date, { overflow: "reject" });
  const start = day.toZonedDateTime(timeZone);
  if (!start.toPlainDate().equals(day)) throw new RangeError("This local date does not exist.");
  const end = day.add({ days: 1 }).toZonedDateTime(timeZone);
  return { start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
}
