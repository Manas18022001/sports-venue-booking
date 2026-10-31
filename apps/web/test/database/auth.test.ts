import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabaseClient } from "../../src/database/client.js";
import type { DatabaseClient } from "../../src/database/client.js";
import { parseServerConfig } from "../../src/server/config/schema.js";
import { createAuthService, assertOwner } from "../../src/server/auth/service.js";
import { cookiePolicy } from "../../src/server/auth/cookies.js";
import { hashCredential } from "../../src/server/auth/crypto.js";
import { consumeRateLimit } from "../../src/server/auth/rate-limit.js";
import { ApiError } from "../../src/server/api/errors.js";
import { decodeJwt } from "jose";
import { setup, teardown, schema, testDatabaseUrl, db } from "./helpers.js";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";

const url = new URL(testDatabaseUrl); url.searchParams.set("schema", schema);
const config = parseServerConfig({ DATABASE_URL: url.toString(), AUTH_SECRET: TEST_AUTH_SECRET, NODE_ENV: "test" });
let client: DatabaseClient;
let service: ReturnType<typeof createAuthService>;
const password = "A long and memorable test phrase!";

before(async () => { await setup(); client = createDatabaseClient(url.toString()); service = createAuthService(client, config); });
after(async () => { if (client) await client.$disconnect(); await teardown(); });

function credentials() { return { name: "Test Customer", email: `${randomUUID()}@example.test`, password }; }
function request(result: Awaited<ReturnType<typeof service.register>>, method = "GET", csrf = result.csrfToken) {
  const names = cookiePolicy(config);
  return new Request("http://localhost:3000/api/test", {
    method, headers: { cookie: `${names.access}=${result.credentials.accessToken}; ${names.refresh}=${result.credentials.refreshToken}`, "x-csrf-token": csrf },
  });
}
function code(expected: string) { return (error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.code, expected); return true; }; }

test("registration creates a customer and atomically persists only hashes and session state", async () => {
  const input = credentials(); const result = await service.register(input);
  assert.equal(result.principal.user.role, "CUSTOMER");
  assert.equal("passwordHash" in result.principal.user, false);
  const user = await client.user.findUniqueOrThrow({ where: { id: result.principal.user.id } });
  assert.match(user.passwordHash, /^\$argon2id\$/);
  const token = await client.refreshToken.findFirstOrThrow({ where: { sessionId: result.principal.sessionId } });
  assert.equal(token.tokenHash, hashCredential(result.credentials.refreshToken));
  assert.notEqual(token.tokenHash, result.credentials.refreshToken);
  const claims = decodeJwt(result.credentials.accessToken);
  assert.ok(Math.abs(Date.now() / 1000 - Number(claims.iat)) < 2,
    `JWT issuance must agree with the application clock: ${claims.iat} vs ${Date.now() / 1000}`);
  assert.equal((await service.authenticate(request(result))).user.id, user.id);
});

