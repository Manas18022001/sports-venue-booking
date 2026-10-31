import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "../../src/instrumentation.js";
import { ServerConfigurationError } from "../../src/server/config/schema.js";

async function withEnvironment(
  values: Readonly<Record<string, string>>,
  action: () => Promise<void>,
) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    await action();
  } finally {
    for (const key of Object.keys(values)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("instrumentation leaves non-Node runtimes outside the PostgreSQL startup check", async () => {
  await withEnvironment({ NEXT_RUNTIME: "edge", DATABASE_URL: "invalid" }, async () => {
    await assert.doesNotReject(register());
  });
});

test("Node server registration rejects invalid settings before database access", async () => {
  await withEnvironment({ NEXT_RUNTIME: "nodejs", DATABASE_URL: "invalid" }, async () => {
    await assert.rejects(register(), ServerConfigurationError);
  });
});
