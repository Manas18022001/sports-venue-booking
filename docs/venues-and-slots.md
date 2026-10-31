# Venues, availability, and admin slot management

These two backend checkpoints add public browsing and the admin operations needed
to populate it. The APIs use the existing error envelope, input limits, safe logs,
security headers, and `private, no-store` cache policy. They do not add UI screens
or booking/cancellation endpoints.

## Checkpoint 1: public discovery and availability

| Method and path | Purpose |
| --- | --- |
| `GET /api/venues` | Active venues, offered sports, location, and starting price. |
| `GET /api/venues/:venueId` | One active venue's details and starting price. |
| `GET /api/venues/:venueId/courts` | Its active courts and their sports. |
| `GET /api/venues/:venueId/slots?date=2030-04-02` | Dated slot availability across active courts. |

Browsing requires no session or CSRF token. Inactive venues return 404; inactive
courts and their slots are hidden from public responses. No customer identities,
reservation IDs, or account details appear in availability results.

Venue discovery accepts optional `city` and `sport` filters, matched exactly and
case-insensitively. Sports are derived from active courts. `startingPriceMinor`
is the minimum price across that venue's future, unblocked, unreserved slots on
active courts. It is `null` when no such slot exists; it is never a fabricated
default. Money is an integer in minor units: `50000` means INR 500.00.

Lists use cursor pagination. Venue/court lists default to 20 items, maximum 50;
slots default to 100, maximum 500. Pass the returned `nextCursor` as `cursor`,
preserving the filters and date. A null cursor means the end. Venues/courts sort
by immutable ID; slots sort by start time then ID. Slot queries optionally accept
`courtId`, which must belong to that venue. Unknown list filters, duplicate query
parameters, malformed IDs, impossible dates, and invalid limits are rejected.

The date is a calendar date **in the venue's timezone**, not in the browser's or
server's timezone. For `Asia/Kolkata`, 2030-04-02 starts at
2030-04-01T18:30:00Z. Calendar arithmetic computes the next local midnight, so
daylight-saving days can correctly contain 23 or 25 hours. The Temporal polyfill
handles this conversion. A completely skipped local date is rejected. A slot
belongs to the day on which it starts; a slot spanning midnight is not duplicated
on both days. Boundaries are inclusive at the start and exclusive at the end.

The response contains `venue` (ID, timezone, currency), `date`, `dayStartsAt`,
`dayEndsAt`, `asOf`, `slots`, and `nextCursor`. Each slot exposes:

```json
{
  "id": "slot-uuid",
  "courtId": "court-uuid",
  "courtName": "Court A",
  "sport": "Badminton",
  "startsAt": "2030-04-02T03:30:00.000Z",
  "endsAt": "2030-04-02T04:30:00.000Z",
  "priceMinor": 50000,
  "version": 1,
  "isBlocked": false,
  "availability": "AVAILABLE",
  "isAvailable": true
}
```

Availability is derived, never independently stored: past slots are `PAST`;
future inactive resources are `INACTIVE` (admin reads only); otherwise a slot is
`BLOCKED`, `BOOKED`, or `AVAILABLE`. Cancelled reservations do not make a slot
booked. The responses intentionally retain unavailable slots for disabled UI
states. Public list/detail queries use short Repeatable Read transactions for a
consistent response, with time obtained from PostgreSQL. Availability is a
snapshot, not a hold: the upcoming checkout must lock and revalidate selections.

## Checkpoint 2: admin venue and slot management

Every admin request uses `requireAdmin`, checking the access cookie, live session,
active account, and current database role. All writes also require the configured
Origin and `X-CSRF-Token`. A customer gets 403; a missing/invalid session gets 401.

