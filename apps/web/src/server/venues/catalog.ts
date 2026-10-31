import "server-only";
import type { DatabaseClient, TransactionClient } from "../../database/client";
import type { Prisma } from "../../generated/prisma/client";
import { ApiError } from "../api/errors";
import { validate } from "../api/validation";
import { databaseNow } from "./database";
import { courtQuerySchema, idSchema, slotQuerySchema, venueQuerySchema } from "./schemas";
import { localDayBounds } from "./time";

const venueSelect = {
  id: true, name: true, description: true, address: true, city: true,
  timezone: true, currency: true, imageUrl: true, isActive: true,
} satisfies Prisma.VenueSelect;

function page<T extends { id: string }>(rows: T[], limit: number) {
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

async function enrichVenues(tx: TransactionClient, venues: Prisma.VenueGetPayload<{ select: typeof venueSelect }>[], now: Date, admin: boolean) {
  const ids = venues.map(venue => venue.id);
  if (!ids.length) return [];
  const [courts, prices] = await Promise.all([
    tx.court.groupBy({ by: ["venueId", "sport"], where: { venueId: { in: ids }, isActive: true } }),
    tx.slot.groupBy({ by: ["venueId"], where: {
      venueId: { in: ids }, startsAt: { gt: now }, isBlocked: false,
      court: { isActive: true }, items: { none: { status: "RESERVED" } },
    }, _min: { priceMinor: true } }),
  ]);
  return venues.map(venue => {
    const { isActive, ...fields } = venue;
    return { ...fields, ...(admin ? { isActive } : {}),
      sports: courts.filter(court => court.venueId === venue.id).map(court => court.sport).sort(),
      startingPriceMinor: prices.find(price => price.venueId === venue.id)?._min.priceMinor ?? null,
    };
  });
}

export function createCatalogService(db: DatabaseClient) {
  const readOptions = { isolationLevel: "RepeatableRead" as const, maxWait: 5000, timeout: 10_000 };

  async function listVenues(input: unknown, admin = false) {
    const query = validate(venueQuerySchema, input);
    return db.$transaction(async tx => {
      const now = await databaseNow(tx);
      const venues = await tx.venue.findMany({
        where: { ...(!admin ? { isActive: true } : {}),
          ...(query.city ? { city: { equals: query.city, mode: "insensitive" as const } } : {}),
          ...(query.sport ? { courts: { some: { isActive: true, sport: { equals: query.sport, mode: "insensitive" as const } } } } : {}),
        }, select: venueSelect, orderBy: { id: "asc" }, take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const result = page(venues, query.limit);
      return { venues: await enrichVenues(tx, result.items, now, admin), nextCursor: result.nextCursor, asOf: now.toISOString() };
    }, readOptions);
  }

  async function getVenue(id: unknown, admin = false) {
    const venueId = validate(idSchema, id);
    return db.$transaction(async tx => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ...(!admin ? { isActive: true } : {}) }, select: venueSelect });
      if (!venue) throw new ApiError("NOT_FOUND");
      return (await enrichVenues(tx, [venue], await databaseNow(tx), admin))[0]!;
    }, readOptions);
  }

  async function listCourts(id: unknown, input: unknown, admin = false) {
    const venueId = validate(idSchema, id); const query = validate(courtQuerySchema, input);
    return db.$transaction(async tx => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ...(!admin ? { isActive: true } : {}) }, select: { id: true } });
      if (!venue) throw new ApiError("NOT_FOUND");
      const courts = await tx.court.findMany({ where: { venueId, ...(!admin ? { isActive: true } : {}) },
        select: { id: true, venueId: true, name: true, sport: true, ...(admin ? { isActive: true } : {}) },
        orderBy: { id: "asc" }, take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const result = page(courts, query.limit);
      return { courts: result.items, nextCursor: result.nextCursor };
    }, readOptions);
  }

  async function listSlots(id: unknown, input: unknown, admin = false) {
    const venueId = validate(idSchema, id); const query = validate(slotQuerySchema, input);
    return db.$transaction(async tx => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, ...(!admin ? { isActive: true } : {}) }, select: { id: true, timezone: true, currency: true, isActive: true } });
      if (!venue) throw new ApiError("NOT_FOUND");
      if (query.courtId && !await tx.court.findFirst({ where: { id: query.courtId, venueId, ...(!admin ? { isActive: true } : {}) }, select: { id: true } })) throw new ApiError("NOT_FOUND");
      let bounds: ReturnType<typeof localDayBounds>;
      try { bounds = localDayBounds(query.date, venue.timezone); }
      catch (error) {
        if (error instanceof RangeError) throw new ApiError("VALIDATION_ERROR", { issues: [{ field: "date", message: "This date cannot be displayed in the venue timezone." }] });
        throw error;
      }
      const now = await databaseNow(tx);
      const slots = await tx.slot.findMany({ where: {
        venueId, startsAt: { gte: bounds.start, lt: bounds.end },
        ...(query.courtId ? { courtId: query.courtId } : {}), ...(!admin ? { court: { isActive: true } } : {}),
      }, select: {
        id: true, courtId: true, startsAt: true, endsAt: true, priceMinor: true, version: true, isBlocked: true,
        court: { select: { name: true, sport: true, isActive: true } },
        items: { where: { status: "RESERVED" }, select: { id: true }, take: 1 },
      }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const result = page(slots, query.limit);
      return {
        venue: { id: venue.id, timezone: venue.timezone, currency: venue.currency }, date: query.date,
        dayStartsAt: bounds.start.toISOString(), dayEndsAt: bounds.end.toISOString(), asOf: now.toISOString(),
        slots: result.items.map(slot => {
          const availability = slot.startsAt <= now ? "PAST" : !venue.isActive || !slot.court.isActive ? "INACTIVE"
            : slot.isBlocked ? "BLOCKED" : slot.items.length ? "BOOKED" : "AVAILABLE";
          return { id: slot.id, courtId: slot.courtId, courtName: slot.court.name, sport: slot.court.sport,
            startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), priceMinor: slot.priceMinor,
            version: slot.version, isBlocked: slot.isBlocked, availability, isAvailable: availability === "AVAILABLE" };
        }), nextCursor: result.nextCursor,
      };
    }, readOptions);
  }
  return { listVenues, getVenue, listCourts, listSlots };
}
