import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabaseClient } from "../../src/database/client.js";
import type { DatabaseClient } from "../../src/database/client.js";
import type { Principal } from "../../src/server/auth/service.js";
import { ApiError } from "../../src/server/api/errors.js";
import { createBookingService } from "../../src/server/bookings/service.js";
import { createCatalogService } from "../../src/server/venues/catalog.js";
import { setup, teardown, schema, testDatabaseUrl, db, fixture, slot, connect, outcome } from "./helpers.js";

const url = new URL(testDatabaseUrl); url.searchParams.set("schema", schema);
let client: DatabaseClient;
let service: ReturnType<typeof createBookingService>;
before(async () => { await setup(); client = createDatabaseClient(url.toString()); service = createBookingService(client); });
after(async () => { if (client) await client.$disconnect(); await teardown(); });
function code(expected: string) { return (error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.code, expected); return true; }; }
async function actor(userId: string): Promise<Principal> {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
  const session = await client.authSession.create({ data: { userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  return { user, sessionId: session.id, sessionExpiresAt: session.expiresAt };
}
async function selection(venueId: string, ids: string[]) {
  const slots = await client.slot.findMany({ where: { id: { in: ids } } });
  return { venueId, currency: "INR", items: ids.map(id => {
    const found = slots.find(row => row.id === id)!;
    return { slotId: id, version: found.version, priceMinor: found.priceMinor };
  }) };
}

test("checkout books arbitrary courts and dates in one venue with immutable server snapshots", async () => {
  const f = await fixture(); const owner = await actor(f.userId);
  const court = await client.court.create({ data: { venueId: f.venueId, name: "Football court", sport: "Football" } });
  const ids = [await slot(f), await slot({ ...f, courtId: court.id }, 72, 90, 75_000)];
  const result = await service.create(owner, await selection(f.venueId, ids), randomUUID());
  assert.equal(result.status, 201); assert.equal(result.replayed, false);
  assert.equal(result.data.booking.items.length, 2); assert.equal(result.data.booking.status, "CONFIRMED");
  assert.equal(result.data.booking.totals.originalMinor, 125_000);
  assert.deepEqual(result.data.booking.customer, { name: owner.user.name, email: owner.user.email });
  assert.deepEqual(new Set(result.data.booking.items.map(item => item.sport)), new Set(["Badminton", "Football"]));
  const record = await client.idempotencyRecord.findFirstOrThrow({ where: { bookingId: result.data.booking.id } });
  assert.equal(record.responseStatus, 201); assert.equal(record.userId, owner.user.id);
  assert.doesNotMatch(JSON.stringify(record.responseBody), /passwordHash|accessToken|refreshToken|csrfToken/);
});

test("concurrent identical retries return one committed booking and the same response", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const ids = [await slot(f), await slot(f, 3)];
  const input = await selection(f.venueId, ids); const key = randomUUID();
  const results = await Promise.all([
    service.create(owner, input, key),
    service.create(owner, { ...input, items: [...input.items].reverse() }, key),
    service.create(owner, input, key),
  ]);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.ok(results.every(result => result.data.booking.id === results[0]!.data.booking.id));
  for (const result of results) assert.deepEqual(result.data, results[0]!.data);
  assert.equal(await client.booking.count({ where: { userId: owner.user.id } }), 1);
  assert.equal(await client.idempotencyRecord.count({ where: { userId: owner.user.id } }), 1);
});

test("idempotency keys reject changed selections and are scoped to the authenticated user", async () => {
  const f = await fixture(); const other = await fixture(); const owner = await actor(f.userId); const second = await actor(other.userId);
  const firstSlot = await slot(f); const spare = await slot(f, 2); const key = randomUUID();
  await service.create(owner, await selection(f.venueId, [firstSlot]), key);
  await assert.rejects(service.create(owner, await selection(f.venueId, [spare]), key), code("IDEMPOTENCY_KEY_REUSED"));
  const separate = await service.create(second, await selection(f.venueId, [spare]), key);
  assert.equal(separate.replayed, false); assert.equal(await client.idempotencyRecord.count({ where: { key } }), 2);
});

test("competing overlapping selections commit one whole booking without partial reservations", async () => {
  const f = await fixture(); const other = await fixture(); const first = await actor(f.userId); const second = await actor(other.userId);
  const ids = [await slot(f), await slot(f, 2), await slot(f, 5)];
  const results = await Promise.allSettled([
    service.create(first, await selection(f.venueId, [ids[0]!, ids[1]!]), randomUUID()),
    service.create(second, await selection(f.venueId, [ids[2]!, ids[1]!]), randomUUID()),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected"); assert.ok(rejected?.status === "rejected"); code("SLOT_UNAVAILABLE")(rejected.reason);
  assert.equal(await client.booking.count({ where: { userId: { in: [first.user.id, second.user.id] } } }), 1);
  assert.equal(await client.bookingItem.count({ where: { slotId: { in: ids }, status: "RESERVED" } }), 2);
  assert.equal(await client.idempotencyRecord.count({ where: { userId: { in: [first.user.id, second.user.id] } } }), 1);
});

test("stale prices, versions and currencies require review and failed keys remain reusable", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const id = await slot(f); const input = await selection(f.venueId, [id]); const key = randomUUID();
  await client.slot.update({ where: { id }, data: { priceMinor: 60_000 } });
  await assert.rejects(service.create(owner, input, key), code("BOOKING_REVIEW_REQUIRED"));
  const fresh = await selection(f.venueId, [id]);
  await assert.rejects(service.create(owner, { ...fresh, currency: "USD" }, key), code("BOOKING_REVIEW_REQUIRED"));
  assert.equal(await client.booking.count({ where: { userId: owner.user.id } }), 0);
  assert.equal(await client.idempotencyRecord.count({ where: { userId: owner.user.id } }), 0);
  assert.equal((await service.create(owner, fresh, key)).data.booking.items[0]!.priceMinor, 60_000);
});

test("blocked, past and inactive resources cannot be booked", async () => {
  for (const state of ["blocked", "past", "court", "venue"]) {
    const f = await fixture(); const owner = await actor(f.userId);
    if (state === "past") f.startsAt = new Date(Date.now() - 3_600_000);
    const id = await slot(f);
    if (state === "blocked") await client.slot.update({ where: { id }, data: { isBlocked: true } });
    if (state === "court") await client.court.update({ where: { id: f.courtId }, data: { isActive: false } });
    if (state === "venue") await client.venue.update({ where: { id: f.venueId }, data: { isActive: false } });
    await assert.rejects(service.create(owner, await selection(f.venueId, [id]), randomUUID()), code("SLOT_UNAVAILABLE"));
    assert.equal(await client.booking.count({ where: { userId: owner.user.id } }), 0);
  }
});

test("checkout rejects mixed venues and missing slots without committing anything", async () => {
  const f = await fixture(); const other = await fixture(); const owner = await actor(f.userId); const ids = [await slot(f), await slot(other)];
  await assert.rejects(service.create(owner, await selection(f.venueId, ids), randomUUID()), code("VALIDATION_ERROR"));
  const input = await selection(f.venueId, [ids[0]!]); input.items.push({ slotId: randomUUID(), version: 1, priceMinor: 0 });
  await assert.rejects(service.create(owner, input, randomUUID()), code("SLOT_UNAVAILABLE"));
  assert.equal(await client.booking.count({ where: { userId: owner.user.id } }), 0);
});

test("a failed idempotency write rolls back the booking and every reservation", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const input = await selection(f.venueId, [await slot(f), await slot(f, 3)]);
  await db.query("CREATE FUNCTION reject_test_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback' USING ERRCODE = '23514'; END; $$");
  await db.query("CREATE TRIGGER reject_test_result BEFORE INSERT ON idempotency_records FOR EACH ROW EXECUTE FUNCTION reject_test_result()");
  try { await assert.rejects(service.create(owner, input, randomUUID()), code("CONFLICT")); }
  finally { await db.query("DROP TRIGGER reject_test_result ON idempotency_records"); await db.query("DROP FUNCTION reject_test_result()"); }
  assert.equal(await client.booking.count({ where: { userId: owner.user.id } }), 0);
  assert.equal(await client.bookingItem.count({ where: { slotId: { in: input.items.map(item => item.slotId) } } }), 0);
  assert.equal(await client.idempotencyRecord.count({ where: { userId: owner.user.id } }), 0);
});

test("customers see only their bookings; admin views are explicit and use current roles", async () => {
  const f = await fixture(); const other = await fixture(); const owner = await actor(f.userId); const stranger = await actor(other.userId); const admin = await actor(f.adminId);
  const created = await service.create(owner, await selection(f.venueId, [await slot(f)]), randomUUID()); const id = created.data.booking.id;
  assert.equal((await service.list(stranger, {})).bookings.length, 0);
  await assert.rejects(service.get(stranger, id), code("NOT_FOUND"));
  await assert.rejects(service.cancel(stranger, id, { itemIds: [created.data.booking.items[0]!.id] }, randomUUID()), code("NOT_FOUND"));
  await assert.rejects(service.get(admin, id), code("NOT_FOUND"));
  assert.equal((await service.get(admin, id, true)).booking.id, id);
  assert.equal((await service.list(admin, { venueId: f.venueId }, true)).bookings.length, 1);
  await client.user.update({ where: { id: admin.user.id }, data: { role: "CUSTOMER" } });
  await assert.rejects(service.get(admin, id, true), code("FORBIDDEN"));
});

test("booking history has stable newest-first cursors and derived summaries", async () => {
  const f = await fixture(); const owner = await actor(f.userId);
  for (let index = 0; index < 3; index++) await service.create(owner, await selection(f.venueId, [await slot(f, index * 3)]), randomUUID());
  const first = await service.list(owner, { limit: "2" }); assert.equal(first.bookings.length, 2); assert.ok(first.nextCursor);
  const second = await service.list(owner, { limit: "2", cursor: first.nextCursor });
  assert.equal(second.bookings.length, 1); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.bookings, ...second.bookings].map(booking => booking.id)).size, 3);
  assert.equal("items" in first.bookings[0]!, false);
  assert.equal(first.bookings[0]!.totals.originalMinor, 50_000);
});

