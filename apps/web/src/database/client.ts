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
  const adapter = new PrismaPg({
    connectionString,
    max: pool.maxConnections,
    connectionTimeoutMillis: pool.connectionTimeoutMs,
    idleTimeoutMillis: pool.idleTimeoutMs,
  });

  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type TransactionClient = Prisma.TransactionClient;
