import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";
import { parseServerConfig, ServerConfigurationError } from "../../src/server/config/schema.js";
import { csrfToken, refreshCredential, hashCredential, issueAccessToken, verifyAccessToken, verifyCsrf } from "../../src/server/auth/crypto.js";
import { hashPassword, verifyPassword } from "../../src/server/auth/passwords.js";
import { cookiePolicy, credentialHeaders, clearCredentialHeaders, readCookie } from "../../src/server/auth/cookies.js";
import { registrationSchema } from "../../src/server/auth/schemas.js";
import { clientNetwork } from "../../src/server/auth/rate-limit.js";
import { ApiError } from "../../src/server/api/errors.js";

const config = parseServerConfig({ AUTH_SECRET: TEST_AUTH_SECRET, DATABASE_URL: "postgresql://localhost/turfit_test", APP_ORIGIN: "https://turfit.test" });

test("passwords use salted Argon2id and reject incorrect or missing-user credentials", async () => {
  const password = "A sufficiently long passphrase!";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong", first), false);
  assert.equal(await verifyPassword(password, undefined), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});

test("registration normalizes identity, preserves passwords, and rejects role injection or weak lengths", () => {
  const password = "  a long secret phrase  ";
  const data = registrationSchema.parse({ name: " Test ", email: " TEST@EXAMPLE.TEST ", password });
  assert.equal(data.name, "Test"); assert.equal(data.email, "test@example.test"); assert.equal(data.password, password);
  for (const input of [{ ...data, role: "ADMIN" }, { ...data, password: "short" }, { ...data, password: "a".repeat(129) }, { ...data, password: "123456789012345" }]) {
    assert.equal(registrationSchema.safeParse(input).success, false);
  }
});

test("access JWTs verify signatures, identity, lifetime and expiry", async () => {
  const userId = randomUUID(); const sessionId = randomUUID(); const now = new Date();
  const issued = await issueAccessToken(config.auth, userId, sessionId, new Date(now.getTime() + 86_400_000), now);
  const claims = await verifyAccessToken(config.auth, issued.token, now);
  assert.equal(claims.sub, userId); assert.equal(claims.sid, sessionId);
  assert.equal(claims.exp - claims.iat, 900);
  await assert.rejects(verifyAccessToken(config.auth, `${issued.token.slice(0, -5)}wrong`, now), ApiError);
  await assert.rejects(verifyAccessToken({ ...config.auth, secret: "fedcba9876543210".repeat(4) }, issued.token, now), ApiError);
  await assert.rejects(verifyAccessToken(config.auth, issued.token, new Date(now.getTime() + 901_000)), ApiError);
});

test("access expiry is capped by the absolute session lifetime", async () => {
  const now = new Date(); const expiry = new Date(now.getTime() + 30_000);
  const issued = await issueAccessToken(config.auth, randomUUID(), randomUUID(), expiry, now);
  assert.ok(issued.expiresAt <= expiry);
});

test("refresh recovery is deterministic per credential and CSRF tokens bind to the session", () => {
  const sessionId = randomUUID(); const tokenId = randomUUID();
  const token = refreshCredential(config.auth, sessionId, tokenId);
  assert.equal(refreshCredential(config.auth, sessionId, tokenId), token);
  assert.notEqual(refreshCredential(config.auth, sessionId, randomUUID()), token);
  assert.match(hashCredential(token), /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => verifyCsrf(config.auth, sessionId, csrfToken(config.auth, sessionId)));
  assert.throws(() => verifyCsrf(config.auth, sessionId, csrfToken(config.auth, randomUUID())), ApiError);
  assert.throws(() => verifyCsrf(config.auth, sessionId, null), ApiError);
});

test("HTTPS cookies are host-only, secure, HttpOnly and cleared with matching attributes", () => {
  const policy = cookiePolicy(config);
  const headers = credentialHeaders(config, {
    accessToken: "access", refreshToken: "refresh", accessExpiresAt: new Date(Date.now() + 900_000), sessionExpiresAt: new Date(Date.now() + 86_400_000),
  });
  const values = headers.getSetCookie();
  assert.equal(values.length, 2);
  for (const value of values) {
    assert.match(value, /^__Host-turfit_/); assert.match(value, /; Secure/); assert.match(value, /HttpOnly/); assert.match(value, /SameSite=Lax/); assert.doesNotMatch(value, /Domain=/);
  }
  assert.equal(clearCredentialHeaders(config).getSetCookie().length, 2);
  assert.ok(clearCredentialHeaders(config).getSetCookie().every((value) => value.includes("Max-Age=0")));
  assert.equal(readCookie(new Request("https://turfit.test", { headers: { cookie: `${policy.access}=abc.def.ghi` } }), policy.access), "abc.def.ghi");
  assert.throws(() => readCookie(new Request("https://turfit.test", { headers: { cookie: `${policy.access}=one; ${policy.access}=two` } }), policy.access), ApiError);
});

test("client network identifiers ignore spoofed headers by default and reject multi-hop values", () => {
  const input = new Request("https://turfit.test", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } });
  assert.equal(clientNetwork(input, config), "unidentified");
  const trusted = { ...config, auth: { ...config.auth, clientIpHeader: "x-real-ip" as const } };
  assert.equal(clientNetwork(input, trusted), "5.6.7.8");
  assert.equal(clientNetwork(new Request("https://turfit.test", { headers: { "x-real-ip": "1.2.3.4,5.6.7.8" } }), trusted), "unidentified");
});

test("auth configuration rejects absent or placeholder signing keys and inconsistent lifetimes", () => {
  for (const AUTH_SECRET of [undefined, "password", "a".repeat(64)]) {
    assert.throws(() => parseServerConfig({ DATABASE_URL: "postgresql://localhost/test", AUTH_SECRET }), ServerConfigurationError);
  }
  assert.throws(() => parseServerConfig({ DATABASE_URL: "postgresql://localhost/test", AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: "900", AUTH_SESSION_TTL_SECONDS: "900" }), ServerConfigurationError);
});
