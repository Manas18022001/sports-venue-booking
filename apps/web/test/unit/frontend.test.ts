import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  addDays,
  localDate,
  localInput,
  money,
  priceMinor,
  safeReturnPath,
  toInstant,
} from "../../src/client/format.js";
import { cartTotal, readCart } from "../../src/client/cart.js";

test("rupee input uses integer arithmetic and never rounds fractional paise silently", () => {
  assert.equal(priceMinor("0.29"), 29);
  assert.equal(priceMinor("500"), 50_000);
  assert.equal(priceMinor("500.5"), 50_050);
  assert.equal(priceMinor("21474836.47"), 2_147_483_647);
  for (const value of [
    "-1",
    "1.001",
    "NaN",
    "Infinity",
    "1e3",
    "",
    "1,000",
    "21474836.48",
  ])
    assert.throws(() => priceMinor(value));
  assert.match(money(50_000), /500/);
});

test("frontend dates and admin inputs use the venue timezone, not the browser timezone", async () => {
  assert.equal(
    localDate(new Date("2030-01-01T19:00:00Z"), "Asia/Kolkata"),
    "2030-01-02",
  );
  assert.equal(
    localInput("2030-01-01T19:00:00Z", "Asia/Kolkata"),
    "2030-01-02T00:30",
  );
  assert.equal(
    await toInstant("2030-01-02T00:30", "Asia/Kolkata"),
    "2030-01-01T19:00:00Z",
  );
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2030-12-31", 1), "2031-01-01");
  await assert.rejects(toInstant("2027-03-14T02:30", "America/New_York"));
  await assert.rejects(toInstant("2027-11-07T01:30", "America/New_York"));
});

test("authentication return paths cannot navigate to another origin or execute a script", () => {
  for (const value of [
    null,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "checkout",
  ])
    assert.equal(safeReturnPath(value), "/");
  assert.equal(safeReturnPath("/checkout"), "/checkout");
  assert.equal(
    safeReturnPath("/venues/abc?date=2030-01-01#slots"),
    "/venues/abc?date=2030-01-01#slots",
  );
});

test("restoring a selection preserves the checkout key and rejects malformed session storage", () => {
  const cart = {
    venue: {
      id: randomUUID(),
      name: "Test Venue",
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
    items: [
      {
        id: randomUUID(),
        courtId: randomUUID(),
        courtName: "Court A",
        sport: "Tennis",
        startsAt: "2030-01-01T00:00:00.000Z",
        endsAt: "2030-01-01T01:00:00.000Z",
        priceMinor: 50_000,
        version: 1,
      },
    ],
    key: randomUUID(),
    pendingUserId: randomUUID(),
  };
  const restored = readCart(JSON.stringify(cart));
  assert.ok(restored);
  assert.equal(restored.key, cart.key);
  assert.equal(restored.pendingUserId, cart.pendingUserId);
  assert.equal(cartTotal(restored), 50_000);
  for (const value of [
    null,
    "not json",
    "{}",
    JSON.stringify({ ...cart, key: "invalid" }),
    JSON.stringify({ ...cart, items: [] }),
    " ".repeat(250_001),
  ])
    assert.equal(readCart(value), null);
  assert.equal(cartTotal(null), 0);
});
