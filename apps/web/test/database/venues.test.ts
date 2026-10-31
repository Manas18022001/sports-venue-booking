import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Temporal } from "@js-temporal/polyfill";
import { createDatabaseClient } from "../../src/database/client.js";
import type { DatabaseClient } from "../../src/database/client.js";
import { parseServerConfig } from "../../src/server/config/schema.js";
import { createCatalogService } from "../../src/server/venues/catalog.js";
import { createVenueAdminService } from "../../src/server/venues/admin.js";
import { generationPlan, signPreview } from "../../src/server/venues/generation.js";
import { generationSchema } from "../../src/server/venues/schemas.js";
import { ApiError } from "../../src/server/api/errors.js";
import { setup, teardown, schema, testDatabaseUrl, db, fixture as baseFixture, slot, booking, reserve, cancel, connect } from "./helpers.js";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";

const url = new URL(testDatabaseUrl); url.searchParams.set("schema", schema);
const config = parseServerConfig({ DATABASE_URL: url.toString(), AUTH_SECRET: TEST_AUTH_SECRET, NODE_ENV: "test" });
let client: DatabaseClient;
let catalog: ReturnType<typeof createCatalogService>;
let admin: ReturnType<typeof createVenueAdminService>;
before(async () => { await setup(); client = createDatabaseClient(url.toString()); catalog = createCatalogService(client); admin = createVenueAdminService(client, config); });
after(async () => { if (client) await client.$disconnect(); await teardown(); });
function code(expected: string) { return (error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.code, expected); return true; }; }
async function fixture() {
  const value = await baseFixture();
  // Keep this suite's short windows away from midnight regardless of test time.
  value.startsAt = new Date(`${value.startsAt.toISOString().slice(0, 10)}T03:30:00Z`);
  return value;
}
function dateFor(date: Date, timezone = "Asia/Kolkata") { return Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(timezone).toPlainDate().toString(); }
async function inputFor(f: Awaited<ReturnType<typeof fixture>>, minutes = 150) {
  return { courtIds: [f.courtId], startsAt: f.startsAt.toISOString().replace(".000Z", "Z"),
    endsAt: new Date(f.startsAt.getTime() + minutes * 60_000).toISOString().replace(".000Z", "Z"), priceMinor: 50_000 };
}
async function generate(f: Awaited<ReturnType<typeof fixture>>, minutes = 150) {
  const input = await inputFor(f, minutes); const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  return admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken, acknowledgeUnusedPeriod: true }, f.adminId);
}

test("public discovery filters active venues, cities and sports and derives available starting prices", async () => {
  const f = await fixture(); const city = `City-${randomUUID()}`;
  await client.venue.update({ where: { id: f.venueId }, data: { city } });
  const first = await slot(f, 0, 60, 90_000); await slot(f, 1, 60, 60_000);
  await client.slot.update({ where: { id: first }, data: { isBlocked: true } });
  const result = await catalog.listVenues({ city: city.toUpperCase(), sport: "badminton" });
  assert.equal(result.venues.length, 1); assert.equal(result.venues[0]!.startingPriceMinor, 60_000);
  assert.deepEqual(result.venues[0]!.sports, ["Badminton"]);
  assert.equal("isActive" in result.venues[0]!, false);
  await client.court.update({ where: { id: f.courtId }, data: { isActive: false } });
  assert.equal((await catalog.getVenue(f.venueId)).startingPriceMinor, null);
  assert.equal((await catalog.listVenues({ city, sport: "Badminton" })).venues.length, 0);
  await admin.updateVenue(f.venueId, { isActive: false });
  await assert.rejects(catalog.getVenue(f.venueId), code("NOT_FOUND"));
  assert.equal((await catalog.getVenue(f.venueId, true)).isActive, false);
});

test("public availability exposes safe status and versions and cancellation makes a slot available again", async () => {
  const f = await fixture(); const free = await slot(f); const blocked = await slot(f, 1); const reserved = await slot(f, 2);
  await client.slot.update({ where: { id: blocked }, data: { isBlocked: true } });
  const item = await reserve(db, await booking(db, f), reserved);
  const result = await catalog.listSlots(f.venueId, { date: dateFor(f.startsAt) });
  assert.equal(result.slots.find(row => row.id === free)?.availability, "AVAILABLE");
  assert.equal(result.slots.find(row => row.id === blocked)?.availability, "BLOCKED");
  assert.equal(result.slots.find(row => row.id === reserved)?.availability, "BOOKED");
  assert.equal(result.slots.find(row => row.id === reserved)?.isAvailable, false);
  assert.ok(result.slots.every(row => row.version > 0));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(f.userId), false); assert.equal(serialized.includes(item), false);
  assert.equal((await catalog.getVenue(f.venueId)).startingPriceMinor, 50_000);
  await cancel(item, f.adminId);
  assert.equal((await catalog.listSlots(f.venueId, { date: dateFor(f.startsAt) })).slots.find(row => row.id === reserved)?.availability, "AVAILABLE");
});

