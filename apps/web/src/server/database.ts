import "server-only";
import { createDatabaseClient } from "../database/client";
import type { DatabaseClient } from "../database/client";

const processDatabase = globalThis as typeof globalThis & {
  turfitDatabase?: DatabaseClient;
};

// One client/pool per process, including development hot reloads. Creation is
// lazy: importing this module does not connect to PostgreSQL or query it.
export function getDatabase(): DatabaseClient {
  if (processDatabase.turfitDatabase) return processDatabase.turfitDatabase;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for database access.");

  processDatabase.turfitDatabase = createDatabaseClient(connectionString);
  return processDatabase.turfitDatabase;
}
