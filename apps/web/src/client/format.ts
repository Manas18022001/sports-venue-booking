export function money(minor: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);
}
export function priceMinor(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a non-negative price with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647)
    throw new Error("Enter a price below ₹21,474,836.48.");
  return result;
}
export function localDate(date = new Date(), timezone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + amount))
    .toISOString()
    .slice(0, 10);
}
export function dayLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}
export function timeLabel(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(instant));
}
export function instantDate(instant: string, timezone: string) {
  return dayLabel(localDate(new Date(instant), timezone));
}
export function localInput(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export async function toInstant(value: string, timezone: string) {
  const { Temporal } = await import("@js-temporal/polyfill");
  try {
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(timezone, { disambiguation: "reject" })
      .toInstant()
      .toString({ smallestUnit: "second" });
  } catch {
    throw new Error(
      "This local time is invalid or occurs twice in the venue timezone. Choose a different time.",
    );
  }
}
export function safeReturnPath(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  try {
    const url = new URL(value, "https://turfit.invalid");
    return url.origin === "https://turfit.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}
export const sports = [
  "All sports",
  "Badminton",
  "Football",
  "Tennis",
  "Pickleball",
  "Cricket",
  "Basketball",
];
