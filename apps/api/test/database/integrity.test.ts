import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  backendPid, booking, cancel, connect, db, fixture, outcome, reserve,
  setup, slot, sqlState, teardown, waitForLock,
} from "./helpers.js";

before(setup);
after(teardown);

test("court intervals reject overlap, allow adjacency, and isolate different courts", async () => {
  const f = await fixture();
  await slot(f);
  await assert.rejects(slot(f, 0.5), sqlState("23P01"));
  await slot(f, 1);
  const otherCourtId = randomUUID();
  await db.query(
    "INSERT INTO courts (id, venue_id, name, sport) VALUES ($1, $2, 'Court 2', 'Badminton')",
    [otherCourtId, f.venueId],
  );
  await slot({ ...f, courtId: otherCourtId });
});

test("invalid intervals and negative prices fail at the database boundary", async () => {
  const f = await fixture();
  await assert.rejects(slot(f, 0, 0), sqlState("23514"));
  await assert.rejects(slot(f, 0, -30), sqlState("23514"));
  await assert.rejects(slot(f, 0, 60, -1), sqlState("23514"));
  await slot(f, 0, 90, 0);
});

test("a slot has one active reservation and retains cancelled reservation history", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const firstBooking = await booking(db, f);
  const firstItem = await reserve(db, firstBooking, slotId);
  const secondBooking = await booking(db, f);
  await assert.rejects(reserve(db, secondBooking, slotId), sqlState("23505"));
  await cancel(firstItem, f.adminId);
  await reserve(db, secondBooking, slotId);
  const result = await db.query(
    "SELECT status, count(*)::int AS count FROM booking_items WHERE slot_id = $1 GROUP BY status ORDER BY status",
    [slotId],
  );
  assert.deepEqual(result.rows, [{ status: "RESERVED", count: 1 }, { status: "CANCELLED", count: 1 }]);
});

test("composite foreign keys prevent mixing venues in a slot or a booking", async () => {
  const f = await fixture();
  const other = await fixture();
  await assert.rejects(slot({ ...f, venueId: other.venueId }), sqlState("23503"));
  const otherSlot = await slot(other);
  const bookingId = await booking(db, f);
  await assert.rejects(reserve(db, bookingId, otherSlot), sqlState("23503"));
});

test("a booking supports arbitrary courts and dates in one venue", async () => {
  const f = await fixture();
  const secondCourt = randomUUID();
  await db.query(
    "INSERT INTO courts (id, venue_id, name, sport) VALUES ($1, $2, 'Court 2', 'Football')",
    [secondCourt, f.venueId],
  );
  const slotIds = [await slot(f), await slot(f, 3, 90), await slot({ ...f, courtId: secondCourt }, 48)];
  const bookingId = await booking(db, f);
  for (const id of slotIds) await reserve(db, bookingId, id);
  const result = await db.query(
    "SELECT count(*)::int AS count, sum(price_minor)::int AS total FROM booking_items WHERE booking_id = $1",
    [bookingId],
  );
  assert.deepEqual(result.rows[0], { count: 3, total: 150_000 });
});

test("reserved slots reject edits and blocking; cancellation permits later edits without rewriting history", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const bookingId = await booking(db, f);
  const itemId = await reserve(db, bookingId, slotId);
  await assert.rejects(db.query("UPDATE slots SET price_minor = 60000 WHERE id = $1", [slotId]), sqlState("23514"));
  await assert.rejects(db.query("UPDATE slots SET is_blocked = true WHERE id = $1", [slotId]), sqlState("23514"));
  await assert.rejects(db.query("UPDATE slots SET ends_at = ends_at + interval '30 minutes' WHERE id = $1", [slotId]), sqlState("23514"));
  await cancel(itemId, f.adminId);
  await db.query("UPDATE slots SET price_minor = 60000 WHERE id = $1", [slotId]);
  const result = await db.query(
    "SELECT s.price_minor AS current_price, s.version, i.price_minor AS confirmed_price FROM slots s JOIN booking_items i ON i.slot_id = s.id WHERE i.id = $1",
    [itemId],
  );
  assert.deepEqual(result.rows[0], { current_price: 60_000, version: 2, confirmed_price: 50_000 });
});

test("slot versions are database-controlled and increment on meaningful changes", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  await db.query("UPDATE slots SET version = 999 WHERE id = $1", [slotId]);
  let result = await db.query("SELECT version FROM slots WHERE id = $1", [slotId]);
  assert.equal(result.rows[0].version, 1);
  await db.query("UPDATE slots SET is_blocked = true WHERE id = $1", [slotId]);
  result = await db.query("SELECT version FROM slots WHERE id = $1", [slotId]);
  assert.equal(result.rows[0].version, 2);
});

