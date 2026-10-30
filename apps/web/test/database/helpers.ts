import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { config } from "dotenv";
import pg from "pg";

config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.");
if (!decodeURIComponent(new URL(connectionString).pathname).toLowerCase().includes("test")) {
  throw new Error("TEST_DATABASE_URL must name a dedicated database containing 'test'.");
}

export const testDatabaseUrl = connectionString;

export const schema = `turfit_test_${randomUUID().replaceAll("-", "")}`;
const schemaIdentifier = `"${schema}"`;
export let db: pg.Client;

export async function connect() {
  const client = new pg.Client({
    connectionString,
    application_name: schema,
    options: `-c search_path=${schema},public -c statement_timeout=10000 -c lock_timeout=5000 -c timezone=UTC`,
  });
  await client.connect();
  return client;
}

export async function setup() {
  db = await connect();
  await db.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public");
  await db.query(`CREATE SCHEMA ${schemaIdentifier}`);
  const migrations = resolve(import.meta.dirname, "../../prisma/migrations");
  const entries = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  for (const entry of entries) {
    const sql = await readFile(resolve(migrations, entry, "migration.sql"), "utf8");
    try {
      // Each migration owns its transaction, matching production deployment.
      await db.query(sql);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
}

export async function teardown() {
  if (!db) return;
  try {
    // The schema name is generated above, never read from a connection URL.
    assert.match(schema, /^turfit_test_[a-f0-9]{32}$/);
    await db.query(`DROP SCHEMA IF EXISTS ${schemaIdentifier} CASCADE`);
  } finally {
    await db.end();
  }
}

export interface Fixture {
  userId: string;
  adminId: string;
  venueId: string;
  courtId: string;
  startsAt: Date;
}

export async function fixture(): Promise<Fixture> {
  const userId = randomUUID();
  const adminId = randomUUID();
  const venueId = randomUUID();
  const courtId = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, name, password_hash, role) VALUES
      ($1, $2, 'Test Customer', '$argon2id$test-only-placeholder', 'CUSTOMER'),
      ($3, $4, 'Test Admin', '$argon2id$test-only-placeholder', 'ADMIN')`,
    [userId, `${userId}@example.test`, adminId, `${adminId}@example.test`],
  );
  await db.query(
    "INSERT INTO venues (id, name, address, city) VALUES ($1, 'Test Venue', '1 Test Road', 'Pune')",
    [venueId],
  );
  await db.query(
    "INSERT INTO courts (id, venue_id, name, sport) VALUES ($1, $2, 'Court 1', 'Badminton')",
    [courtId, venueId],
  );
  const startsAt = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 172_800_000);
  return { userId, adminId, venueId, courtId, startsAt };
}

export async function slot(f: Fixture, offsetHours = 0, durationMinutes = 60, priceMinor = 50_000) {
  const id = randomUUID();
  const start = new Date(f.startsAt.getTime() + offsetHours * 3_600_000);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  await db.query(
    `INSERT INTO slots (id, venue_id, court_id, starts_at, ends_at, price_minor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, f.venueId, f.courtId, start, end, priceMinor],
  );
  return id;
}

export async function booking(client: pg.Client, f: Fixture) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO bookings (id, reference, user_id, venue_id, customer_name, customer_email)
     SELECT $1, $2, id, $3, name, email FROM users WHERE id = $4`,
    [id, `TF-${id}`, f.venueId, f.userId],
  );
  return id;
}

export async function reserve(client: pg.Client, bookingId: string, slotId: string) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO booking_items
       (booking_id, slot_id, venue_id, court_name, sport, starts_at, ends_at, price_minor)
     SELECT $1, s.id, s.venue_id, c.name, c.sport, s.starts_at, s.ends_at, s.price_minor
     FROM slots s JOIN courts c ON c.id = s.court_id WHERE s.id = $2
     RETURNING id`,
    [bookingId, slotId],
  );
  const row = result.rows[0];
  assert.ok(row);
  return row.id;
}

export async function cancel(itemId: string, adminId: string) {
  await db.query(
    `UPDATE booking_items SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
       cancelled_by_id = $2, cancellation_source = 'ADMIN', cancellation_reason = 'Maintenance'
     WHERE id = $1`,
    [itemId, adminId],
  );
}

export function sqlState(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal(error.code, code);
    return true;
  };
}

// Observe an actual database lock instead of guessing with an arbitrary sleep.
export async function waitForLock(pid: number) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await db.query<{ wait_event_type: string | null }>(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await setTimeout(20);
  }
  assert.fail("Competing PostgreSQL transaction did not enter a lock wait");
}

export async function backendPid(client: pg.Client) {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const row = result.rows[0];
  assert.ok(row);
  return row.pid;
}

// Attach rejection handling immediately: a losing concurrent insert is expected.
export function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
