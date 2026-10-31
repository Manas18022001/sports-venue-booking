import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/client";
import type { Prisma } from "../generated/prisma/client";
import { DEFAULT_DATABASE_POOL_OPTIONS } from "./pool-options";
import type { DatabasePoolOptions } from "./pool-options";

// The application owns connection lifetime. Importing this module opens no pool.
export function databasePoolConfig(
  connectionString: string,
  pool: DatabasePoolOptions = DEFAULT_DATABASE_POOL_OPTIONS,
) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema name.");
  const neonPooler = url.hostname.endsWith(".neon.tech") && url.hostname.includes("-pooler.");
  if (neonPooler && schema !== "public") throw new Error("Neon pooled connections require the public schema; use a direct connection for isolated schemas.");
  return { schema, config: {
    connectionString,
    // Neon transaction pooling rejects search_path in startup options. Configure
    // UTC and public search_path on the database role before deployment instead.
    // Direct/local connections retain isolated schemas and explicit UTC.
    ...(!neonPooler ? { options: `-c search_path=${schema},public -c timezone=UTC` } : {}),
    ...(url.searchParams.get("channel_binding") === "require" ? { enableChannelBinding: true } : {}),
    max: pool.maxConnections,
    connectionTimeoutMillis: pool.connectionTimeoutMs,
    idleTimeoutMillis: pool.idleTimeoutMs,
  } };
}

export function createDatabaseClient(
  connectionString: string,
  pool: DatabasePoolOptions = DEFAULT_DATABASE_POOL_OPTIONS,
  registerPool?: (pool: pg.Pool) => void,
) {
  const { schema, config } = databasePoolConfig(connectionString, pool);
  const driverPool = new pg.Pool(config);
  registerPool?.(driverPool);
  const adapter = new PrismaPg(driverPool, { schema, disposeExternalPool: true });
  return new PrismaClient({ adapter });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type TransactionClient = Prisma.TransactionClient;
