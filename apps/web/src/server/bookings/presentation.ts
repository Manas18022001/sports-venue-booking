import type { Prisma } from "../../generated/prisma/client";

export const bookingSelect = {
  id: true, reference: true, userId: true, customerName: true, customerEmail: true, currency: true, createdAt: true,
  venue: { select: { id: true, name: true, address: true, city: true, timezone: true, imageUrl: true } },
  items: { select: {
    id: true, slotId: true, courtName: true, sport: true, startsAt: true, endsAt: true, priceMinor: true,
    status: true, cancelledAt: true, cancellationSource: true, cancellationReason: true,
  }, orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.BookingSelect;
export type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
export const CUSTOMER_CANCELLATION_MS = 12 * 3_600_000;

export function canCancel(startsAt: Date, now: Date, admin: boolean) {
  return startsAt.getTime() - now.getTime() > (admin ? 0 : CUSTOMER_CANCELLATION_MS);
}

export function presentBooking(record: BookingRecord, now: Date, admin = false) {
  const items = record.items.map(item => ({
    id: item.id, slotId: item.slotId, courtName: item.courtName, sport: item.sport,
    startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), priceMinor: item.priceMinor,
    status: item.status,
    state: item.status === "CANCELLED" ? "CANCELLED" as const : item.endsAt <= now ? "COMPLETED" as const
      : item.startsAt <= now ? "IN_PROGRESS" as const : "UPCOMING" as const,
    canCancel: item.status === "RESERVED" && canCancel(item.startsAt, now, admin),
    cancellationDeadline: new Date(item.startsAt.getTime() - (admin ? 0 : CUSTOMER_CANCELLATION_MS)).toISOString(),
    cancellation: item.cancelledAt ? { cancelledAt: item.cancelledAt.toISOString(), source: item.cancellationSource, reason: item.cancellationReason } : null,
  }));
  const cancelled = items.filter(item => item.status === "CANCELLED");
  const reserved = items.filter(item => item.status === "RESERVED");
  const originalMinor = items.reduce((sum, item) => sum + item.priceMinor, 0);
  const cancelledMinor = cancelled.reduce((sum, item) => sum + item.priceMinor, 0);
  return {
    id: record.id, reference: record.reference, venue: record.venue, currency: record.currency,
    customer: { name: record.customerName, email: record.customerEmail }, createdAt: record.createdAt.toISOString(),
    status: reserved.length === 0 ? "CANCELLED" as const : cancelled.length ? "PARTIALLY_CANCELLED" as const : "CONFIRMED" as const,
    timeStatus: !reserved.length ? null : reserved.some(item => item.state === "IN_PROGRESS") ? "IN_PROGRESS" as const
      : reserved.some(item => item.state === "UPCOMING") ? "UPCOMING" as const : "COMPLETED" as const,
    counts: { total: items.length, reserved: reserved.length, cancelled: cancelled.length },
    totals: { originalMinor, cancelledMinor, remainingMinor: originalMinor - cancelledMinor }, items,
  };
}
export type BookingResponse = { booking: ReturnType<typeof presentBooking>; asOf: string };
