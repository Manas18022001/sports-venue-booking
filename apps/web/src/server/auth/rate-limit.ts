import "server-only";
import { randomInt } from "node:crypto";
import { isIP } from "node:net";
import type { DatabaseClient } from "../../database/client";
import type { ServerConfig } from "../config/schema";
import { ApiError } from "../api/errors";
import { rateKey } from "./crypto";

export function clientNetwork(request: Request, config: ServerConfig): string {
  const header = config.auth.clientIpHeader;
  if (header === "none") return "unidentified";
  const value = request.headers.get(header)?.trim() ?? "";
  // The trusted ingress must overwrite this header with ONE verified address.
  // Missing, malformed, or multi-hop values share a conservative fallback bucket.
  const version = isIP(value);
  if (!version) return "unidentified";
  return version === 6 ? new URL(`http://[${value}]/`).hostname : value;
}

export async function consumeRateLimit(
  db: DatabaseClient, config: ServerConfig,
  scope: string, limit: number, windowSeconds: number,
) {
  try {
    const hash = rateKey(config.auth, scope);
    const rows = await db.$queryRaw<Array<{ attempts: number; expires_at: Date; now: Date }>>`
      INSERT INTO rate_limit_buckets (key_hash, attempts, expires_at)
      VALUES (${hash}, 1, clock_timestamp() + (${windowSeconds}::int * interval '1 second'))
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE WHEN rate_limit_buckets.expires_at <= clock_timestamp()
          THEN 1 ELSE LEAST(rate_limit_buckets.attempts + 1, ${limit + 1}::int) END,
        expires_at = CASE WHEN rate_limit_buckets.expires_at <= clock_timestamp()
          THEN EXCLUDED.expires_at ELSE rate_limit_buckets.expires_at END
      RETURNING attempts, expires_at, clock_timestamp() AS now`;
    const row = rows[0];
    if (!row) throw new Error("Counter unavailable");
    if (row.attempts > limit) {
      throw new ApiError("RATE_LIMITED", { retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at.getTime() - row.now.getTime()) / 1000)) });
    }
    if (randomInt(100) === 0) {
      await db.$executeRaw`WITH expired AS (
        SELECT key_hash FROM rate_limit_buckets
        WHERE expires_at < clock_timestamp() - interval '1 day'
        LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM rate_limit_buckets b USING expired e WHERE b.key_hash = e.key_hash`;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Losing the shared limiter must never silently disable it.
    throw new ApiError("SERVICE_UNAVAILABLE");
  }
}
