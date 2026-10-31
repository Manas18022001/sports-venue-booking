import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ClientError, errorMessage } from "../../src/client/api";
import { checkedField, describeFormError, FormValidationError, InputValueError } from "../../src/client/form-errors";
import { validate } from "../../src/server/api/validation";
import { ApiError } from "../../src/server/api/errors";
import { generationSchema, venueCreateSchema } from "../../src/server/venues/schemas";
import { registrationSchema } from "../../src/server/auth/schemas";

function issues(schema: z.ZodType, value: unknown) {
  try { validate(schema, value); assert.fail("Expected validation failure"); }
  catch (error) { assert.ok(error instanceof ApiError); return error.issues!; }
}

test("form errors group array paths and preserve details without duplicating their summary", () => {
  const error = new ClientError(422, "VALIDATION_ERROR", "Review your entries.", [{ field: "courtIds.0", message: "Choose an active court." }]);
  assert.deepEqual(describeFormError(error), { message: "Review your entries.", issues: [{ field: "courtIds", message: "Choose an active court." }] });
  assert.match(errorMessage(error), /Choose an active court/);
  assert.equal(describeFormError(new ClientError(429, "RATE_LIMITED", "Too many requests.", [], 30)).message, "Too many requests. Try again in 30 seconds.");
  assert.equal(describeFormError(new Error("private database detail")).message, "Something went wrong. Please try again.");
});

test("local time and price parsers attach their validation failure to the correct field", async () => {
  await assert.rejects(checkedField("priceMinor", () => { throw new InputValueError("Enter a valid price."); }), (error: unknown) => {
    assert.ok(error instanceof FormValidationError);
    assert.deepEqual(error.issues, [{ field: "priceMinor", message: "Enter a valid price." }]);
    return true;
  });
  assert.equal(await checkedField("priceMinor", () => 29), 29);
  await assert.rejects(checkedField("priceMinor", () => { throw new Error("private implementation detail"); }), (error: unknown) => {
    assert.equal(describeFormError(error).message.includes("private implementation detail"), false);
    return true;
  });
});

test("generation validation explains order, window length, incomplete slots and total batch size", () => {
  const base = { courtIds: [randomUUID()], startsAt: "2030-01-02T09:00:00Z", endsAt: "2030-01-02T10:00:00Z", durationMinutes: 60, priceMinor: 50000 };
  assert.deepEqual(issues(generationSchema, { ...base, endsAt: base.startsAt }), [{ field: "endsAt", message: "End must be after Start." }]);
  assert.match(issues(generationSchema, { ...base, endsAt: "2030-01-04T10:00:00Z" })[0]!.message, /26 hours/);
  assert.match(issues(generationSchema, { ...base, durationMinutes: 120 })[0]!.message, /at least one complete slot/);
  assert.match(issues(generationSchema, { ...base, courtIds: Array.from({ length: 20 }, () => randomUUID()), endsAt: "2030-01-03T09:00:00Z", durationMinutes: 5 })[0]!.message, /500 slots across all courts/);
});

test("registration and timezone validation return approved messages and never reflect a password", () => {
  const password = "secret-short";
  const result = issues(registrationSchema, { name: "Customer", email: "invalid", password });
  assert.ok(result.some((issue) => issue.field === "email" && issue.message === "Enter a valid email address."));
  assert.ok(result.some((issue) => issue.field === "password" && issue.message.includes("15–128")));
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.match(issues(venueCreateSchema, { name: "Court", address: "Road", city: "Pune", timezone: "Invalid/Zone" })[0]!.message, /Asia\/Kolkata/);
  const malicious = z.string().refine(() => false, { message: password, params: { messageCode: "toString" } });
  assert.equal(issues(malicious, password)[0]!.message, "This field has an invalid value.");
});
