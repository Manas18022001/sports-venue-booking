import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";

const appDirectory = resolve(import.meta.dirname, "../..");

test("production preflight accepts valid configuration without connecting to PostgreSQL", () => {
  const result = spawnSync(process.execPath, ["scripts/check-config.ts", "production"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      AUTH_SECRET: TEST_AUTH_SECRET,
      DATABASE_URL: "postgresql://test_user:test_only@127.0.0.1:1/turfit_test",
      DATABASE_POOL_MAX: "2",
      DATABASE_CONNECTION_TIMEOUT_MS: "1000",
      DATABASE_IDLE_TIMEOUT_MS: "1000",
    },
    encoding: "utf8", timeout: 5_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("production preflight exits nonzero and redacts invalid credentials", () => {
  const secret = "test-only-secret-for-redaction";
  const result = spawnSync(process.execPath, ["scripts/check-config.ts", "production"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      AUTH_SECRET: TEST_AUTH_SECRET,
      DATABASE_URL: `mysql://test_user:${secret}@127.0.0.1/turfit_test`,
      DATABASE_POOL_MAX: "invalid",
    },
    encoding: "utf8", timeout: 5_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid server configuration/);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.match(result.stderr, /DATABASE_POOL_MAX/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
