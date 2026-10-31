# Frontend walkthrough

Turfit now has responsive customer and admin interfaces connected to the existing
APIs. Discovery, selection, authentication, checkout, booking history,
cancellation, venue/court editing, and schedule management are usable together.
No new database migration or production JavaScript dependency is required.

## Run and populate it

Use your configured development PostgreSQL database:

```sh
npm ci
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. `db:seed` is optional: it creates three fictional
sample venues, two courts per venue, and seven days of future hourly slots. It
does not create customer/admin accounts or overwrite existing details,
reservations, or edited slot intervals. Fixed demo IDs and overlap checks make
it safe to rerun against a development database. It is disabled in production.
Skip it when populating real venues through the admin interface.

Create an admin using the existing `npm run auth:create-admin` command with the
temporary environment variables described in [authentication](authentication.md).
Then sign in normally and open **Manage venues**. Customer registration creates
a customer account and immediately signs it in. No credentials are hardcoded.

## Pages and user flow

| Page | Purpose |
| --- | --- |
| `/` | Venue cards, city search, sport filters, and pagination. |
| `/venues/:venueId` | Venue details, venue-local dates, court filters, availability, and selection. |
| `/login`, `/register` | Authentication with a validated internal return path. |
| `/checkout` | Review selected courts/dates/prices and confirm together. |
| `/bookings` | The current customer's paginated booking history. |
| `/bookings/:bookingId` | Confirmation/current details and partial cancellation. |
| `/admin` | Venue management and venue creation. |
| `/admin/venues/:venueId` | Venue/court editing, slot previews, generation, editing, and blocking. |
| `/admin/bookings`, `/admin/bookings/:bookingId` | Customer bookings and admin cancellation with a reason. |

Customers browse without signing in. Selection supports multiple courts and
dates in one venue. Choosing a different venue asks before replacing the current
selection. Signing in is required only at confirmation; an existing session
continues directly. The contact details shown at checkout come from the account.
No online payment is collected.

Unavailable slots are disabled and labelled, rather than relying on color alone.
Booking details show server-provided cancellation eligibility. Selecting several
items and confirming cancellation sends their booking-item IDs in one operation.
The customer sees the 12-hour rule; admin cancellation uses a required reason.

Public reads show active resources. Admin reads include archived resources.
Archiving is an explicit checkbox in the edit forms and preserves booking
history. Editing reserved or outdated slots still obeys the backend rules.

## Code structure

| Location in `apps/web/src` | Responsibility |
| --- | --- |
| `app/**/page.tsx` | Small Next.js route entries and page metadata. |
| `app/layout.tsx` | Providers, navigation, footer, and locally bundled font. |
| `components/site-shell.tsx`, `icon.tsx`, `ui.tsx` | Navigation, consistent icons, errors/loading/empty states, dialogs, and request hook. |
| `components/providers.tsx` | Current-session state and selected slots. |
| `components/venue-browser.tsx`, `venue-detail.tsx` | Public venue discovery, details, dates, and slot selection. |
| `components/auth-form.tsx` | Login/registration and return-to-checkout flow. |
| `components/checkout.tsx` | Review, confirmation, conflict feedback, and uncertain-result recovery. |
| `components/bookings.tsx` | Customer/admin history, details, and cancellation. |
| `components/admin.tsx`, `admin-forms.tsx`, `admin-slots.tsx` | Venue/court workspace, editing, preview, acknowledgement, and generation. |
| `client/api.ts` | Cookie-based API calls, CSRF, session recovery, safe errors. |
| `components/form-errors.tsx` | Shared inline errors, summaries, field associations, native validation, and focus management. |
| `client/form-errors.ts` | Expected input errors, local-parser field mapping, and safe form-error descriptions. |
| `client/contracts.ts` | Types derived from server service return values using erased type-only imports. |
| `client/cart.ts` | Selection persistence validation and totals. |
| `client/format.ts` | Money, dates, venue-local input conversion, and safe return URLs. |
| `app/globals.css` | Shared design tokens, component styles, responsive layouts, focus and reduced-motion behavior. |

The type-only imports do not bundle server code or credentials into the browser.
Pages render their layout without needing a live database at build time. Browser
components obtain actual data from the APIs and show errors/empty states when
data is unavailable; there is no hardcoded fallback venue inventory.

## Session and CSRF handling

Access and refresh credentials remain in HttpOnly cookies. Browser JavaScript
keeps only the public user and CSRF token in memory. Protected writes attach
`X-CSRF-Token`; the browser supplies the same-origin cookies and Origin header.

On startup the client reads `/api/auth/me`. An expired access cookie is recovered
using `/api/auth/csrf` and `/api/auth/refresh`. One shared promise coordinates
concurrent refreshes in a tab. Where supported, a Web Lock coordinates tabs;
after waiting, the client checks whether another tab has already refreshed.
The backend's bounded refresh recovery window remains the fallback.

An authenticated API call receiving 401 can refresh and retry once. That retry
preserves the original body and idempotency key. It does not automatically retry
booking writes after network/5xx errors. Login waits for startup session checks,
so a delayed anonymous response cannot overwrite a successful sign-in. A
BroadcastChannel announces session changes without transmitting credentials;
other tabs check the session again.
Protected page subtrees reset when the account ID changes, so the new account
does not retain the previous account's cached booking/admin views.

Customer/admin route gates improve the UI experience; the backend guards remain
the authorization boundary. Client state never grants permission by itself.

## Selection, consent, and uncertain responses

The selected venue, slots, reviewed prices/versions, and checkout key live in
`sessionStorage` for the current tab. They survive navigation, login, and reload.
No login token or CSRF token is stored there. If storage is unavailable, selection
works in memory but cannot survive a reload.

Changing the selection creates a new checkout key. Starting checkout records its
account ID and keeps the selection/key unchanged. On a known rejection, the UI
allows review and editing. A network/5xx failure leaves the outcome uncertain:
selection edits are disabled, the UI offers My Bookings, and retry uses the same
key even after reload. A successful result clears the selection and opens the
booking's current details. An account mismatch blocks retry until the correct
account is used.

Cancellation similarly retains its attempt key/body in the mounted detail page
when a response is uncertain. Retrying checks the same cancellation. Current
details are fetched again after success, rather than treating an old idempotency
receipt as the latest booking state.

## Admin dates, prices, and previews

Date/time fields are explicitly labelled with the venue timezone. Local inputs
are converted with Temporal using ambiguity rejection; they do not silently use
the administrator's computer timezone. The conversion library is loaded only
when needed. Price inputs convert decimal rupees into integer paise without
floating-point rounding.

Slot generation defaults to 60 minutes. The preview freezes the reviewed fields
until **Edit selection** is chosen. It shows generated counts, slot times,
conflicts, and any unused period. The unused-period acknowledgement is never
preselected. Confirmation sends the original reviewed input with its signed
preview. Expired or conflicting previews cannot create slots. A lost response
asks the admin to check the schedule before generating again.

Native dialogs provide focus trapping and Escape handling; an in-progress form
prevents dismissal. Form controls use labels, constraints, explicit disabled
states, and visible errors. Native smooth scrolling and restrained transitions
respect reduced-motion preferences. No scroll-interception library is added.

## Error presentation and recovery

Login, registration, venue/court creation and editing, slot preview/generation,
slot editing, checkout, and both cancellation flows share error presentation.
`useFormErrors` keeps the general message and field issues, maps API field names
to controls (for example, `durationMinutes` to `duration`), and groups indexed
array errors under their selection control. The controls keep their values.

`FormErrors` displays an alert with the specific issues and links back to the
affected controls. `FieldError` displays a message beside its control, which uses
`aria-invalid` and `aria-describedby`. After submission, focus moves to the first
invalid control in form order; errors without an editable field focus the summary.
Native required/type/range validation uses the same presentation. Editing a field
clears only its own errors and does not steal focus or erase other field errors.
Discovery and schedule filters also retain and display query validation details.

Backend validation uses fixed messages selected by approved codes for timezones,
password rules, time windows, and generation limits. Arbitrary custom validator
messages and submitted passwords are not reflected in responses. Local price and
time parsers distinguish expected input errors from unexpected runtime failures;
the latter retain a generic public message.

Recovery depends on the operation. Rate limits include the server's retry interval.
Unavailable slots offer updated availability; stale slot edits instruct the admin
to reopen current data. A lost booking/cancellation response keeps its original
idempotency key and body. An uncertain venue/court creation or slot-generation
response tells the admin to check the saved list/schedule before creating again.
No write is automatically retried because it failed validation or returned a 5xx.

The generation limits are per batch: 1–20 courts, at most 500 generated slots in
total, and at most 26 elapsed hours from Start to End. They do not cap the venue's
overall court count or stored schedule. Defaults and the requirement to explicitly
acknowledge unused time remain the same.

## Assets and verification

The hero uses an original generated decorative court image; it does not depict
any named venue. Real venue photos use the configured image URL. Missing or
failed images show a labelled court illustration. Manrope is bundled locally
with its license, so font loading needs no third-party request. See
[visual assets](visual-assets.md) for the saved asset and generation prompt.

```sh
npm run test:unit
npm run test:db
npm run typecheck
npm run build
```

Frontend unit tests cover money precision, timezone conversion, ambiguous times,
safe return URLs, and restoring checkout keys. Browser verification uses a
temporary PostgreSQL instance and a production build: discovery/filtering,
multi-date/court selection, sign-up return flow, checkout, cancellation,
cross-tab refresh, lost-response replay after reload, admin editing/generation,
and mobile navigation/layout. Desktop/mobile screenshots are retained locally
under `.local/screenshots` and are not application demo data.

The next release work is configuring the deployment database, trusted ingress,
HTTPS origin/secrets, and applying migrations before starting the production
application. The deployment itself has not been performed.
