import "server-only";
import { createHash } from "node:crypto";
import type { TransactionClient } from "../../database/client";
import type { Prisma } from "../../generated/prisma/client";
import { ApiError } from "../api/errors";
import type { BookingResponse } from "./presentation";

export type MutationResult = { data: BookingResponse; status: 200 | 201; replayed: boolean };
export type IdempotencyScope = { userId: string; operation: string; key: string };
export function requestHash(input: unknown) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }

export async function findReplay(tx: TransactionClient, scope: IdempotencyScope, hash: string): Promise<MutationResult | null> {
  const lockScope = JSON.stringify([scope.userId, scope.operation, scope.key]);
  // Hash collisions merely serialize unrelated requests; the unique key and
  // request hash still decide replay. No pending record is committed separately.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))::text AS locked`;
  const record = await tx.idempotencyRecord.findUnique({ where: { userId_operation_key: scope } });
  if (!record) return null;
  if (record.requestHash !== hash) throw new ApiError("IDEMPOTENCY_KEY_REUSED");
  const body = record.responseBody;
  if ((record.responseStatus !== 200 && record.responseStatus !== 201) || !body || typeof body !== "object" || Array.isArray(body)
    || !body.booking || typeof body.booking !== "object" || Array.isArray(body.booking) || body.booking.id !== record.bookingId || typeof body.asOf !== "string") throw new ApiError("INTERNAL_ERROR");
  // These records contain only this operation's own serialized DTO.
  return { data: body as unknown as BookingResponse, status: record.responseStatus, replayed: true };
}

export async function saveResult(tx: TransactionClient, scope: IdempotencyScope, hash: string, data: BookingResponse, status: 200 | 201): Promise<MutationResult> {
  await tx.idempotencyRecord.create({ data: { ...scope, requestHash: hash, bookingId: data.booking.id,
    responseStatus: status, responseBody: data as unknown as Prisma.InputJsonValue } });
  return { data, status, replayed: false };
}