test("partial customer cancellation preserves history and makes the slot bookable again", async () => {
  const f = await fixture(); const other = await fixture(); const owner = await actor(f.userId); const next = await actor(other.userId);
  const ids = [await slot(f), await slot(f, 3)];
  const created = await service.create(owner, await selection(f.venueId, ids), randomUUID());
  const item = created.data.booking.items[0]!;
  const result = await service.cancel(owner, created.data.booking.id, { itemIds: [item.id] }, randomUUID());
  assert.equal(result.data.booking.status, "PARTIALLY_CANCELLED");
  assert.deepEqual(result.data.booking.totals, { originalMinor: 100_000, cancelledMinor: 50_000, remainingMinor: 50_000 });
  const cancelled = result.data.booking.items.find(row => row.id === item.id)!;
  assert.equal(cancelled.cancellation?.source, "CUSTOMER"); assert.equal(cancelled.canCancel, false);
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(item.startsAt));
  const availability = await createCatalogService(client).listSlots(f.venueId, { date: localDate });
  assert.equal(availability.slots.find(row => row.id === item.slotId)?.isAvailable, true);
  const newBooking = await service.create(next, await selection(f.venueId, [item.slotId]), randomUUID());
  assert.notEqual(newBooking.data.booking.id, created.data.booking.id);
  assert.equal(await client.bookingItem.count({ where: { slotId: item.slotId } }), 2);
  assert.equal(await client.bookingItem.count({ where: { slotId: item.slotId, status: "RESERVED" } }), 1);
});

