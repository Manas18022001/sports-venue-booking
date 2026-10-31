# Booking and cancellation

These checkpoints complete the assessment's booking, My Bookings, admin booking
views, and cancellation APIs. They reuse the existing authentication, CSRF,
validation, logging, PostgreSQL tables, and constraints. No migration, payment
flow, temporary basket hold, or additional infrastructure service is added.

## Endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /api/bookings` | Atomically reserve the reviewed selection. |
| `GET /api/bookings` | Paginated summaries of the current user's bookings. |
| `GET /api/bookings/:bookingId` | The current user's booking with item snapshots. |
| `POST /api/bookings/:bookingId/cancel` | Cancel selected items using customer rules. |
| `GET /api/admin/bookings` | Paginated booking summaries across customers. |
| `GET /api/admin/bookings/:bookingId` | Admin details with admin cancellation eligibility. |
| `POST /api/admin/bookings/:bookingId/cancel` | Cancel selected upcoming items with a reason. |

Reads support HEAD; all routes support OPTIONS and return 405 for unsupported
methods. Every functional endpoint requires a live login session. Admin routes
also require the current database role to be ADMIN. Customer routes always scope
to the current user, even when that user's role is ADMIN. Accessing another
customer's booking through a customer route returns 404.

All POST requests require `Content-Type: application/json`, the configured
`Origin`, `X-CSRF-Token`, and a UUID `Idempotency-Key`. The existing success/error
envelopes and `private, no-store` cache policy apply. A successful checkout also
returns `Location: /api/bookings/:bookingId`.

## Checkout and reviewed prices

Example body; substitute actual IDs, versions, and prices from availability:

```json
{
  "venueId": "venue-uuid",
  "currency": "INR",
  "items": [
    { "slotId": "slot-uuid", "version": 1, "priceMinor": 50000 }
  ]
}
```

The booking uses the authenticated account's current name and email as contact
snapshots. Client-supplied user IDs, customer identities, totals, or roles are
rejected. The server decides the actual price; the submitted price/version are
the customer's reviewed values, which must match. Currency must match the venue.

Selections can contain arbitrary dates and courts within one venue. No
consecutive-time or same-court requirement exists. Duplicate slot IDs, including
case variations, are rejected. A request supports up to 500 slots as a bounded
batch; this is not a limit on a customer's total bookings.

## Why competing requests cannot double-book

One Read Committed transaction performs the operation:

1. Lock/check the actor's user and session, including activation and expiry.
2. Coordinate the user's operation/idempotency key and return a prior result if
   this is a retry.
3. Lock every selected slot in ascending immutable ID order.
4. Hold shared court/venue locks so resource edits cannot race validation.
5. After obtaining locks, read database time and recheck active reservations,
   resource activity, future starts, blocking, versions, prices, and currency.
6. Create one booking and all immutable reservation snapshots, then save the
   successful response/idempotency record in the same transaction.

If another request commits first, the waiting request sees its reservation after
acquiring the slot lock and rejects the whole selection with `SLOT_UNAVAILABLE`
(409). The partial unique database index on RESERVED slot items is the final
protection. No empty booking or partially reserved selection is committed.

For the database behavior behind this protocol, see PostgreSQL's documentation
on [row/advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html)
and [transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html).

Price/version/currency mismatches return `BOOKING_REVIEW_REQUIRED` (409). The
frontend should reload availability and ask the customer to review the selection
again. Missing, blocked, past, reserved, or inactive resources cannot be booked.
Mixed venues return 422.

PostgreSQL lock/statement deadlines bound waits. Deadlocks or serialization
failures that prove a rollback receive at most two automatic retries. Connection
or uncertain commit failures are not automatically retried. The client can retry
the same logical request using the same idempotency key. Exhausted contention
returns a safe 503.

## Idempotency and lost responses

Generate one key for one intended checkout or cancellation and keep it across
network retries. Do not generate a new key on every fetch attempt. A deliberately
changed selection should use a new key.

Keys are scoped to the authenticated user and operation. Equivalent
selection order and UUID case are normalized. A transaction-scoped PostgreSQL
advisory lock coordinates simultaneous attempts; no separately committed pending
record can become stranded. Only successful results are recorded.

The same key and normalized body return the original response data and HTTP
status, with `Idempotency-Replayed: true`. Reusing the key with different values
returns `IDEMPOTENCY_KEY_REUSED` (409). Failed validation or rolled-back operations
do not consume the key. Fresh successful mutations return
`Idempotency-Replayed: false`. Each HTTP attempt still gets a new request ID.

A replay is a receipt of the original operation, not a fresh booking query. If
the booking was subsequently cancelled, replaying its creation still returns the
original confirmation. Fetch the detail endpoint for current state. Authentication
is checked before replay, so revoked sessions or disabled accounts cannot retrieve
old results. Admin replays still require the current admin role.

