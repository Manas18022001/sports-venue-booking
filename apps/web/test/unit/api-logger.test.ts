import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { createApiLogger } from "../../src/server/api/logger.js";

test("structured API logs use an allowlist and severity appropriate to the response", () => {
  let output = "";
  const sink = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
  const logger = createApiLogger("info", sink);
  const secret = "never-log-this-password";
  const entry = {
    requestId: "request-1", operation: "health.liveness", method: "GET", status: 200, durationMs: 2,
    password: secret, headers: { authorization: secret }, body: { password: secret }, query: secret,
  };
  logger.write(entry);
  logger.write({ ...entry, status: 403, errorCode: "FORBIDDEN" });
  logger.write({ ...entry, status: 500, errorCode: "INTERNAL_ERROR" });
  assert.ok(!output.includes(secret));
  const lines = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.level), [30, 40, 50]);
  assert.equal(lines[0].service, "turfit");
  assert.equal(lines[0].msg, "api.request.completed");
  assert.equal(lines[0].headers, undefined);
  assert.equal(lines[0].body, undefined);
});