test("customer batch cancellation is atomic and admin can cancel inside 12 hours with a reason", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const admin = await actor(f.adminId);
  const near = await slot({ ...f, startsAt: new Date(Date.now() + 6 * 3_600_000) }); const far = await slot(f);
  const created = await service.create(owner, await selection(f.venueId, [near, far]), randomUUID()); const booking = created.data.booking;
  await assert.rejects(service.cancel(owner, booking.id, { itemIds: booking.items.map(item => item.id) }, randomUUID()), code("CANCELLATION_WINDOW_CLOSED"));
  assert.equal(await client.bookingItem.count({ where: { bookingId: booking.id, status: "CANCELLED" } }), 0);
  const nearItem = booking.items.find(item => item.slotId === near)!;
  await assert.rejects(service.cancel(admin, booking.id, { itemIds: [nearItem.id] }, randomUUID(), true), code("VALIDATION_ERROR"));
  const overridden = await service.cancel(admin, booking.id, { itemIds: [nearItem.id], reason: "Court maintenance" }, randomUUID(), true);
  assert.equal(overridden.data.booking.items.find(item => item.id === nearItem.id)!.cancellation?.reason, "Court maintenance");
  assert.equal((await client.bookingItem.findUniqueOrThrow({ where: { id: nearItem.id } })).cancelledById, admin.user.id);
});