Stored responses include booking/contact snapshots, but never passwords, login
credentials, CSRF tokens, cookies, or request IDs. Idempotency records remain with
booking history rather than expiring and allowing a late retry to create a new
booking.

## Cancellation rules

Customer body:

```json
{ "itemIds": ["booking-item-uuid"] }
```

Admin body adds a required nonblank reason:

```json
{ "itemIds": ["booking-item-uuid"], "reason": "Court maintenance" }
```

Use booking-item IDs from the booking detail, not availability slot IDs. Every
selected item must belong to that booking. Customers may cancel only their own
items, strictly more than 12 hours before the start. Exactly 12 hours is too late.
Admins bypass that cutoff through the admin endpoint, but the reservation must
still be upcoming. Started and completed reservations cannot be cancelled.

Cancellation locks the selected slots in the same ascending order as checkout,
then locks the booking header to coordinate partial cancellations of its other
items. The service re-reads state and database time after waiting for locks. If
one active selected item is ineligible, none of the selected items is cancelled.
The customer can instead submit only their eligible items.

Cancellation changes reservation status and records when, who, source, and admin
reason. It never deletes history or rewrites original times/prices. Already
cancelled items are harmless no-ops, retaining their original cancellation
metadata; a new request cannot overwrite the reason or actor. The response and
idempotency record are committed atomically with the cancellation.

A cancelled future slot becomes available again if it remains active and
unblocked. A later booking creates a new reservation row. There is no independent
"available" flag to synchronize and no refund logic because payments are outside
this assessment.

## Booking views and frontend use

Lists default to 20 summaries, maximum 50, sorted by creation time and ID newest
first. Pass `nextCursor` as `cursor` while preserving filters; null means the end.
Admin lists optionally accept `venueId`, including archived venues. Customer
identity cannot be overridden through query parameters.

Details contain venue information, contact snapshots, currency, original item
snapshots, cancellation metadata, and a database `asOf` time. Venue information
reflects the current venue; confirmed court/sport/time/price values come from
immutable reservation snapshots. Cancellation actor IDs are kept internally.

Status is derived as CONFIRMED, PARTIALLY_CANCELLED, or CANCELLED. Time state is
UPCOMING, IN_PROGRESS, or COMPLETED for uncancelled items. Original, cancelled,
and remaining totals are calculated from item prices. "Remaining" means
uncancelled value, including completed items; it is not a payment/refund balance.
Lists expose summaries and the next upcoming start; details supply all items.

Each item exposes `canCancel` and `cancellationDeadline` for the current endpoint's
customer/admin policy. These help render the UI; the write endpoint always
rechecks the rule against fresh server time. Refetch details after cancellation
and availability after booking/cancellation. An already logged-in customer uses
the existing session and does not sign in again during checkout.

Read endpoints share 120 requests/minute per user; checkout/cancellation share
30 writes/minute per user, including failed attempts and retries. These use the
existing shared PostgreSQL limiter. The upcoming frontend should preserve the
selection while login/refresh is needed, coordinate retries, and avoid repeatedly
submitting a known validation/conflict response.

## Code and verification

| File within `apps/web` | Responsibility |
| --- | --- |
| `src/app/api/bookings/**/route.ts`, `src/app/api/admin/bookings/**/route.ts` | Customer/admin route declarations. |
| `src/server/bookings/controller.ts` | Auth/CSRF boundary, rate limits, bounded input, keys, HTTP responses. |
| `src/server/bookings/service.ts` | Checkout, booking reads, cancellation, ownership, and lock ordering. |
| `src/server/bookings/schemas.ts` | Strict selection/cancellation validation and canonicalization. |
| `src/server/bookings/idempotency.ts` | Advisory coordination and same-transaction response persistence/replay. |
| `src/server/bookings/presentation.ts` | Public snapshots, derived statuses/totals, and cancellation eligibility. |
| `src/server/bookings/runtime.ts` | Lazy application service. |
| `src/server/database-operations.ts` | Shared database time, transaction deadlines, bounded retries, safe errors. |

Venue admin writes reuse the shared transaction helper; their existing API
contracts remain unchanged. Unit tests cover strict cutoff boundaries, request
normalization, and derived presentation. PostgreSQL tests cover competing
selections, concurrent idempotent retries, rollback, ownership, partial
cancellation, rebooking, and crossing the cutoff while waiting for a lock.

```sh
npm run test:unit
npm run test:db
npm run typecheck
npm run build
```

No schema/migration change is needed. The responsive customer/admin frontend is
implemented; see [the frontend walkthrough](frontend.md). Deployment is the next
release step.