test("blocked and past slots cannot be reserved", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  await db.query("UPDATE slots SET is_blocked = true WHERE id = $1", [slotId]);
  const bookingId = await booking(db, f);
  await assert.rejects(reserve(db, bookingId, slotId), sqlState("23514"));
  const past = await slot({ ...f, startsAt: new Date(Date.now() - 7_200_000) });
  await assert.rejects(reserve(db, bookingId, past), sqlState("23514"));
});

test("confirmed snapshots cannot be forged, modified, deleted, or reactivated after cancellation", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const bookingId = await booking(db, f);
  await assert.rejects(db.query(
    `INSERT INTO booking_items (booking_id, slot_id, venue_id, court_name, sport, starts_at, ends_at, price_minor)
     SELECT $1, id, venue_id, 'Court 1', 'Badminton', starts_at, ends_at, 1 FROM slots WHERE id = $2`,
    [bookingId, slotId],
  ), sqlState("23514"));
  const itemId = await reserve(db, bookingId, slotId);
  await assert.rejects(db.query("UPDATE booking_items SET price_minor = 1 WHERE id = $1", [itemId]), sqlState("23514"));
  await assert.rejects(db.query("DELETE FROM booking_items WHERE id = $1", [itemId]), sqlState("23514"));
  await cancel(itemId, f.adminId);
  await assert.rejects(db.query(
    "UPDATE booking_items SET status = 'RESERVED', cancelled_at = NULL, cancelled_by_id = NULL, cancellation_source = NULL, cancellation_reason = NULL WHERE id = $1",
    [itemId],
  ), sqlState("23514"));
});

test("cancellation requires complete metadata and an admin reason", async () => {
  const f = await fixture();
  const itemId = await reserve(db, await booking(db, f), await slot(f));
  await assert.rejects(db.query("UPDATE booking_items SET status = 'CANCELLED' WHERE id = $1", [itemId]), sqlState("23514"));
  await assert.rejects(db.query(
    "UPDATE booking_items SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by_id = $2, cancellation_source = 'ADMIN' WHERE id = $1",
    [itemId, f.adminId],
  ), sqlState("23514"));
  await cancel(itemId, f.adminId);
});

test("competing customers cannot both reserve one slot; the loser leaves no partial booking", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const first = await connect();
  const second = await connect();
  try {
    const secondPid = await backendPid(second);
    await first.query("BEGIN");
    await second.query("BEGIN");
    const firstBooking = await booking(first, f);
    const secondBooking = await booking(second, f);
    await reserve(first, firstBooking, slotId);
    const competingInsert = outcome(reserve(second, secondBooking, slotId));
    await waitForLock(secondPid);
    await first.query("COMMIT");
    const result = await competingInsert;
    assert.equal(result.ok, false);
    if (!result.ok) sqlState("23505")(result.error);
    await second.query("ROLLBACK");
    const saved = await db.query("SELECT id FROM bookings WHERE id = ANY($1::uuid[])", [[firstBooking, secondBooking]]);
    assert.deepEqual(saved.rows, [{ id: firstBooking }]);
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    await Promise.all([first.end(), second.end()]);
  }
});