test("cancellation retries replay the original response and never rewrite cancellation metadata", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const admin = await actor(f.adminId); const createKey = randomUUID();
  const input = await selection(f.venueId, [await slot(f)]); const created = await service.create(owner, input, createKey);
  const body = { itemIds: [created.data.booking.items[0]!.id] }; const key = randomUUID();
  const first = await service.cancel(owner, created.data.booking.id, body, key);
  const retry = await service.cancel(owner, created.data.booking.id, body, key);
  assert.equal(retry.replayed, true); assert.deepEqual(retry.data, first.data);
  const originalReceipt = await service.create(owner, input, createKey);
  assert.equal(originalReceipt.data.booking.status, "CONFIRMED"); assert.equal(originalReceipt.replayed, true);
  assert.equal((await service.get(owner, created.data.booking.id)).booking.status, "CANCELLED");
  const previous = await client.bookingItem.findUniqueOrThrow({ where: { id: body.itemIds[0]! } });
  await service.cancel(admin, created.data.booking.id, { ...body, reason: "Already done" }, randomUUID(), true);
  const unchanged = await client.bookingItem.findUniqueOrThrow({ where: { id: previous.id } });
  assert.equal(unchanged.cancelledAt?.getTime(), previous.cancelledAt?.getTime());
  assert.equal(unchanged.cancelledById, owner.user.id); assert.equal(unchanged.cancellationReason, null);
});

test("concurrent partial cancellations retain both updates and correct final totals", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const admin = await actor(f.adminId);
  const created = await service.create(owner, await selection(f.venueId, [await slot(f), await slot(f, 4)]), randomUUID());
  const items = created.data.booking.items;
  await Promise.all([
    service.cancel(owner, created.data.booking.id, { itemIds: [items[0]!.id] }, randomUUID()),
    service.cancel(admin, created.data.booking.id, { itemIds: [items[1]!.id], reason: "Maintenance" }, randomUUID(), true),
  ]);
  const final = await service.get(owner, created.data.booking.id);
  assert.equal(final.booking.status, "CANCELLED"); assert.equal(final.booking.totals.remainingMinor, 0);
  assert.equal(final.booking.counts.cancelled, 2);
});

test("the customer cutoff is checked using server time after waiting for the slot lock", async () => {
  const f = await fixture(); const owner = await actor(f.userId);
  const time = await db.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  f.startsAt = new Date(time.rows[0]!.now.getTime() + 12 * 3_600_000 + 2000);
  const created = await service.create(owner, await selection(f.venueId, [await slot(f)]), randomUUID());
  const item = created.data.booking.items[0]!; const holder = await connect();
  try {
    await holder.query("BEGIN"); await holder.query("SELECT id FROM slots WHERE id = $1 FOR UPDATE", [item.slotId]);
    const pending = outcome(service.cancel(owner, created.data.booking.id, { itemIds: [item.id] }, randomUUID()));
    await holder.query("SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - interval '12 hours' - clock_timestamp()))) + 0.05)", [f.startsAt]);
    await holder.query("COMMIT"); const result = await pending;
    assert.equal(result.ok, false); if (!result.ok) code("CANCELLATION_WINDOW_CLOSED")(result.error);
    assert.equal((await client.bookingItem.findUniqueOrThrow({ where: { id: item.id } })).status, "RESERVED");
  } finally { await holder.query("ROLLBACK"); await holder.end(); }
});

test("revoked sessions and disabled accounts cannot mutate or replay a booking", async () => {
  const f = await fixture(); const owner = await actor(f.userId); const input = await selection(f.venueId, [await slot(f)]); const key = randomUUID();
  await service.create(owner, input, key);
  await client.authSession.update({ where: { id: owner.sessionId }, data: { revokedAt: new Date() } });
  await assert.rejects(service.create(owner, input, key), code("UNAUTHORIZED"));
  const session = await actor(f.userId); await client.user.update({ where: { id: f.userId }, data: { isActive: false } });
  await assert.rejects(service.list(session, {}), code("UNAUTHORIZED"));
});