| Method and path | Purpose |
| --- | --- |
| `GET /api/admin/venues` | Paginated discovery including archived venues. |
| `POST /api/admin/venues` | Add a venue. |
| `GET /api/admin/venues/:venueId` | Details including its active flag. |
| `PATCH /api/admin/venues/:venueId` | Edit or archive/reactivate a venue. |
| `GET /api/admin/venues/:venueId/courts` | Paginated courts including inactive ones. |
| `POST /api/admin/venues/:venueId/courts` | Add a court/resource. |
| `PATCH /api/admin/venues/:venueId/courts/:courtId` | Edit or archive/reactivate a court. |
| `GET /api/admin/venues/:venueId/slots?date=2030-04-02` | Slots including inactive courts. |
| `POST /api/admin/venues/:venueId/slots/preview` | Review a proposed batch without creating slots. |
| `POST /api/admin/venues/:venueId/slots` | Confirm and atomically create the reviewed batch. |
| `PATCH /api/admin/venues/:venueId/slots/:slotId` | Edit, block, or unblock an unreserved future slot. |

GET endpoints support HEAD; all endpoints support OPTIONS and return an explicit
405 for unsupported methods. Admin reads use the same filters and pagination as
public reads.

Venue creation requires `name`, `address`, and `city`. Defaults are empty
description, `Asia/Kolkata`, `INR`, null image URL, and active. Images, if supplied,
must use HTTPS. The timezone must be recognized by the server's timezone data;
fixed numeric offsets are rejected. This assessment's writes support INR.
Timezone/currency cannot change after slots or bookings exist, avoiding silent
reinterpretation of schedules or prices. Venue/court edits are normal partial
updates; concurrent edits to the same field use the latest committed write.

Court creation requires `name` and `sport`; it defaults to active. Court names
are unique within a venue. Nested IDs are checked against the venue, preventing
accidental cross-venue modifications. The sport cannot change once a court has
slots: that would change the activity customers reviewed without changing slot
versions. Use a separate court for a different sport. Archiving preserves all history and does
not cancel existing reservations. Deletion endpoints are deliberately absent.

## Generation: preview, acknowledge, confirm

Example preview body, with real court UUIDs substituted:

```json
{
  "courtIds": ["court-uuid"],
  "startsAt": "2030-04-02T09:00:00+05:30",
  "endsAt": "2030-04-02T11:30:00+05:30",
  "priceMinor": 50000
}
```

The admin may supply `durationMinutes`; omitting it selects 60 minutes. The
example creates 09:00–10:00 and 10:00–11:00, leaving 11:00–11:30 unused. No partial
slot is created. The chosen price applies **per generated slot**, not per hour.

Inputs use minute-aligned ISO instants with `Z` or an explicit UTC offset. Local
timestamps without an offset are rejected. This makes overnight ranges and
repeated daylight-saving hours explicit; the future UI will convert venue-local
inputs to these instants. Durations measure elapsed minutes.

Guardrails bound one request to 1–20 distinct courts, a window of at most 26 hours
(including a 25-hour daylight-saving day), durations of 5–1440 minutes, and at
most 500 generated slots overall. The window must produce at least one full slot
per court. Admins may submit additional batches; these are request limits, not
limits on the venue's total schedule. Generation starts strictly in the future.

The preview returns the normalized plan, slots per court, total count, unused
period or null, conflicts (up to 50, plus `hasMoreConflicts`), `canGenerate`,
`previewToken`, and `previewExpiresAt`. Existing blocked slots also conflict.
An existing slot entirely inside the unused remainder does not conflict, because
that remainder creates no new availability.

The preview token expires after ten minutes and is signed using a separate
derived HMAC key. It binds the plan, admin identity, venue ID, timezone, and
currency. It is not an authentication credential or a database record. Changing
the duration, price, courts, or interval requires a new preview. Reordering courts
or expressing the same instant using a different offset preserves the plan.

Confirmation sends the same fields plus `previewToken`. If there is unused time,
it must also send `acknowledgeUnusedPeriod: true`; otherwise the API returns 422
with `UNUSED_PERIOD_ACKNOWLEDGEMENT_REQUIRED`. The UI must explicitly display the
unused period and collect this acknowledgement; it must not silently preselect it.

Confirmation rechecks the signature, expiry, current court/venue activity,
future start, and current conflicts. Shared parent locks prevent concurrent
archiving/timezone edits during creation. All new slots are inserted in one
transaction, without skipping conflicts. PostgreSQL's court/time exclusion
constraint handles the race where both requests initially observe an empty
range. The losing batch rolls back completely and returns `SLOT_OVERLAP` (409).
Adjacent `[start, end)` intervals remain valid.

