import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ApiError } from "../../src/server/api/errors.js";
import { withApiHandler } from "../../src/server/api/handler.js";
import type { ApiLogEntry, ApiLogger } from "../../src/server/api/logger.js";
import { DEFAULT_API_LIMITS } from "../../src/server/api/options.js";
import { getSecurityHeaders } from "../../security-headers.mjs";

const config = {
  environment: "test" as const,
  api: { origin: "https://turfit.test", limits: DEFAULT_API_LIMITS },
};
const entries: ApiLogEntry[] = [];
const logger: ApiLogger = { write(entry) { entries.push(entry); } };
const dependencies = { config, logger };

test("success responses correlate body, headers, and safe request logs", async () => {
  const secret = "do-not-log-the-query-or-header";
  const handler = withApiHandler({ operation: "test.success", methods: ["GET"] },
    (_request, context) => context.success({ ok: true }), dependencies);
  const response = await handler(new Request(`https://turfit.test/api/test?token=${secret}`, { headers: { "x-request-id": secret, authorization: `Bearer ${secret}` } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, { ok: true });
  assert.match(body.meta.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get("x-request-id"), body.meta.requestId);
  assert.equal(entries.at(-1)?.requestId, body.meta.requestId);
  assert.equal(entries.at(-1)?.operation, "test.success");
  assert.ok(!JSON.stringify(entries).includes(secret));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("unexpected exceptions return generic errors and do not expose internal diagnostics", async () => {
  const secret = "database-password-and-query";
  const handler = withApiHandler({ operation: "test.failure", methods: ["GET"] },
    () => { throw new Error(secret); }, dependencies);
  const response = await handler(new Request("https://turfit.test/api/test"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(body).includes(secret));
  assert.ok(!JSON.stringify(entries).includes(secret));
  assert.equal(entries.at(-1)?.errorCode, "INTERNAL_ERROR");
});

test("known errors preserve their public status, issue details, and retry guidance", async () => {
  const handler = withApiHandler({ operation: "test.limited", methods: ["GET"] },
    () => { throw new ApiError("RATE_LIMITED", { retryAfterSeconds: 30 }); }, dependencies);
  const response = await handler(new Request("https://turfit.test/api/test"));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal((await response.json()).error.code, "RATE_LIMITED");
});

test("unsupported methods and automatic OPTIONS provide an explicit Allow header", async () => {
  const handler = withApiHandler({ operation: "test.methods", methods: ["GET", "HEAD"] },
    (_request, context) => context.success({ ok: true }), dependencies);
  const denied = await handler(new Request("https://turfit.test/api/test", { method: "POST" }));
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get("allow"), "GET, HEAD, OPTIONS");
  assert.equal((await denied.json()).error.code, "METHOD_NOT_ALLOWED");
  const options = await handler(new Request("https://turfit.test/api/test", { method: "OPTIONS" }));
  assert.equal(options.status, 204);
  assert.equal(await options.text(), "");
  assert.equal(options.headers.get("access-control-allow-origin"), null);
  const head = await handler(new Request("https://turfit.test/api/test", { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.ok(head.headers.get("x-request-id"));
});

test("write requests require the configured origin and reject cross-site fetch metadata", async () => {
  const handler = withApiHandler({ operation: "test.write", methods: ["POST"] },
    (_request, context) => context.success({ ok: true }), dependencies);
  for (const headers of [{}, { origin: "https://evil.test" }, { origin: "null" }, { origin: "https://turfit.test", "sec-fetch-site": "cross-site" }]) {
    const response = await handler(new Request("https://attacker-controlled-host.test/api/test", { method: "POST", headers }));
    assert.equal(response.status, 403);
  }
  const allowed = await handler(new Request("https://turfit.test/api/test", { method: "POST", headers: { origin: "https://turfit.test" } }));
  assert.equal(allowed.status, 200);
});

test("oversized request URLs and declared bodies are rejected before execution", async () => {
  let executed = false;
  const handler = withApiHandler({ operation: "test.limits", methods: ["GET"] }, () => {
    executed = true; return Response.json({});
  }, { ...dependencies, config: { ...config, api: { ...config.api, limits: { ...DEFAULT_API_LIMITS, maxUrlBytes: 60, maxBodyBytes: 8 } } } });
  assert.equal((await handler(new Request(`https://turfit.test/api/test?q=${"x".repeat(100)}`))).status, 414);
  assert.equal((await handler(new Request("https://turfit.test/api/test", { headers: { "content-length": "9" } }))).status, 413);
  assert.equal(executed, false);
});

test("request JSON validation participates in the common error envelope", async () => {
  const handler = withApiHandler({ operation: "test.json", methods: ["POST"] }, async (_request, context) => {
    const body = await context.readJson(z.object({ count: z.number().positive() }).strict());
    return context.success(body, { status: 201 });
  }, dependencies);
  const input = (body: string) => new Request("https://turfit.test/api/test", {
    method: "POST", body, headers: { origin: "https://turfit.test", "content-type": "application/json" },
  });
  const valid = await handler(input('{"count":2}'));
  assert.equal(valid.status, 201);
  const invalid = await handler(input('{"count":-1}'));
  assert.equal(invalid.status, 422);
  const error = await invalid.json();
  assert.equal(error.error.issues[0].field, "count");
  assert.equal(error.meta.requestId, invalid.headers.get("x-request-id"));
});

test("logging failures do not alter an already successful operation", async () => {
  const handler = withApiHandler({ operation: "test.log_failure", methods: ["GET"] },
    (_request, context) => context.success({ ok: true }),
    { config, logger: { write() { throw new Error("sink unavailable"); } } });
  assert.equal((await handler(new Request("https://turfit.test/api/test"))).status, 200);
});

test("security headers avoid development HSTS and enable it in production", () => {
  assert.equal(getSecurityHeaders().some((header) => header.key === "Strict-Transport-Security"), false);
  assert.equal(getSecurityHeaders(true).some((header) => header.key === "Strict-Transport-Security"), true);
});
