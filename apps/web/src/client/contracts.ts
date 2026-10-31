import type { createCatalogService } from "../server/venues/catalog";
import type { createVenueAdminService } from "../server/venues/admin";
import type { createBookingService } from "../server/bookings/service";
import type { BookingResponse } from "../server/bookings/presentation";
import type { PublicUser } from "../server/auth/service";

type Catalog = ReturnType<typeof createCatalogService>;
type Admin = ReturnType<typeof createVenueAdminService>;
type Bookings = ReturnType<typeof createBookingService>;
export type User = PublicUser;
export type Session = {
  user: User;
  csrfToken: string;
  sessionExpiresAt: string;
};
export type Venue = Awaited<ReturnType<Catalog["getVenue"]>>;
export type Venues = Awaited<ReturnType<Catalog["listVenues"]>>;
export type Courts = Awaited<ReturnType<Catalog["listCourts"]>>;
export type Court = Courts["courts"][number];
export type Slots = Awaited<ReturnType<Catalog["listSlots"]>>;
export type Slot = Slots["slots"][number];
export type Preview = Awaited<ReturnType<Admin["previewSlots"]>>;
export type Booking = BookingResponse["booking"];
export type BookingDetail = BookingResponse;
export type BookingList = Awaited<ReturnType<Bookings["list"]>>;
export type Generation = {
  courtIds: string[];
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  priceMinor: number;
};