test("venue-local date filtering includes local midnight and excludes the next day's midnight", async () => {
  const f = await fixture();
  const day = "2030-04-02";
  for (const startsAt of ["2030-04-01T17:30:00Z", "2030-04-01T18:30:00Z", "2030-04-02T18:30:00Z"]) {
    await client.slot.create({ data: { venueId: f.venueId, courtId: f.courtId, startsAt: new Date(startsAt), endsAt: new Date(Date.parse(startsAt) + 60 * 60_000), priceMinor: 100 } });
  }
  const result = await catalog.listSlots(f.venueId, { date: day });
  assert.equal(result.slots.length, 1); assert.equal(result.slots[0]!.startsAt, "2030-04-01T18:30:00.000Z");
  assert.equal(result.dayEndsAt, "2030-04-02T18:30:00.000Z");
});

test("public routes hide archived courts and venues while admin reads retain their slots", async () => {
  const f = await fixture(); await slot(f);
  await admin.updateCourt(f.venueId, f.courtId, { isActive: false });
  assert.equal((await catalog.listCourts(f.venueId, {})).courts.length, 0);
  assert.equal((await catalog.listSlots(f.venueId, { date: dateFor(f.startsAt) })).slots.length, 0);
  assert.equal((await catalog.listSlots(f.venueId, { date: dateFor(f.startsAt) }, true)).slots[0]!.availability, "INACTIVE");
  await admin.updateVenue(f.venueId, { isActive: false });
  await assert.rejects(catalog.listSlots(f.venueId, { date: dateFor(f.startsAt) }), code("NOT_FOUND"));
});

test("slot and court pagination have stable cursors without duplicates", async () => {
  const f = await fixture(); await slot(f); await slot(f, 1); await slot(f, 2);
  const query = { date: dateFor(f.startsAt), limit: "2" };
  const first = await catalog.listSlots(f.venueId, query); assert.equal(first.slots.length, 2); assert.ok(first.nextCursor);
  const second = await catalog.listSlots(f.venueId, { ...query, cursor: first.nextCursor });
  assert.equal(second.slots.length, 1); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.slots, ...second.slots].map(row => row.id)).size, 3);
  await admin.createCourt(f.venueId, { name: "Second", sport: "Football" });
  const courts = await catalog.listCourts(f.venueId, { limit: "1" }); assert.ok(courts.nextCursor);
  assert.equal((await catalog.listCourts(f.venueId, { limit: "1", cursor: courts.nextCursor })).courts.length, 1);
});

test("admin venue and court creation validate fields, prevent duplicate names, and scope IDs to a venue", async () => {
  const venue = await admin.createVenue({ name: "New Venue", city: "Pune", address: "Street" });
  assert.equal(venue.timezone, "Asia/Kolkata");
  const court = await admin.createCourt(venue.id, { name: "Court A", sport: "Tennis" });
  await assert.rejects(admin.createCourt(venue.id, { name: "Court A", sport: "Tennis" }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "CONFLICT");
    assert.deepEqual(error.issues, [{ field: "name", message: "Another court in this venue already uses this name." }]);
    return true;
  });
  await assert.rejects(admin.updateCourt(randomUUID(), court.id, { name: "Wrong" }), code("NOT_FOUND"));
  await assert.rejects(admin.createCourt(randomUUID(), { name: "A", sport: "Tennis" }), code("NOT_FOUND"));
  await assert.rejects(admin.updateVenue(venue.id, { timezone: "Broken/Zone" }), code("VALIDATION_ERROR"));
  assert.equal((await admin.updateCourt(venue.id, court.id, { name: "Updated" })).name, "Updated");
});

