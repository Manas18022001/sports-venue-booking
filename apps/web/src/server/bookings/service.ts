import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import type { DatabaseClient, TransactionClient } from "../../database/client";
import type { Principal } from "../auth/service";
import { ApiError } from "../api/errors";
import { validate } from "../api/validation";
import { databaseNow, databaseSqlState, translateWriteError, writeTransaction } from "../database-operations";
import { findReplay, requestHash, saveResult } from "./idempotency";
import { bookingSelect, canCancel, presentBooking } from "./presentation";
import {
  adminBookingQuerySchema, adminCancellationSchema, bookingIdSchema, bookingQuerySchema,
  cancellationSchema, canonicalCheckout, checkoutSchema, idempotencyKeySchema,
} from "./schemas";

async function readActor(tx: TransactionClient, principal: Principal, admin: boolean, lock = false) {
  if (lock) {
    // Match auth's user-before-session order; logout cannot revoke midway through
    // an accepted transaction, and deactivation/role changes cannot slip past it.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${principal.user.id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${principal.sessionId}::uuid AND user_id = ${principal.user.id}::uuid FOR SHARE`;
  }
  const session = await tx.authSession.findFirst({ where: { id: principal.sessionId, userId: principal.user.id },
    select: { expiresAt: true, revokedAt: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } } });
  const now = await databaseNow(tx);
  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) throw new ApiError("UNAUTHORIZED");
  if (admin && session.user.role !== "ADMIN") throw new ApiError("FORBIDDEN");
  return { user: session.user, sessionExpiresAt: session.expiresAt };
}

