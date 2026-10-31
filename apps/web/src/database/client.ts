import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
import { DEFAULT_DATABASE_POOL_OPTIONS } from "./pool-options";
import type { DatabasePoolOptions } from "./pool-options";

// The application owns connection lifetime. Importing this module opens no pool.
export function createDatabaseClient(
  connectionString: string,
  pool: DatabasePoolOptions = DEFAULT_DATABASE_POOL_OPTIONS,
) {
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema name.");
  const adapter = new PrismaPg({
    connectionString,
    // Prisma's PostgreSQL adapter expects timestamp values in UTC, including
    // when the database host's default timezone differs from the application.
    options: `-c search_path=${schema},public -c timezone=UTC`,
    max: pool.maxConnections,
    connectionTimeoutMillis: pool.connectionTimeoutMs,
    idleTimeoutMillis: pool.idleTimeoutMs,
  }, { schema });

  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type TransactionClient = Prisma.TransactionClient;