test("generation preview writes nothing and unused time requires explicit acknowledgement", async () => {
  const f = await fixture(); const input = await inputFor(f);
  const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  assert.equal(preview.totalSlots, 2); assert.equal(preview.unusedPeriod?.durationMinutes, 30); assert.equal(preview.canGenerate, true);
  assert.equal(await client.slot.count({ where: { venueId: f.venueId } }), 0);
  await assert.rejects(admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken }, f.adminId), code("UNUSED_PERIOD_ACKNOWLEDGEMENT_REQUIRED"));
  const result = await admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken, acknowledgeUnusedPeriod: true }, f.adminId);
  assert.equal(result.createdCount, 2);
  assert.equal(result.slots.at(-1)!.endsAt, preview.unusedPeriod!.startsAt);
});

test("changed, forged, expired, or differently owned previews cannot create slots", async () => {
  const f = await fixture(); const input = await inputFor(f, 120); const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  const confirmed = { ...input, previewToken: preview.previewToken };
  await assert.rejects(admin.generateSlots(f.venueId, { ...confirmed, priceMinor: 1 }, f.adminId), code("PREVIEW_EXPIRED"));
  await assert.rejects(admin.generateSlots(f.venueId, confirmed, randomUUID()), code("PREVIEW_EXPIRED"));
  await assert.rejects(admin.generateSlots(f.venueId, { ...confirmed, previewToken: "forged" }, f.adminId), code("PREVIEW_EXPIRED"));
  const plan = generationPlan(generationSchema.parse(input));
  const expired = signPreview(config, { adminId: f.adminId, venueId: f.venueId, timezone: "Asia/Kolkata", currency: "INR", plan }, new Date(Date.now() - 660_000));
  await assert.rejects(admin.generateSlots(f.venueId, { ...confirmed, previewToken: expired.previewToken }, f.adminId), code("PREVIEW_EXPIRED"));
  await admin.updateVenue(f.venueId, { timezone: "UTC" });
  await assert.rejects(admin.generateSlots(f.venueId, confirmed, f.adminId), code("PREVIEW_EXPIRED"));
  assert.equal(await client.slot.count({ where: { venueId: f.venueId } }), 0);
});

test("overlaps on any selected court reject the entire generation batch", async () => {
  const f = await fixture(); const second = await admin.createCourt(f.venueId, { name: "Second", sport: "Football" });
  await slot({ ...f, courtId: second.id }, 1);
  const input = { ...await inputFor(f, 120), courtIds: [f.courtId, second.id] };
  const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  assert.equal(preview.canGenerate, false); assert.equal(preview.conflicts.length, 1);
  await assert.rejects(admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken }, f.adminId), code("SLOT_OVERLAP"));
  assert.equal(await client.slot.count({ where: { courtId: f.courtId } }), 0);
});

test("existing slots entirely in unused time do not conflict with generated intervals", async () => {
  const f = await fixture(); await slot(f, 2, 30);
  const result = await generate(f);
  assert.equal(result.createdCount, 2); assert.equal(await client.slot.count({ where: { venueId: f.venueId } }), 3);
});

test("concurrent empty-range generation allows one full batch and translates the database exclusion error", async () => {
  const f = await fixture(); const input = await inputFor(f, 120);
  const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  const other = createDatabaseClient(url.toString());
  // The isolated schema's test-only trigger makes both requests observe an empty
  // range before insertion, exercising the exclusion constraint rather than only
  // the service's preflight overlap query.
  await db.query("CREATE FUNCTION delay_test_slot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END; $$");
  await db.query("CREATE TRIGGER delay_test_slot BEFORE INSERT ON slots FOR EACH ROW EXECUTE FUNCTION delay_test_slot()");
  try {
    const confirmed = { ...input, previewToken: preview.previewToken };
    const results = await Promise.allSettled([admin.generateSlots(f.venueId, confirmed, f.adminId), createVenueAdminService(other, config).generateSlots(f.venueId, confirmed, f.adminId)]);
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
    const rejected = results.find(row => row.status === "rejected"); assert.ok(rejected?.status === "rejected"); code("SLOT_OVERLAP")(rejected.reason);
    assert.equal(await client.slot.count({ where: { venueId: f.venueId } }), 2);
  } finally {
    await other.$disconnect(); await db.query("DROP TRIGGER delay_test_slot ON slots"); await db.query("DROP FUNCTION delay_test_slot()");
  }
});