async function lockSlots(tx: TransactionClient, ids: string[]) {
  await tx.$queryRaw`SELECT id FROM slots WHERE id IN (${Prisma.join([...ids].sort().map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}

function bookingError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "P2002" || databaseSqlState(error) === "23505") throw new ApiError("SLOT_UNAVAILABLE");
  }
  return translateWriteError(error);
}

export function createBookingService(db: DatabaseClient) {
  async function create(principal: Principal, input: unknown, key: unknown) {
    const data = canonicalCheckout(validate(checkoutSchema, input));
    const scope = { userId: principal.user.id, operation: "booking.create", key: validate(idempotencyKeySchema, key) };
    const hash = requestHash(data);
    try {
      return await writeTransaction(db, async tx => {
        const actor = await readActor(tx, principal, false, true);
        const replay = await findReplay(tx, scope, hash);
        if (actor.sessionExpiresAt <= await databaseNow(tx)) throw new ApiError("UNAUTHORIZED");
        if (replay) return replay;

        const ids = data.items.map(item => item.slotId);
        await lockSlots(tx, ids);
        const slots = await tx.slot.findMany({ where: { id: { in: ids } },
          select: { id: true, venueId: true, courtId: true, startsAt: true, endsAt: true, priceMinor: true, version: true, isBlocked: true } });
        if (slots.length !== ids.length) throw new ApiError("SLOT_UNAVAILABLE");
        if (slots.some(slot => slot.venueId !== data.venueId)) throw new ApiError("VALIDATION_ERROR", {
          issues: [{ field: "items", message: "All slots must belong to the selected venue." }],
        });
        const courtIds = [...new Set(slots.map(slot => slot.courtId))].sort();
        await tx.$queryRaw`SELECT id FROM courts WHERE id IN (${Prisma.join(courtIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM venues WHERE id = ${data.venueId}::uuid FOR SHARE`;
        const [venue, courts, reserved] = await Promise.all([
          tx.venue.findUnique({ where: { id: data.venueId }, select: { id: true, isActive: true, currency: true } }),
          tx.court.findMany({ where: { id: { in: courtIds } }, select: { id: true, name: true, sport: true, isActive: true } }),
          tx.bookingItem.count({ where: { slotId: { in: ids }, status: "RESERVED" } }),
        ]);
        // Read the clock and reservations AFTER acquiring all relevant locks.
        const now = await databaseNow(tx);
        if (actor.sessionExpiresAt <= now) throw new ApiError("UNAUTHORIZED");
        if (!venue?.isActive || courts.some(court => !court.isActive) || reserved || slots.some(slot => slot.isBlocked || slot.startsAt <= now)) throw new ApiError("SLOT_UNAVAILABLE");
        const byId = new Map(slots.map(slot => [slot.id, slot]));
        if (venue.currency !== data.currency || data.items.some(item => {
          const slot = byId.get(item.slotId)!; return item.version !== slot.version || item.priceMinor !== slot.priceMinor;
        })) throw new ApiError("BOOKING_REVIEW_REQUIRED");
        const byCourt = new Map(courts.map(court => [court.id, court]));
        const booking = await tx.booking.create({ data: {
          reference: `TF-${randomUUID()}`, userId: actor.user.id, venueId: venue.id, currency: venue.currency,
          customerName: actor.user.name, customerEmail: actor.user.email, createdAt: now,
        }, select: { id: true } });
        await tx.bookingItem.createMany({ data: data.items.map(item => {
          const slot = byId.get(item.slotId)!; const court = byCourt.get(slot.courtId)!;
          return { bookingId: booking.id, slotId: slot.id, venueId: venue.id,
            courtName: court.name, sport: court.sport, startsAt: slot.startsAt, endsAt: slot.endsAt, priceMinor: slot.priceMinor };
        }) });
        const record = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: bookingSelect });
        return saveResult(tx, scope, hash, { booking: presentBooking(record, now), asOf: now.toISOString() }, 201);
      });
    } catch (error) { return bookingError(error); }
  }

  async function cancel(principal: Principal, id: unknown, input: unknown, key: unknown, admin = false) {
    const bookingId = validate(bookingIdSchema, id);
    const data = admin ? validate(adminCancellationSchema, input) : validate(cancellationSchema, input);
    const reason = "reason" in data && typeof data.reason === "string" ? data.reason : null;
    const itemIds = [...data.itemIds].sort();
    const scope = { userId: principal.user.id, operation: admin ? "booking.cancel.admin" : "booking.cancel.customer", key: validate(idempotencyKeySchema, key) };
    const hash = requestHash({ bookingId, itemIds, reason });
    try {
      return await writeTransaction(db, async tx => {
        const actor = await readActor(tx, principal, admin, true);
        const replay = await findReplay(tx, scope, hash);
        if (actor.sessionExpiresAt <= await databaseNow(tx)) throw new ApiError("UNAUTHORIZED");
        if (replay) return replay;
        const where = { id: bookingId, ...(!admin ? { userId: actor.user.id } : {}) };
        const selected = await tx.booking.findFirst({ where, select: { id: true,
          items: { where: { id: { in: itemIds } }, select: { id: true, slotId: true } } } });
        // Scope ownership before locking or exposing anything about another user.
        if (!selected || selected.items.length !== itemIds.length) throw new ApiError("NOT_FOUND");
        await lockSlots(tx, selected.items.map(item => item.slotId));
        // Serialize partial cancellations of one booking so derived response
        // totals include any earlier committed cancellation of its other items.
        await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
        const record = await tx.booking.findFirst({ where, select: bookingSelect });
        if (!record) throw new ApiError("NOT_FOUND");
        const active = record.items.filter(item => itemIds.includes(item.id) && item.status === "RESERVED");
        const now = await databaseNow(tx);
        if (actor.sessionExpiresAt <= now) throw new ApiError("UNAUTHORIZED");
        if (active.some(item => !canCancel(item.startsAt, now, admin))) {
          throw new ApiError(admin ? "CANCELLATION_NOT_ALLOWED" : "CANCELLATION_WINDOW_CLOSED");
        }
        if (active.length) {
          const result = await tx.bookingItem.updateMany({ where: { id: { in: active.map(item => item.id) }, bookingId, status: "RESERVED" },
            data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.user.id,
              cancellationSource: admin ? "ADMIN" : "CUSTOMER", cancellationReason: reason } });
          if (result.count !== active.length) throw new ApiError("CONFLICT");
        }
        const updated = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: bookingSelect });
        return saveResult(tx, scope, hash, { booking: presentBooking(updated, now, admin), asOf: now.toISOString() }, 200);
      });
    } catch (error) { return bookingError(error); }
  }

  async function read<T>(principal: Principal, admin: boolean, action: (tx: TransactionClient, now: Date) => Promise<T>) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        await readActor(tx, principal, admin);
        return action(tx, await databaseNow(tx));
      }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10_000 });
    } catch (error) { return translateWriteError(error); }
  }

  async function get(principal: Principal, id: unknown, admin = false) {
    const bookingId = validate(bookingIdSchema, id);
    return read(principal, admin, async (tx, now) => {
      const record = await tx.booking.findFirst({ where: { id: bookingId, ...(!admin ? { userId: principal.user.id } : {}) }, select: bookingSelect });
      if (!record) throw new ApiError("NOT_FOUND");
      return { booking: presentBooking(record, now, admin), asOf: now.toISOString() };
    });
  }

  async function list(principal: Principal, input: unknown, admin = false) {
    const query = admin ? validate(adminBookingQuerySchema, input) : validate(bookingQuerySchema, input);
    return read(principal, admin, async (tx, now) => {
      const rows = await tx.booking.findMany({ where: { ...(!admin ? { userId: principal.user.id } : {}),
        ...("venueId" in query && query.venueId ? { venueId: query.venueId } : {}) },
        select: bookingSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      // List cards use summaries; the detail endpoint supplies all item snapshots.
      const bookings = rows.slice(0, query.limit).map(record => {
        const { items, ...summary } = presentBooking(record, now, admin);
        return { ...summary, nextStartsAt: items.filter(item => item.state === "UPCOMING").map(item => item.startsAt).sort()[0] ?? null };
      });
      return { bookings, nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null, asOf: now.toISOString() };
    });
  }
  return { create, cancel, get, list };
}