test("registration rejects role injection and concurrent duplicate accounts leave one account", async () => {
  const input = credentials();
  await assert.rejects(service.register({ ...input, role: "ADMIN" }), code("VALIDATION_ERROR"));
  const results = await Promise.allSettled([service.register(input), service.register(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected");
  assert.ok(failed?.status === "rejected"); code("CONFLICT")(failed.reason);
  assert.equal(await client.user.count({ where: { email: input.email } }), 1);
});

test("login normalizes email and returns identical credential errors for unknown, wrong, or inactive users", async () => {
  const input = credentials(); const registered = await service.register(input);
  const loggedIn = await service.login({ email: input.email.toUpperCase(), password });
  assert.equal(loggedIn.principal.user.id, registered.principal.user.id);
  await assert.rejects(service.login({ email: input.email, password: "wrong" }), code("INVALID_CREDENTIALS"));
  await assert.rejects(service.login({ email: `${randomUUID()}@example.test`, password }), code("INVALID_CREDENTIALS"));
  await client.user.update({ where: { id: registered.principal.user.id }, data: { isActive: false } });
  await assert.rejects(service.login({ email: input.email, password }), code("INVALID_CREDENTIALS"));
  await assert.rejects(service.authenticate(request(registered)), code("UNAUTHORIZED"));
});

test("authorization uses current database roles and enforces ownership and CSRF on writes", async () => {
  const result = await service.register(credentials());
  await assert.rejects(service.requireAdmin(request(result)), code("FORBIDDEN"));
  await assert.rejects(service.authenticate(request(result, "POST", "wrong")), code("FORBIDDEN"));
  const principal = await service.authenticate(request(result));
  assert.throws(() => assertOwner(principal, randomUUID()), code("FORBIDDEN"));
  await client.user.update({ where: { id: principal.user.id }, data: { role: "ADMIN" } });
  const admin = await service.requireAdmin(request(result));
  assert.equal(admin.user.role, "ADMIN");
  assert.doesNotThrow(() => assertOwner(admin, randomUUID(), true));
});

test("concurrent refresh attempts recover one successor without revoking the valid session", async () => {
  const first = await service.register(credentials());
  const results = await Promise.all([service.refresh(request(first, "POST")), service.refresh(request(first, "POST"))]);
  assert.notEqual(results[0]!.credentials.refreshToken, first.credentials.refreshToken);
  assert.equal(results[0]!.credentials.refreshToken, results[1]!.credentials.refreshToken);
  assert.equal(results[0]!.principal.sessionExpiresAt.getTime(), first.principal.sessionExpiresAt.getTime());
  assert.equal(await client.refreshToken.count({ where: { sessionId: first.principal.sessionId, consumedAt: null } }), 1);
  assert.equal((await client.authSession.findUniqueOrThrow({ where: { id: first.principal.sessionId } })).revokedAt, null);
  assert.equal(await service.getCsrf(request(first)), first.csrfToken);
});

test("refresh replay beyond the recovery window commits session revocation and denies old access tokens", async () => {
  const first = await service.register(credentials());
  await service.refresh(request(first, "POST"));
  // Simulate passage of the retry window without slowing the test suite.
  await db.query("UPDATE refresh_tokens SET created_at = created_at - interval '1 minute', consumed_at = consumed_at - interval '20 seconds' WHERE token_hash = $1", [hashCredential(first.credentials.refreshToken)]);
  await assert.rejects(service.refresh(request(first, "POST")), code("UNAUTHORIZED"));
  assert.ok((await client.authSession.findUniqueOrThrow({ where: { id: first.principal.sessionId } })).revokedAt);
  await assert.rejects(service.authenticate(request(first)), code("UNAUTHORIZED"));
});

test("refresh requires the session CSRF token and expired sessions cannot authenticate", async () => {
  const first = await service.register(credentials());
  await assert.rejects(service.refresh(request(first, "POST", "wrong")), code("FORBIDDEN"));
  assert.equal(await client.refreshToken.count({ where: { sessionId: first.principal.sessionId, consumedAt: { not: null } } }), 0);
  await db.query("UPDATE auth_sessions SET created_at = created_at - interval '1 day', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [first.principal.sessionId]);
  await assert.rejects(service.authenticate(request(first)), code("UNAUTHORIZED"));
  await assert.rejects(service.refresh(request(first, "POST")), code("UNAUTHORIZED"));
});

test("logout revokes immediately, accepts retries, and denies logout without CSRF", async () => {
  const result = await service.register(credentials());
  await assert.rejects(service.logout(request(result, "POST", "wrong")), code("FORBIDDEN"));
  await service.logout(request(result, "POST"));
  await service.logout(request(result, "POST"));
  await assert.rejects(service.authenticate(request(result)), code("UNAUTHORIZED"));
  await assert.rejects(service.refresh(request(result, "POST")), code("UNAUTHORIZED"));
});

test("rate counters are atomic and shared across database clients", async () => {
  const other = createDatabaseClient(url.toString()); const scope = `test:${randomUUID()}`;
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => consumeRateLimit(index % 2 ? other : client, config, scope, 3, 60)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    for (const result of results) if (result.status === "rejected") code("RATE_LIMITED")(result.reason);
    await db.query("UPDATE rate_limit_buckets SET expires_at = clock_timestamp() - interval '1 second'");
    await assert.doesNotReject(consumeRateLimit(client, config, scope, 3, 60));
  } finally { await other.$disconnect(); }
});
