import { Temporal } from "@js-temporal/polyfill";
import { loadServerEnvironment } from "../environment.mjs";
import { getServerConfig } from "../src/server/config/index";
import { createDatabaseClient } from "../src/database/client";

loadServerEnvironment();
const config = getServerConfig();
if (config.environment === "production")
  throw new Error("Demo seeding is disabled in production.");
const db = createDatabaseClient(
  config.database.connectionString,
  config.database.pool,
);
const id = (value: number) =>
  `f1000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const venues = [
  {
    name: "The Rally Club",
    city: "Pune",
    address: "Baner Sports District, Baner",
    sport: "Badminton",
    price: 50000,
    description:
      "Bright courts, room for a good rally, and a little time away from your screen. A fictional sample venue for exploring the Turfit assessment.",
  },
  {
    name: "Greenline Sports Park",
    city: "Bengaluru",
    address: "Whitefield Sports Enclave, Whitefield",
    sport: "Football",
    price: 90000,
    description:
      "Bring your five-a-side crew and make an evening of it. A fictional sample venue for exploring the Turfit assessment.",
  },
  {
    name: "Baseline Social",
    city: "Pune",
    address: "Riverside Recreation Centre, Kalyani Nagar",
    sport: "Tennis",
    price: 70000,
    description:
      "Early-morning serves and after-work doubles. Find your rhythm here. A fictional sample venue for exploring the Turfit assessment.",
  },
];
try {
  const now = Temporal.Now.instant();
  const today = now.toZonedDateTimeISO("Asia/Kolkata").toPlainDate();
  for (const [index, venue] of venues.entries()) {
    const venueId = id(index + 1);
    await db.venue.upsert({
      where: { id: venueId },
      create: {
        id: venueId,
        name: venue.name,
        city: venue.city,
        address: venue.address,
        description: venue.description,
      },
      update: {},
    });
    for (let court = 0; court < 2; court++) {
      const courtId = id(100 + index * 2 + court);
      await db.court.upsert({
        where: { id: courtId },
        create: {
          id: courtId,
          venueId,
          name: `Court ${String.fromCharCode(65 + court)}`,
          sport: venue.sport,
        },
        update: {},
      });
      const existing = await db.slot.findMany({
        where: { courtId, endsAt: { gt: new Date(now.epochMilliseconds) } },
        select: { startsAt: true, endsAt: true },
      });
      const slots = [];
      for (let day = 0; day < 7; day++)
        for (let hour = 8; hour < 22; hour++) {
          const start = today
            .add({ days: day })
            .toPlainDateTime({ hour })
            .toZonedDateTime("Asia/Kolkata")
            .toInstant();
          const end = start.add({ hours: 1 });
          if (
            start.epochMilliseconds <= now.epochMilliseconds ||
            existing.some(
              (slot) =>
                slot.startsAt.getTime() < end.epochMilliseconds &&
                slot.endsAt.getTime() > start.epochMilliseconds,
            )
          )
            continue;
          slots.push({
            venueId,
            courtId,
            startsAt: new Date(start.epochMilliseconds),
            endsAt: new Date(end.epochMilliseconds),
            priceMinor: venue.price + court * 10000,
          });
        }
      if (slots.length)
        await db.slot.createMany({ data: slots, skipDuplicates: true });
    }
  }
  console.log(
    "Demo venues and seven days of missing slots are ready. Existing details, schedules, and bookings were preserved. No accounts were created.",
  );
} catch {
  console.error(
    "Demo seeding failed. Check your database connection and apply migrations first.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
