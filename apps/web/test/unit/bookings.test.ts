import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { adminCancellationSchema, bookingQuerySchema, cancellationSchema, canonicalCheckout, checkoutSchema, idempotencyKeySchema } from "../../src/server/bookings/schemas.js";
import { canCancel, presentBooking } from "../../src/server/bookings/presentation.js";
import type { BookingRecord } from "../../src/server/bookings/presentation.js";
import { requestHash } from "../../src/server/bookings/idempotency.js";

test("checkout validates consent, normalizes UUIDs, and rejects identity injection and duplicate slots", () => {
  const id = randomUUID(); const data = { venueId: randomUUID(), currency: "INR", items: [{ slotId: id.toUpperCase(), version: 1, priceMinor: 50_000 }] };
  assert.equal(checkoutSchema.parse(data).items[0]!.slotId, id);
  for (const input of [
    { ...data, userId: randomUUID() }, { ...data, customer: { name: "Other" } },
    { ...data, items: [] }, { ...data, items: [...data.items, { ...data.items[0], slotId: id }] },
    { ...data, items: [{ slotId: id, priceMinor: 10 }] },
    { ...data, items: [{ slotId: id, version: 1, priceMinor: -1 }] },
    { ...data, items: [{ slotId: id, version: 0, priceMinor: 0 }] },
    { ...data, currency: "inr" },
  ]) assert.equal(checkoutSchema.safeParse(input).success, false);
  for (const key of [null, "", "not-a-uuid", `${id},${id}`]) assert.equal(idempotencyKeySchema.safeParse(key).success, false);
});

test("idempotency canonicalization ignores selection order but detects changed consent", () => {
  const data = checkoutSchema.parse({ venueId: randomUUID(), currency: "INR", items: [
    { slotId: randomUUID(), version: 1, priceMinor: 100 }, { slotId: randomUUID(), version: 2, priceMinor: 200 },
  ] });
  const first = requestHash(canonicalCheckout(data));
  assert.equal(first, requestHash(canonicalCheckout({ ...data, items: [...data.items].reverse() })));
  assert.notEqual(first, requestHash(canonicalCheckout({ ...data, items: data.items.map(item => ({ ...item, version: item.version + 1 })) })));
});

test("cancellation has a strict 12-hour customer boundary and upcoming-only admin override", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const boundary = now.getTime() + 12 * 3_600_000;
  assert.equal(canCancel(new Date(boundary + 1), now, false), true);
  assert.equal(canCancel(new Date(boundary), now, false), false);
  assert.equal(canCancel(new Date(boundary - 1), now, false), false);
  assert.equal(canCancel(new Date(now.getTime() + 1), now, true), true);
  assert.equal(canCancel(now, now, true), false);
  assert.equal(canCancel(new Date(now.getTime() - 1), now, true), false);
});

test("customer cancellation cannot inject an override and admin cancellation requires a reason", () => {
  const data = { itemIds: [randomUUID()] };
  assert.equal(cancellationSchema.safeParse({ ...data, reason: "Override", admin: true }).success, false);
  assert.equal(adminCancellationSchema.safeParse(data).success, false);
  assert.equal(adminCancellationSchema.safeParse({ ...data, reason: "   " }).success, false);
  assert.equal(adminCancellationSchema.parse({ ...data, reason: " Maintenance " }).reason, "Maintenance");
  assert.equal(cancellationSchema.safeParse({ itemIds: [data.itemIds[0], data.itemIds[0]!.toUpperCase()] }).success, false);
  assert.equal(bookingQuerySchema.safeParse({ userId: randomUUID() }).success, false);
});

test("booking presentation derives totals, partial cancellation, eligibility, and excludes internal actor IDs", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  const startsAt = new Date("2030-01-03T00:00:00Z"); const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const baseItem = { id: randomUUID(), slotId: randomUUID(), courtName: "Court A", sport: "Tennis", startsAt, endsAt, priceMinor: 200,
    status: "RESERVED" as const, cancelledAt: null, cancellationSource: null, cancellationReason: null };
  const record: BookingRecord = {
    id: randomUUID(), reference: "TF-Test", userId: randomUUID(), customerName: "Test", customerEmail: "test@example.test", currency: "INR", createdAt: now,
    venue: { id: randomUUID(), name: "Venue", address: "Street", city: "Pune", timezone: "Asia/Kolkata", imageUrl: null },
    items: [baseItem, { ...baseItem, id: randomUUID(), priceMinor: 100, status: "CANCELLED", cancelledAt: now, cancellationSource: "CUSTOMER" }],
  };
  const view = presentBooking(record, now);
  assert.equal(view.status, "PARTIALLY_CANCELLED"); assert.equal(view.timeStatus, "UPCOMING");
  assert.deepEqual(view.totals, { originalMinor: 300, cancelledMinor: 100, remainingMinor: 200 });
  assert.equal(view.items[0]!.canCancel, true); assert.equal(view.items[1]!.canCancel, false);
  assert.equal(JSON.stringify(view).includes(record.userId), false);
  const completed = presentBooking({ ...record, items: [baseItem] }, new Date("2030-01-04T00:00:00Z"));
  assert.equal(completed.timeStatus, "COMPLETED"); assert.equal(completed.items[0]!.canCancel, false);
});
