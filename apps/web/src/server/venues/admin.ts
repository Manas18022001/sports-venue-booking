import "server-only";
import { Prisma } from "../../generated/prisma/client";
import type { DatabaseClient, TransactionClient } from "../../database/client";
import type { ServerConfig } from "../config/schema";
import { ApiError } from "../api/errors";
import { validate } from "../api/validation";
import { databaseNow, translateWriteError } from "./database";
import { generationPlan, signPreview, verifyPreview } from "./generation";
import {
  courtCreateSchema, courtUpdateSchema, generationConfirmSchema, generationSchema,
  idSchema, slotUpdateSchema, venueCreateSchema, venueUpdateSchema,
} from "./schemas";

function definedFields<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export function createVenueAdminService(db: DatabaseClient, config: ServerConfig) {
  const transactionOptions = { maxWait: 5000, timeout: 10_000 };

  function write<T>(action: (tx: TransactionClient) => Promise<T>) {
    return db.$transaction(async tx => {
      // Server-side limits also release locks when a PostgreSQL query is waiting;
      // a JavaScript transaction deadline alone does not cancel a blocked query.
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      return action(tx);
    }, transactionOptions);
  }

  async function createVenue(input: unknown) {
    const data = validate(venueCreateSchema, input);
    try { return await db.venue.create({ data }); } catch (error) { return translateWriteError(error); }
  }

  async function updateVenue(id: unknown, input: unknown) {
    const venueId = validate(idSchema, id); const data = validate(venueUpdateSchema, input);
    try {
      return await write(async tx => {
        await tx.$queryRaw`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR UPDATE`;
        const venue = await tx.venue.findUnique({ where: { id: venueId } });
        if (!venue) throw new ApiError("NOT_FOUND");
        if ((data.timezone && data.timezone !== venue.timezone) || (data.currency && data.currency !== venue.currency)) {
          if (await tx.slot.count({ where: { venueId } }) || await tx.booking.count({ where: { venueId } })) throw new ApiError("CONFLICT");
        }
        return tx.venue.update({ where: { id: venueId }, data: definedFields(data) });
      });
    } catch (error) { return translateWriteError(error); }
  }

  async function createCourt(id: unknown, input: unknown) {
    const venueId = validate(idSchema, id); const data = validate(courtCreateSchema, input);
    try {
      return await write(async tx => {
        await tx.$queryRaw`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR SHARE`;
        if (!await tx.venue.findUnique({ where: { id: venueId }, select: { id: true } })) throw new ApiError("NOT_FOUND");
        return tx.court.create({ data: { ...data, venueId } });
      });
    } catch (error) { return translateWriteError(error); }
  }

  async function updateCourt(venue: unknown, id: unknown, input: unknown) {
    const venueId = validate(idSchema, venue); const courtId = validate(idSchema, id); const data = validate(courtUpdateSchema, input);
    try {
      return await write(async tx => {
        await tx.$queryRaw`SELECT id FROM courts WHERE id = ${courtId}::uuid AND venue_id = ${venueId}::uuid FOR UPDATE`;
        const court = await tx.court.findFirst({ where: { id: courtId, venueId }, select: { id: true, sport: true } });
        if (!court) throw new ApiError("NOT_FOUND");
        // Changing the sport of an existing schedule would change what customers
        // reviewed without changing slot versions. Use a separate court instead.
        if (data.sport && data.sport !== court.sport && await tx.slot.count({ where: { courtId } })) throw new ApiError("CONFLICT");
        return tx.court.update({ where: { id: courtId }, data: definedFields(data) });
      });
    } catch (error) { return translateWriteError(error); }
  }

  async function generationContext(tx: TransactionClient, venueId: string, courtIds: string[]) {
    // Shared parent locks prevent deactivation or timezone changes while creating
    // slots. Existing-slot edits take their slot lock before these shared locks.
    await tx.$queryRaw`SELECT id FROM courts WHERE venue_id = ${venueId}::uuid AND id IN (${Prisma.join(courtIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR SHARE`;
    const venue = await tx.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new ApiError("NOT_FOUND");
    const courts = await tx.court.findMany({ where: { id: { in: courtIds }, venueId, isActive: true }, select: { id: true } });
    if (!venue.isActive || courts.length !== courtIds.length) throw new ApiError("CONFLICT");
    return venue;
  }

  async function conflicts(tx: TransactionClient, venueId: string, plan: ReturnType<typeof generationPlan>) {
    const generatedEnd = plan.unusedPeriod?.startsAt ?? plan.endsAt;
    const rows = await tx.slot.findMany({ where: { venueId, courtId: { in: plan.courtIds },
      startsAt: { lt: new Date(generatedEnd) }, endsAt: { gt: new Date(plan.startsAt) },
    }, select: { id: true, courtId: true, startsAt: true, endsAt: true }, orderBy: { id: "asc" }, take: 51 });
    return { conflicts: rows.slice(0, 50).map(row => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
      hasMoreConflicts: rows.length > 50 };
  }

  async function previewSlots(id: unknown, input: unknown, admin: string) {
    const venueId = validate(idSchema, id); const adminId = validate(idSchema, admin);
    const plan = generationPlan(validate(generationSchema, input));
    try {
      return await write(async tx => {
        const venue = await generationContext(tx, venueId, plan.courtIds);
        const now = await databaseNow(tx);
        if (new Date(plan.startsAt) <= now) throw new ApiError("VALIDATION_ERROR", { issues: [{ field: "startsAt", message: "Choose a future start time." }] });
        const overlap = await conflicts(tx, venueId, plan);
        return { venueId, timezone: venue.timezone, currency: venue.currency, ...plan, ...overlap,
          canGenerate: overlap.conflicts.length === 0,
          ...signPreview(config, { adminId, venueId, timezone: venue.timezone, currency: venue.currency, plan }, now) };
      });
    } catch (error) { return translateWriteError(error); }
  }

  async function generateSlots(id: unknown, input: unknown, admin: string) {
    const venueId = validate(idSchema, id); const adminId = validate(idSchema, admin);
    const data = validate(generationConfirmSchema, input); const plan = generationPlan(data);
    try {
      return await write(async tx => {
        const venue = await generationContext(tx, venueId, plan.courtIds);
        const now = await databaseNow(tx);
        verifyPreview(config, { adminId, venueId, timezone: venue.timezone, currency: venue.currency, plan }, data.previewToken, now);
        if (new Date(plan.startsAt) <= now) throw new ApiError("PREVIEW_EXPIRED");
        if (plan.unusedPeriod && !data.acknowledgeUnusedPeriod) throw new ApiError("UNUSED_PERIOD_ACKNOWLEDGEMENT_REQUIRED");
        if ((await conflicts(tx, venueId, plan)).conflicts.length) throw new ApiError("SLOT_OVERLAP");
        // No skipDuplicates: every requested slot is inserted or the whole batch
        // rolls back. The exclusion constraint settles concurrent empty-range races.
        const slots = await tx.slot.createManyAndReturn({ data: plan.slots.map(slot => ({
          venueId, courtId: slot.courtId, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), priceMinor: slot.priceMinor,
        })), select: { id: true, courtId: true, startsAt: true, endsAt: true, priceMinor: true, version: true, isBlocked: true } });
        slots.sort((a, b) => a.courtId.localeCompare(b.courtId) || a.startsAt.getTime() - b.startsAt.getTime());
        return { venueId, timezone: venue.timezone, currency: venue.currency, createdCount: slots.length,
          unusedPeriod: plan.unusedPeriod, slots: slots.map(slot => ({ ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() })) };
      });
    } catch (error) { return translateWriteError(error); }
  }

  async function updateSlot(venue: unknown, id: unknown, input: unknown) {
    const venueId = validate(idSchema, venue); const slotId = validate(idSchema, id); const data = validate(slotUpdateSchema, input);
    try {
      return await write(async tx => {
        await tx.$queryRaw`SELECT id FROM slots WHERE id = ${slotId}::uuid AND venue_id = ${venueId}::uuid FOR UPDATE`;
        const slot = await tx.slot.findFirst({ where: { id: slotId, venueId } });
        if (!slot) throw new ApiError("NOT_FOUND");
        if (slot.version !== data.version) throw new ApiError("STALE_SLOT");
        const startsAt = data.startsAt ? new Date(data.startsAt) : slot.startsAt;
        const endsAt = data.endsAt ? new Date(data.endsAt) : slot.endsAt;
        const priceMinor = data.priceMinor ?? slot.priceMinor;
        const isBlocked = data.isBlocked ?? slot.isBlocked;
        const changed = startsAt.getTime() !== slot.startsAt.getTime() || endsAt.getTime() !== slot.endsAt.getTime()
          || priceMinor !== slot.priceMinor || isBlocked !== slot.isBlocked;
        if (!changed) return { ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() };
        if (await tx.bookingItem.count({ where: { slotId, status: "RESERVED" } })) throw new ApiError("SLOT_RESERVED");
        const now = await databaseNow(tx);
        if (slot.startsAt <= now || startsAt <= now || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 26 * 3_600_000) {
          throw new ApiError("VALIDATION_ERROR", { issues: [{ field: "startsAt", message: "Choose a valid future interval." }] });
        }
        await generationContext(tx, venueId, [slot.courtId]);
        if (await tx.slot.count({ where: { id: { not: slotId }, courtId: slot.courtId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) throw new ApiError("SLOT_OVERLAP");
        const updated = await tx.slot.update({ where: { id: slotId }, data: { startsAt, endsAt, priceMinor, isBlocked } });
        return { ...updated, startsAt: updated.startsAt.toISOString(), endsAt: updated.endsAt.toISOString() };
      });
    } catch (error) { return translateWriteError(error); }
  }

  return { createVenue, updateVenue, createCourt, updateCourt, previewSlots, generateSlots, updateSlot };
}
