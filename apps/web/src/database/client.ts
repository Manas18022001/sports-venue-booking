import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";

// The application owns connection lifetime. Importing this module opens no pool.
export function createDatabaseClient(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type TransactionClient = Prisma.TransactionClient;