test("a multi-slot conflict rolls back earlier items and the booking header", async () => {
  const f = await fixture();
  const freeSlot = await slot(f);
  const occupiedSlot = await slot(f, 2);
  await reserve(db, await booking(db, f), occupiedSlot);
  const client = await connect();
  try {
    await client.query("BEGIN");
    const attemptedBooking = await booking(client, f);
    await reserve(client, attemptedBooking, freeSlot);
    await assert.rejects(reserve(client, attemptedBooking, occupiedSlot), sqlState("23505"));
    await client.query("ROLLBACK");
    const result = await db.query(
      "SELECT (SELECT count(*)::int FROM bookings WHERE id = $1) AS bookings, (SELECT count(*)::int FROM booking_items WHERE slot_id = $2) AS items",
      [attemptedBooking, freeSlot],
    );
    assert.deepEqual(result.rows[0], { bookings: 0, items: 0 });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("concurrent admin slot creation cannot introduce overlapping availability", async () => {
  const f = await fixture();
  const first = await connect();
  const second = await connect();
  try {
    const pid = await backendPid(second);
    await first.query("BEGIN");
    await second.query("BEGIN");
    const insert = "INSERT INTO slots (venue_id, court_id, starts_at, ends_at, price_minor) VALUES ($1, $2, $3, $4, 50000)";
    await first.query(insert, [f.venueId, f.courtId, f.startsAt, new Date(f.startsAt.getTime() + 3_600_000)]);
    const competing = outcome(second.query(insert, [f.venueId, f.courtId, new Date(f.startsAt.getTime() + 1_800_000), new Date(f.startsAt.getTime() + 5_400_000)]));
    await waitForLock(pid);
    await first.query("COMMIT");
    const result = await competing;
    assert.equal(result.ok, false);
    if (!result.ok) sqlState("23P01")(result.error);
    await second.query("ROLLBACK");
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    await Promise.all([first.end(), second.end()]);
  }
});

test("blocking waits for an in-flight booking and cannot hide its active reservation", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const first = await connect();
  const second = await connect();
  try {
    const pid = await backendPid(second);
    await first.query("BEGIN");
    const itemId = await reserve(first, await booking(first, f), slotId);
    const competing = outcome(second.query("UPDATE slots SET is_blocked = true WHERE id = $1", [slotId]));
    await waitForLock(pid);
    await first.query("COMMIT");
    const result = await competing;
    assert.equal(result.ok, false);
    if (!result.ok) sqlState("23514")(result.error);
    await cancel(itemId, f.adminId);
    await db.query("UPDATE slots SET is_blocked = true WHERE id = $1", [slotId]);
  } finally {
    await first.query("ROLLBACK");
    await Promise.all([first.end(), second.end()]);
  }
});

test("idempotency keys coordinate concurrent attempts and preserve the committed result", async () => {
  const f = await fixture();
  const key = randomUUID();
  const bookingId = await booking(db, f);
  const first = await connect();
  const second = await connect();
  const insert = `INSERT INTO idempotency_records
    (user_id, operation, key, request_hash, response_status, response_body, booking_id)
    VALUES ($1, 'BOOKING_CREATE', $2, $3, 201, $4::jsonb, $5)`;
  const values = [f.userId, key, "a".repeat(64), JSON.stringify({ bookingId }), bookingId];
  try {
    const pid = await backendPid(second);
    await first.query("BEGIN");
    await first.query(insert, values);
    const competing = outcome(second.query(insert, values));
    await waitForLock(pid);
    await first.query("COMMIT");
    const result = await competing;
    assert.equal(result.ok, false);
    if (!result.ok) sqlState("23505")(result.error);
    const saved = await second.query(
      "SELECT response_status, response_body FROM idempotency_records WHERE user_id = $1 AND operation = 'BOOKING_CREATE' AND key = $2",
      [f.userId, key],
    );
    assert.deepEqual(saved.rows[0], { response_status: 201, response_body: { bookingId } });
  } finally {
    await first.query("ROLLBACK");
    await Promise.all([first.end(), second.end()]);
  }
});

test("booking and idempotency results roll back together", async () => {
  const f = await fixture();
  const slotId = await slot(f);
  const key = randomUUID();
  const client = await connect();
  try {
    await client.query("BEGIN");
    const bookingId = await booking(client, f);
    await reserve(client, bookingId, slotId);
    await client.query(
      `INSERT INTO idempotency_records (user_id, operation, key, request_hash, response_status, response_body, booking_id)
       VALUES ($1, 'BOOKING_CREATE', $2, $3, 201, $4::jsonb, $5)`,
      [f.userId, key, "b".repeat(64), JSON.stringify({ bookingId }), bookingId],
    );
    await client.query("ROLLBACK");
    const result = await db.query(
      "SELECT (SELECT count(*)::int FROM bookings WHERE id = $1) AS bookings, (SELECT count(*)::int FROM idempotency_records WHERE key = $2) AS results, (SELECT count(*)::int FROM booking_items WHERE slot_id = $3) AS items",
      [bookingId, key, slotId],
    );
    assert.deepEqual(result.rows[0], { bookings: 0, results: 0, items: 0 });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("refresh token rotation retains consumed hashes and permits one current credential", async () => {
  const f = await fixture();
  const sessionId = randomUUID();
  await db.query(
    "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [sessionId, f.userId],
  );
  await db.query(
    "INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [sessionId, "a".repeat(64)],
  );
  await assert.rejects(db.query(
    "INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [sessionId, "b".repeat(64)],
  ), sqlState("23505"));
  await db.query("BEGIN");
  try {
    await db.query("UPDATE refresh_tokens SET consumed_at = clock_timestamp() WHERE session_id = $1", [sessionId]);
    await db.query(
      "INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '7 days')",
      [sessionId, "b".repeat(64)],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const result = await db.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE consumed_at IS NULL)::int AS current FROM refresh_tokens WHERE session_id = $1",
    [sessionId],
  );
  assert.deepEqual(result.rows[0], { total: 2, current: 1 });
});

test("invalid credentials and incomplete idempotency results are rejected", async () => {
  const f = await fixture();
  await assert.rejects(db.query(
    "INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, now() - interval '1 day')", [f.userId],
  ), sqlState("23514"));
  await assert.rejects(db.query(
    "INSERT INTO users (email, name, password_hash) VALUES ('MixedCase@example.test', 'Test', 'test-only')",
  ), sqlState("23514"));
  await assert.rejects(db.query(
    "INSERT INTO idempotency_records (user_id, operation, key, request_hash, response_status, response_body) VALUES ($1, 'BOOKING_CREATE', $2, $3, 500, '{}'::jsonb)",
    [f.userId, randomUUID(), "c".repeat(64)],
  ), sqlState("23514"));
});
