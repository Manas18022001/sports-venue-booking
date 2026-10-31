import "server-only";
import type { DatabaseClient, TransactionClient } from "../../database/client";
import { ApiError } from "../api/errors";

export async function databaseNow(db: DatabaseClient | TransactionClient) {
  const rows = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!rows[0]) throw new ApiError("SERVICE_UNAVAILABLE");
  return rows[0].now;
}

// Inspect only typed adapter metadata; never expose SQL or raw error messages.
function sqlState(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 5) return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.originalCode === "string") return value.originalCode;
  if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code) && !value.code.startsWith("P")) return value.code;
  for (const field of ["cause", "meta", "driverAdapterError"]) {
    const code = sqlState(value[field], depth + 1); if (code) return code;
  }
  return undefined;
}
export function translateWriteError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const prismaCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const code = sqlState(error);
  if (code === "23P01") throw new ApiError("SLOT_OVERLAP");
  if (prismaCode === "P2002" || prismaCode === "P2003" || code === "23505" || code === "23503" || code === "23514") throw new ApiError("CONFLICT");
  if (prismaCode === "P2025") throw new ApiError("NOT_FOUND");
  if (prismaCode === "P2034" || prismaCode === "P2028" || code === "40P01" || code === "40001" || code === "55P03" || code === "57014") throw new ApiError("SERVICE_UNAVAILABLE");
  throw error;
}