test("confirmation rechecks conflicts and activity that changed after preview", async () => {
  const f = await fixture(); const input = await inputFor(f, 120); const preview = await admin.previewSlots(f.venueId, input, f.adminId);
  await slot(f);
  await assert.rejects(admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken }, f.adminId), code("SLOT_OVERLAP"));
  await admin.updateCourt(f.venueId, f.courtId, { isActive: false });
  await assert.rejects(admin.generateSlots(f.venueId, { ...input, previewToken: preview.previewToken }, f.adminId), code("CONFLICT"));
});

test("generation rejects foreign courts and past starts and freezes timezone once slots exist", async () => {
  const f = await fixture(); const other = await fixture(); const input = await inputFor(f, 120);
  await assert.rejects(admin.previewSlots(f.venueId, { ...input, courtIds: [other.courtId] }, f.adminId), code("CONFLICT"));
  await assert.rejects(admin.previewSlots(f.venueId, { ...input, startsAt: "2020-01-01T00:00:00Z", endsAt: "2020-01-01T02:00:00Z" }, f.adminId), code("VALIDATION_ERROR"));
  await generate(f, 120);
  await assert.rejects(admin.updateVenue(f.venueId, { timezone: "UTC" }), code("CONFLICT"));
  await assert.rejects(admin.updateCourt(f.venueId, f.courtId, { sport: "Football" }), code("CONFLICT"));
});

test("slot edits enforce versions, preserve no-op versions, and prevent overlap", async () => {
  const f = await fixture(); const generated = await generate(f, 120); const first = generated.slots[0]!;
  const blocked = await admin.updateSlot(f.venueId, first.id, { version: first.version, isBlocked: true });
  assert.equal(blocked.version, first.version + 1); assert.equal(blocked.isBlocked, true);
  const noOp = await admin.updateSlot(f.venueId, first.id, { version: blocked.version, isBlocked: true });
  assert.equal(noOp.version, blocked.version);
  await assert.rejects(admin.updateSlot(f.venueId, first.id, { version: first.version, priceMinor: 1 }), code("STALE_SLOT"));
  await assert.rejects(admin.updateSlot(f.venueId, first.id, { version: blocked.version, endsAt: generated.slots[1]!.endsAt.replace(".000Z", "Z") }), code("SLOT_OVERLAP"));
  const open = await admin.updateSlot(f.venueId, first.id, { version: blocked.version, isBlocked: false, priceMinor: 60_000 });
  assert.equal(open.version, blocked.version + 1); assert.equal(open.priceMinor, 60_000);
});

test("reserved slots reject edits and blocking until cancellation, retaining historical snapshots", async () => {
  const f = await fixture(); const id = await slot(f); const item = await reserve(db, await booking(db, f), id);
  await assert.rejects(admin.updateSlot(f.venueId, id, { version: 1, priceMinor: 1 }), code("SLOT_RESERVED"));
  await assert.rejects(admin.updateSlot(f.venueId, id, { version: 1, isBlocked: true }), code("SLOT_RESERVED"));
  await cancel(item, f.adminId);
  assert.equal((await admin.updateSlot(f.venueId, id, { version: 1, priceMinor: 60_000 })).priceMinor, 60_000);
  assert.equal((await client.bookingItem.findUniqueOrThrow({ where: { id: item } })).priceMinor, 50_000);
});

test("concurrent edits using one slot version cannot silently overwrite each other", async () => {
  const f = await fixture(); const id = await slot(f);
  const results = await Promise.allSettled([
    admin.updateSlot(f.venueId, id, { version: 1, priceMinor: 60_000 }),
    admin.updateSlot(f.venueId, id, { version: 1, priceMinor: 70_000 }),
  ]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  const rejected = results.find(row => row.status === "rejected"); assert.ok(rejected?.status === "rejected"); code("STALE_SLOT")(rejected.reason);
});

test("admin lock waits are bounded by PostgreSQL and return a safe retryable error", { timeout: 12_000 }, async () => {
  const f = await fixture(); const id = await slot(f); const holder = await connect();
  try {
    await holder.query("BEGIN"); await holder.query("SELECT id FROM slots WHERE id = $1 FOR UPDATE", [id]);
    const started = performance.now();
    await assert.rejects(admin.updateSlot(f.venueId, id, { version: 1, priceMinor: 60_000 }), code("SERVICE_UNAVAILABLE"));
    assert.ok(performance.now() - started < 8_000, "The database lock deadline must precede the JavaScript transaction deadline");
    assert.equal((await client.slot.findUniqueOrThrow({ where: { id } })).version, 1);
  } finally { await holder.query("ROLLBACK"); await holder.end(); }
});
