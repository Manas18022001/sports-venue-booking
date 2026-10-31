import assert from "node:assert/strict";
import { test } from "node:test";
import { getServerConfig } from "../../src/server/config/index.js";
import { parseServerConfig as parseRawServerConfig, ServerConfigurationError } from "../../src/server/config/schema.js";
import { TEST_AUTH_SECRET } from "../fixtures/auth.js";

function parseServerConfig(source: Readonly<Record<string, string | undefined>>) {
  return parseRawServerConfig({ AUTH_SECRET: TEST_AUTH_SECRET, ...source });
}

const validDatabaseUrl = "postgresql://test_user:test_password@localhost:5432/turfit_test";

test("server configuration supplies pool defaults and ignores unrelated environment variables", () => {
  const result = parseServerConfig({ DATABASE_URL: validDatabaseUrl, UNRELATED_SETTING: "ignored" });
  assert.deepEqual(result, {
    environment: "development",
    api: {
      origin: "http://localhost:3000",
      limits: { maxBodyBytes: 65_536, maxUrlBytes: 8_192, bodyTimeoutMs: 10_000 },
    },
    logging: { level: "info" },
    auth: { secret: TEST_AUTH_SECRET, accessTtlSeconds: 900, sessionTtlSeconds: 604_800, refreshRetrySeconds: 5, clientIpHeader: "none" },
    database: {
      connectionString: validDatabaseUrl,
      pool: { maxConnections: 10, connectionTimeoutMs: 5_000, idleTimeoutMs: 30_000 },
    },
  });
});

test("explicit settings become typed numbers and preserve encoded PostgreSQL URLs", () => {
  const databaseUrl = "postgres://test_user:encoded%40password@[::1]:5432/turfit_test?schema=public";
  const result = parseServerConfig({
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: "4",
    DATABASE_CONNECTION_TIMEOUT_MS: "2500",
    DATABASE_IDLE_TIMEOUT_MS: "45000",
  });
  assert.equal(result.environment, "production");
  assert.equal(result.database.connectionString, databaseUrl);
  assert.deepEqual(result.database.pool, {
    maxConnections: 4, connectionTimeoutMs: 2_500, idleTimeoutMs: 45_000,
  });
});

test("database configuration rejects absent URLs, other protocols, missing database names, and fragments", () => {
  for (const value of [undefined, "", "not-a-url", "https://localhost/turfit", "postgresql://localhost", "postgresql:///turfit", "postgresql://localhost/turfit#fragment"]) {
    assert.throws(() => parseServerConfig({ DATABASE_URL: value }), (error: unknown) => {
      assert.ok(error instanceof ServerConfigurationError);
      assert.match(error.message, /DATABASE_URL/);
      return true;
    });
  }
});

test("configuration errors name all invalid fields without leaking connection credentials", () => {
  const secret = "this-test-secret-must-not-appear";
  const invalidDatabaseUrl = `mysql://test_user:${secret}@localhost/turfit_test`;
  assert.throws(() => parseServerConfig({
    DATABASE_URL: invalidDatabaseUrl, NODE_ENV: "staging", DATABASE_POOL_MAX: "many",
  }), (error: unknown) => {
    assert.ok(error instanceof ServerConfigurationError);
    assert.match(error.message, /DATABASE_URL/);
    assert.match(error.message, /NODE_ENV/);
    assert.match(error.message, /DATABASE_POOL_MAX/);
    assert.ok(!String(error).includes(secret));
    assert.ok(!JSON.stringify(error).includes(secret));
    assert.ok(!error.stack?.includes(secret));
    assert.ok(!String(error).includes(invalidDatabaseUrl));
    assert.equal(error.cause, undefined);
    return true;
  });
});

for (const [name, maximum] of [
  ["DATABASE_POOL_MAX", 100],
  ["DATABASE_CONNECTION_TIMEOUT_MS", 60_000],
  ["DATABASE_IDLE_TIMEOUT_MS", 600_000],
  ["API_MAX_BODY_BYTES", 1_048_576],
  ["API_MAX_URL_BYTES", 65_536],
  ["API_BODY_TIMEOUT_MS", 60_000],
] as const) {
  test(`${name} accepts its boundaries and rejects invalid numeric input`, () => {
    for (const value of ["1", String(maximum)]) {
      assert.doesNotThrow(() => parseServerConfig({ DATABASE_URL: validDatabaseUrl, [name]: value }));
    }
    for (const value of ["", " ", "0", "-1", "1.5", "1e2", "0x10", "Infinity", "12ms", String(maximum + 1)]) {
      assert.throws(() => parseServerConfig({ DATABASE_URL: validDatabaseUrl, [name]: value }), ServerConfigurationError);
    }
  });
}

test("parsed configuration is immutable at every nested level", () => {
  const source = { DATABASE_URL: validDatabaseUrl, DATABASE_POOL_MAX: "2" };
  const result = parseServerConfig(source);
  source.DATABASE_POOL_MAX = "3";
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.database));
  assert.ok(Object.isFrozen(result.database.pool));
  assert.ok(Object.isFrozen(result.api));
  assert.ok(Object.isFrozen(result.api.limits));
  assert.ok(Object.isFrozen(result.logging));
  assert.equal(Reflect.set(result.database.pool, "maxConnections", 99), false);
  assert.equal(result.database.pool.maxConnections, 2);
});

test("application origin must be a trusted origin and use HTTPS for remote production hosts", () => {
  for (const APP_ORIGIN of ["https://turfit.example", "https://turfit.example/", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.doesNotThrow(() => parseServerConfig({ NODE_ENV: "production", DATABASE_URL: validDatabaseUrl, APP_ORIGIN }));
  }
  for (const APP_ORIGIN of ["", "http://turfit.example", "https://user:secret@turfit.example", "https://turfit.example/path", "https://turfit.example?query=value", "https://turfit.example#fragment"]) {
    assert.throws(() => parseServerConfig({ NODE_ENV: "production", DATABASE_URL: validDatabaseUrl, APP_ORIGIN }), ServerConfigurationError);
  }
  assert.equal(parseServerConfig({ DATABASE_URL: validDatabaseUrl, APP_ORIGIN: "https://turfit.example/" }).api.origin, "https://turfit.example");
  assert.throws(() => parseServerConfig({ DATABASE_URL: validDatabaseUrl, LOG_LEVEL: "invalid" }), ServerConfigurationError);
});

test("server access retains one validated configuration snapshot for its instance", () => {
  const keys = ["NODE_ENV", "DATABASE_URL", "DATABASE_POOL_MAX", "DATABASE_CONNECTION_TIMEOUT_MS", "DATABASE_IDLE_TIMEOUT_MS", "AUTH_SECRET"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      NODE_ENV: "test", DATABASE_URL: validDatabaseUrl, DATABASE_POOL_MAX: "2", AUTH_SECRET: TEST_AUTH_SECRET,
    });
    delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
    delete process.env.DATABASE_IDLE_TIMEOUT_MS;
    const first = getServerConfig();
    process.env.DATABASE_POOL_MAX = "3";
    assert.strictEqual(getServerConfig(), first);
    assert.equal(first.database.pool.maxConnections, 2);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else Reflect.set(process.env, key, value);
    }
  }
});
