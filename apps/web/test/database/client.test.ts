import assert from "node:assert/strict";
import { test } from "node:test";
import { testDatabaseUrl } from "./helpers.js";

test("Next.js server database access reuses one client and can query PostgreSQL", async () => {
  // This test runs in its own Node test worker, separate from the application.
  process.env.DATABASE_URL = testDatabaseUrl;
  const { getDatabase } = await import("../../src/server/database.js");
  const first = getDatabase();
  const second = getDatabase();

  try {
    assert.strictEqual(first, second);
    const result = await first.$queryRaw<Array<{ connected: number }>>`SELECT 1::int AS connected`;
    assert.deepEqual(result, [{ connected: 1 }]);
  } finally {
    await first.$disconnect();
  }
});
