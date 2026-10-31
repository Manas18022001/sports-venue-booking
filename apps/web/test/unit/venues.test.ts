import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { parseServerConfig } from "../../src/server/config/schema.js";
import { ApiError } from "../../src/server/api/errors.js";
import { generationPlan, signPreview, verifyPreview } from "../../src/server/venues/generation.js";
import { isLocalDate, isTimeZone, localDayBounds } from "../../src/server/venues/time.js";
import { generationSchema, generationConfirmSchema, slotQuerySchema, slotUpdateSchema, venueCreateSchema, venueUpdateSchema } from "../../src/server/venues/schemas.js";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";

const config = parseServerConfig({ DATABASE_URL: "postgresql://localhost/turfit_test", AUTH_SECRET: TEST_AUTH_SECRET });
const window = { courtIds: [randomUUID(), randomUUID()], startsAt: "2030-01-01T09:00:00+05:30", endsAt: "2030-01-01T11:30:00+05:30", priceMinor: 50_000 };

test("venue dates are real calendar dates and use venue-local midnight", () => {
  assert.equal(isLocalDate("2028-02-29"), true);
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "2026-01-01T00:00:00Z"]) assert.equal(isLocalDate(date), false);
  const day = localDayBounds("2030-01-01", "Asia/Kolkata");
  assert.equal(day.start.toISOString(), "2029-12-31T18:30:00.000Z");
  assert.equal(day.end.toISOString(), "2030-01-01T18:30:00.000Z");
  assert.equal(isTimeZone("Asia/Kolkata"), true); assert.equal(isTimeZone("UTC"), true);
  assert.equal(isTimeZone("+05:30"), false); assert.equal(isTimeZone("Not/AZone"), false);
});

test("calendar day boundaries account for 23-hour, 25-hour, and skipped local dates", () => {
  const spring = localDayBounds("2027-03-14", "America/New_York");
  const autumn = localDayBounds("2027-11-07", "America/New_York");
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3_600_000);
  assert.equal(autumn.end.getTime() - autumn.start.getTime(), 25 * 3_600_000);
  assert.throws(() => localDayBounds("2011-12-30", "Pacific/Apia"), RangeError);
});

test("generation defaults to 60 minutes, reports unused time, and creates no fractional slot", () => {
  const plan = generationPlan(generationSchema.parse(window));
  assert.equal(plan.durationMinutes, 60); assert.equal(plan.slotsPerCourt, 2); assert.equal(plan.totalSlots, 4);
  assert.equal(plan.unusedPeriod?.durationMinutes, 30);
  assert.equal(plan.unusedPeriod?.startsAt, "2030-01-01T05:30:00.000Z");
  assert.ok(plan.slots.every(slot => Date.parse(slot.endsAt) - Date.parse(slot.startsAt) === 3_600_000));
  const exact = generationPlan(generationSchema.parse({ ...window, durationMinutes: 30 }));
  assert.equal(exact.unusedPeriod, null); assert.equal(exact.totalSlots, 10);
});

test("generation rejects ambiguous instants, duplicates, invalid money, short windows, and excessive batches", () => {
  for (const change of [
    { startsAt: "2030-01-01T09:00:00" }, { startsAt: "2030-01-01T09:00:01Z" },
    { courtIds: [window.courtIds[0], window.courtIds[0]] }, { courtIds: [] },
    { courtIds: [window.courtIds[0], window.courtIds[0]!.toUpperCase()] },
    { durationMinutes: 0 }, { durationMinutes: 4 }, { durationMinutes: 180 },
    { endsAt: window.startsAt }, { endsAt: "2030-01-03T11:30:00Z" },
    { priceMinor: -1 }, { priceMinor: 1.1 }, { priceMinor: 2_147_483_648 },
    { courtIds: Array.from({ length: 20 }, () => randomUUID()), durationMinutes: 5 },
  ]) assert.equal(generationSchema.safeParse({ ...window, ...change }).success, false);
  assert.equal(generationConfirmSchema.parse({ ...window, previewToken: "signed" }).acknowledgeUnusedPeriod, false);
});

test("preview signatures bind the reviewed plan, actor, venue settings, and expiry", () => {
  const plan = generationPlan(generationSchema.parse(window));
  const binding = { adminId: randomUUID(), venueId: randomUUID(), timezone: "Asia/Kolkata", currency: "INR", plan };
  const now = new Date(); const signed = signPreview(config, binding, now);
  assert.doesNotThrow(() => verifyPreview(config, binding, signed.previewToken, now));
  for (const change of [{ adminId: randomUUID() }, { venueId: randomUUID() }, { timezone: "UTC" }, { plan: { ...plan, priceMinor: 1 } }]) {
    assert.throws(() => verifyPreview(config, { ...binding, ...change }, signed.previewToken, now), ApiError);
  }
  assert.throws(() => verifyPreview(config, binding, `${signed.previewToken}x`, now), ApiError);
  assert.throws(() => verifyPreview(config, binding, signed.previewToken, new Date(now.getTime() + 600_000)), ApiError);
});

test("venue, slot, and pagination schemas reject unsafe or unsupported input", () => {
  const venue = venueCreateSchema.parse({ name: " Venue ", address: " Street ", city: " Pune " });
  assert.equal(venue.name, "Venue"); assert.equal(venue.timezone, "Asia/Kolkata"); assert.equal(venue.currency, "INR");
  for (const change of [{ timezone: "Invalid/Zone" }, { currency: "USD" }, { imageUrl: "javascript:alert(1)" }, { role: "ADMIN" }]) assert.equal(venueCreateSchema.safeParse({ ...venue, ...change }).success, false);
  assert.equal(venueUpdateSchema.safeParse({}).success, false);
  assert.equal(slotUpdateSchema.safeParse({ version: 1 }).success, false);
  assert.equal(slotUpdateSchema.safeParse({ priceMinor: 100 }).success, false);
  assert.equal(slotQuerySchema.safeParse({ date: "2030-01-01", limit: "501" }).success, false);
  assert.equal(slotQuerySchema.safeParse({ date: "2030-01-01", limit: "1e2" }).success, false);
});
