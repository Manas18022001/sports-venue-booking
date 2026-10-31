import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { createDatabaseClient } from "../database/client";
import type { DatabaseClient } from "../database/client";
import { getServerConfig } from "./config";

const processDatabase = globalThis as typeof globalThis & {
  turfitDatabase?: DatabaseClient;
};

// One client/pool per process, including development hot reloads. Creation is
// lazy: importing this module does not connect to PostgreSQL or query it.
export function getDatabase(): DatabaseClient {
  const { database } = getServerConfig();
  if (processDatabase.turfitDatabase) return processDatabase.turfitDatabase;

  processDatabase.turfitDatabase = createDatabaseClient(database.connectionString, database.pool,
    process.env.VERCEL === "1" ? attachDatabasePool : undefined);
  return processDatabase.turfitDatabase;
}
