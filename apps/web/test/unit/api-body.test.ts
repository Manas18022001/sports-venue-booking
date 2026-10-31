import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { parseJsonBody } from "../../src/server/api/body.js";
import { ApiError } from "../../src/server/api/errors.js";
import { DEFAULT_API_LIMITS } from "../../src/server/api/options.js";
import { parseQuery, validate } from "../../src/server/api/validation.js";

function request(body: string, headers: HeadersInit = {}) {
  return new Request("https://turfit.test/api/test", {
    method: "POST", body, headers: { "content-type": "application/json", ...headers },
  });
}

function code(expected: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, expected);
    return true;
  };
}

test("JSON parsing returns validated data and accepts UTF-8 content types", async () => {
  const schema = z.object({ count: z.number().int().positive() }).strict();
  assert.deepEqual(await parseJsonBody(request('{"count":2}', { "content-type": "application/json; charset=UTF-8" }), schema), { count: 2 });
});

test("JSON parsing rejects unsupported types, encodings, and charsets", async () => {
  for (const headers of [
    { "content-type": "text/plain" },
    { "content-type": "application/json; charset=iso-8859-1" },
    { "content-encoding": "gzip" },
  ]) {
    await assert.rejects(parseJsonBody(request("{}", headers), z.object({})), code("UNSUPPORTED_MEDIA_TYPE"));
  }
});

test("malformed, empty, and invalid UTF-8 JSON bodies return safe bad requests", async () => {
  for (const body of ["", "{", "not-json"]) {
    await assert.rejects(parseJsonBody(request(body), z.unknown()), code("BAD_REQUEST"));
  }
  const invalidUtf8 = new Request("https://turfit.test/api/test", {
    method: "POST", body: new Uint8Array([0xff]), headers: { "content-type": "application/json" },
  });
  await assert.rejects(parseJsonBody(invalidUtf8, z.unknown()), code("BAD_REQUEST"));
});

test("body size is measured in bytes even when length is absent or understated", async () => {
  const limits = { ...DEFAULT_API_LIMITS, maxBodyBytes: 8 };
  for (const headers of [{}, { "content-length": "2" }]) {
    await assert.rejects(parseJsonBody(request('"éééé"', headers), z.string(), limits), code("PAYLOAD_TOO_LARGE"));
  }
});

test("oversized declared bodies are rejected before their stream is consumed", async () => {
  const input = request("{}", { "content-length": "999999" });
  await assert.rejects(parseJsonBody(input, z.object({})), code("PAYLOAD_TOO_LARGE"));
  assert.equal(input.bodyUsed, false);
  await input.body?.cancel();
});

test("invalid and mismatched Content-Length values are rejected", async () => {
  for (const length of ["-1", "invalid", "1"]) {
    await assert.rejects(parseJsonBody(request("{}", { "content-length": length }), z.object({})), code("BAD_REQUEST"));
  }
});

test("slow request streams time out and are cancelled", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const input = new Request("https://turfit.test/api/test", {
    method: "POST", body, headers: { "content-type": "application/json" }, duplex: "half",
  } as RequestInit);
  await assert.rejects(parseJsonBody(input, z.unknown(), { ...DEFAULT_API_LIMITS, bodyTimeoutMs: 20 }), code("REQUEST_TIMEOUT"));
  assert.equal(cancelled, true);
});

test("aborted and already consumed request bodies are rejected", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = new Request("https://turfit.test/api/test", {
    method: "POST", body: "{}", signal: controller.signal, headers: { "content-type": "application/json" },
  });
  await assert.rejects(parseJsonBody(aborted, z.object({})), code("BAD_REQUEST"));
  const consumed = request("{}");
  await consumed.text();
  await assert.rejects(parseJsonBody(consumed, z.object({})), code("BAD_REQUEST"));
});

test("validation errors expose field names but do not repeat sensitive input or custom messages", () => {
  const secret = "do-not-reflect-this-password";
  const schema = z.object({ password: z.string().refine(() => false, secret) }).strict();
  assert.throws(() => validate(schema, { password: secret }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.deepEqual(error.issues, [{ field: "password", message: "This field has an invalid value." }]);
    assert.ok(!JSON.stringify(error).includes(secret));
    return true;
  });
});

test("query validation supports typed conversions and rejects ambiguous duplicate parameters", () => {
  const schema = z.object({ page: z.coerce.number().int().positive() }).strict();
  assert.deepEqual(parseQuery(new Request("https://turfit.test/api/test?page=2"), schema), { page: 2 });
  assert.throws(() => parseQuery(new Request("https://turfit.test/api/test?page=1&page=2"), schema), code("BAD_REQUEST"));
  assert.throws(() => parseQuery(new Request("https://turfit.test/api/test?page=0"), schema), code("VALIDATION_ERROR"));
});
