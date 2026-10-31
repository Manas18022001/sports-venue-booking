import assert from "node:assert/strict";
import { test } from "node:test";
import { databasePoolConfig } from "../../src/database/client";

test("direct connections preserve isolated schemas, explicit UTC and pool bounds", () => {
  const result = databasePoolConfig("postgresql://user:password@localhost/turfit?schema=turfit_test_example", { maxConnections: 4, connectionTimeoutMs: 6000, idleTimeoutMs: 5000 });
  assert.equal(result.schema, "turfit_test_example");
  assert.equal(result.config.options, "-c search_path=turfit_test_example,public -c timezone=UTC");
  assert.equal(result.config.max, 4);
  assert.equal(result.config.connectionTimeoutMillis, 6000);
});

test("Neon pooler connections omit unsupported startup options and enable requested channel binding", () => {
  const url = "postgresql://user:password@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require";
  const result = databasePoolConfig(url);
  assert.equal(result.schema, "public");
  assert.equal(result.config.options, undefined);
  assert.equal(result.config.enableChannelBinding, true);
  assert.equal(result.config.connectionString, url);
  assert.throws(() => databasePoolConfig(`${url}&schema=another_schema`), /direct connection/);
  assert.equal(databasePoolConfig(url.replace("-pooler.", ".")).config.options, "-c search_path=public,public -c timezone=UTC");
});