Success returns 201 with `createdCount`, created slots (IDs and versions), timezone,
currency, and the acknowledged unused period. Generation is not an idempotent
replay API: retrying a committed batch returns an overlap conflict and cannot
duplicate slots. Reload the schedule after an uncertain response. Booking
checkout will implement its separately agreed idempotency contract.

## Slot edits and race protection

Send the slot's currently displayed `version` with one or more of `startsAt`,
`endsAt`, `priceMinor`, and `isBlocked`. An empty edit is rejected. Court/venue
identity cannot be reassigned through this endpoint.

The service locks the slot row, checks its version, and queries active
reservations after acquiring the lock. A stale version returns `STALE_SLOT` (409).
A real edit on a reserved slot returns `SLOT_RESERVED` (409); cancel its active
reservation through the upcoming cancellation API first. Past slots cannot be
edited. New intervals must remain valid, future, non-overlapping, and at most
26 hours long. The target court and venue must be active.

The existing database trigger increments the version only on real changes. A
no-op edit returns the same version without rewriting the row. PostgreSQL also
protects reserved details and overlap invariants, so other database writers
cannot bypass these checks. Cancellation history retains the old confirmed
price/time snapshots after an unreserved slot is edited. Known conflicts are
translated to safe API codes; lock/transaction contention returns a safe 503.
Admin transactions also set PostgreSQL lock and statement timeouts, so a blocked
query cannot retain locks indefinitely after the JavaScript deadline.

## Request limits and deployment

Public catalogue endpoints share 300 requests per minute per trusted network.
Admin management allows 120 requests per minute per admin; preview/confirmation
share a separate 20-per-minute generation limit per admin. Limits include failed
attempts and HEAD reads and use the shared PostgreSQL counters. OPTIONS and
unsupported methods are handled by the outer API layer before endpoint counters.

The existing `AUTH_CLIENT_IP_HEADER=none` default means all public callers share
the fallback network bucket. Configure the trusted ingress before production as
described in [authentication](authentication.md). The header setting is reused;
there is no second independently trusted proxy policy.

No schema changes or new migrations are needed. Existing venue, court, slot,
reservation, version, and rate-limit tables support these features. Install the
updated lockfile when working from a fresh checkout (`npm ci`).

## Code walkthrough

| File within `apps/web` | Responsibility |
| --- | --- |
| `src/app/api/venues/**/route.ts` | Public route declarations. |
| `src/app/api/admin/venues/**/route.ts` | Admin route declarations. |
| `src/server/venues/controller.ts` | Method dispatch, guards, rate limits, bounded bodies, query decoding, response status. |
| `src/server/venues/catalog.ts` | Active-resource filtering, discovery prices, pagination, availability snapshots. |
| `src/server/venues/admin.ts` | Venue/court writes, generation checks/transactions, safe slot editing. |
| `src/server/venues/schemas.ts` | Strict field validation, defaults, batch and pagination limits. |
| `src/server/venues/time.ts` | Calendar validation and timezone-aware day boundaries. |
| `src/server/venues/generation.ts` | Pure slot planning and signed preview verification. |
| `src/server/venues/database.ts` | Database time and safe translation of PostgreSQL/Prisma conflicts. |
| `src/server/venues/runtime.ts` | Lazy services using the shared database/configuration. |

Unit tests cover timezone boundaries, daylight saving, invalid dates, batch
limits, remainder calculation, and preview signatures. PostgreSQL tests exercise
discovery/availability, pagination, archiving, generation acknowledgement,
post-preview changes, concurrent empty-range generation, stale concurrent edits,
and reservation-history protection. The empty-range race uses a temporary trigger
only inside an isolated test schema to force the database conflict path.

```sh
npm run test:unit
npm run test:db
npm run typecheck
npm run build
```

Atomic multi-slot booking and customer/admin cancellation are now implemented;
see [booking and cancellation](bookings.md). The responsive UI is the next product
checkpoint.
