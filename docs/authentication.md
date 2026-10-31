# Authentication

Turfit uses short-lived access JWTs and database-backed sessions with rotating
refresh credentials. Both credentials travel in HttpOnly cookies. Browser
JavaScript receives the public user and a session-bound CSRF token, never the
access or refresh credential. The browser flow is documented in
[the frontend walkthrough](frontend.md).

## 1. Registration and password storage

`POST /api/auth/register` accepts exactly `name`, `email`, and `password`.
Names and emails are trimmed; emails are lowercased. Passwords are preserved
exactly, including spaces. New users are always customers; sending `role` is a
validation error. The unique database email constraint settles registration races.

Passwords require 15–128 Unicode code points, at most 512 UTF-8 bytes. A small
local denylist rejects a few obvious passwords; it is not a comprehensive
compromised-password screening service. Argon2id uses a random salt, 19 MiB
memory, two iterations, and parallelism one. These parameters follow the
[OWASP password storage baseline](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Benchmark them on the deployment host before increasing the work factor.

The password is hashed before opening a transaction. The user, session, and first
refresh-token hash are then created atomically. Registration signs the user in
immediately. Duplicate email returns a generic 409 conflict.

## 2. Login and access tokens

`POST /api/auth/login` accepts exactly `email` and `password`. Unknown email,
incorrect password, and disabled account return the same 401 credential error.
Unknown accounts still perform an Argon2 verification against a dummy hash.

Successful login creates an independent session. Its access JWT lasts 15 minutes
by default and contains `sub` (user ID), `sid` (session ID), `jti`, `iat`, `exp`,
issuer `turfit`, and audience `turfit-api`. Signing uses HS256 through `jose`;
verification explicitly restricts the algorithm, token type, issuer, audience,
claims, and lifetime. JWT payloads are signed, not encrypted, so they contain no
password, email, or other profile data.

Access JWTs do not need a database table: their signatures prove who issued them.
However, each protected request also checks the session and current user in
PostgreSQL. Logout and account deactivation therefore invalidate access
immediately; role changes apply on the next check. This deliberately trades one
database read per protected request for immediate revocation and current roles.

## 3. Refresh, retry recovery, and logout

The absolute session lifetime defaults to seven days. Refresh does not extend
that deadline. PostgreSQL stores only SHA-256 refresh-credential hashes and
retains consumed records to detect replay.

`POST /api/auth/refresh` accepts `{}` and requires `X-CSRF-Token`. The service locks
the user and session, checks the account/session/token, consumes the old token,
and inserts its successor in one transaction. The existing partial unique index
allows only one unconsumed credential per session.

Two requests can arrive with the same refresh cookie, or the response can be
lost after committing. A five-second retry window returns the current successor
instead of revoking the session. The successor is recoverable using a keyed HMAC
of random token/session IDs; plaintext credentials are never stored. HKDF derives
separate keys for JWT signing, refresh credentials, CSRF, and rate-limit keys.

This is a bounded security tradeoff: reuse with valid CSRF inside the window is
treated as a retry. After the window, replay revokes the entire session. The
transaction commits that revocation before the service returns 401. Revoking and
then throwing inside the transaction would accidentally roll the revocation back.
The future browser client should still coordinate refreshes across requests/tabs
and retry the original request at most once after successful refresh.

`POST /api/auth/logout` accepts `{}`, requires valid CSRF for an active session,
revokes that session, and clears both cookies. Retrying logout succeeds. Other
devices' sessions are unaffected. A refresh 401 also clears cookies; an expired
access-token 401 from `/me` leaves the refresh cookie available for recovery.

## 4. Cookies, CSRF, authorization, and rate limits

For an HTTPS `APP_ORIGIN`, cookies are `__Host-turfit_access` and
`__Host-turfit_refresh`, with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and
no `Domain`. HTTP development/loopback uses unprefixed cookies without `Secure`.
The configured public origin, rather than an untrusted request header, controls
this choice. Remote production origins require HTTPS.

Every write requires the exact configured `Origin` and rejects cross-site fetch
metadata. Authenticated writes also require the session-bound `X-CSRF-Token`.
Registration/login use origin protection because no session exists yet.
`GET /api/auth/csrf` bootstraps CSRF from a valid refresh cookie after reload or
access expiry; it does not rotate credentials. Responses are never cached and
credentialed CORS is not enabled. CSRF belongs in client memory, not in URLs.
This follows the layered approach in the
[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

`requireAuth(request)` validates the access cookie, session, active user, and CSRF
for writes. `requireAdmin(request)` additionally checks the current database role.
`assertOwner(principal, ownerId)` enforces ownership; an admin bypass requires an
explicit third argument of `true`. Future protected Route Handlers must use these
guards inside `withApiHandler`; middleware alone is not an authorization boundary.

Shared PostgreSQL counters use atomic UPSERTs, so limits apply across application
instances. A database failure fails closed with 503 rather than bypassing limits.
Keys are HMACs; raw emails and IP addresses are not stored in counter rows.
Expired counters are pruned in small opportunistic batches.

| Scope | Limit |
| --- | --- |
| Registration per network | 20 attempts / 15 minutes |
| Login per network | 50 attempts / 15 minutes |
| Login per normalized email | 10 attempts / 15 minutes |
| Other auth operations, each per network | 180 attempts / minute |
| Refresh per session | 60 attempts / minute |

Counters include successes, failures, and retries. Exceeding a limit returns 429
with `Retry-After`. Account limits intentionally apply to unknown addresses too.
These are fixed windows, not sliding-window or IP reputation protections.

`AUTH_CLIENT_IP_HEADER=none` is the safe default: requests share a conservative
network bucket. In production, configure one supported header only after the
trusted ingress overwrites it with a single verified IP and prevents direct
access to the origin. Never trust arbitrary client-supplied forwarded headers.
Missing, malformed, or multi-hop values share the fallback bucket. Configure
ingress connection/request limits as well; application counters do not replace
protection before a request reaches Next.js.

## Endpoint contract

All responses use the existing `{ data, meta }` / `{ error, meta }` envelopes.
All POST bodies require JSON and the configured Origin.

| Endpoint | Input | Success |
| --- | --- | --- |
| `POST /api/auth/register` | `{ name, email, password }` | 201, public session + cookies |
| `POST /api/auth/login` | `{ email, password }` | 200, public session + cookies |
| `GET /api/auth/me` | Access cookie | 200, user, CSRF, session expiry |
| `GET /api/auth/csrf` | Refresh cookie | 200, CSRF token |
| `POST /api/auth/refresh` | `{}`, refresh cookie, CSRF header | 200, public session + rotated cookies |
| `POST /api/auth/logout` | `{}`, session cookie, CSRF header | 200, `{ signedOut: true }` + cleared cookies |

Public session data contains `user: { id, name, email, role }`, `csrfToken`,
`accessExpiresAt`, and `sessionExpiresAt`. GET routes also support bodyless HEAD;
all routes provide OPTIONS and return 405 for unsupported methods.

## Setup and admin provisioning

Install dependencies, generate the client, and apply the new counter migration:

```sh
npm ci
npm run db:generate
npm run db:migrate:deploy
```

`AUTH_SECRET` is required: generate 32 random bytes as a 64-character hexadecimal
value and store it in the root ignored `.env` or the deployment secret manager.
For example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
generates a value locally. Do not commit it, put it in a `NEXT_PUBLIC_` variable,
or share it in logs. All instances must use the same secret. Restart after
configuration changes. Rotating this key invalidates all existing credentials
and CSRF tokens; this implementation does not offer overlapping signing keys.

There is no public admin registration endpoint. Set `TURFIT_ADMIN_NAME`,
`TURFIT_ADMIN_EMAIL`, and `TURFIT_ADMIN_PASSWORD` temporarily in your shell, then
run `npm run auth:create-admin`. Use the same password policy as registration.
Remove these shell variables afterward. The command creates a new admin account;
it never promotes or overwrites an existing account. The maintenance command
requires development tooling (`tsx`) and direct authorized database access.

The SQL migration adds only `rate_limit_buckets`; the existing user/session/token
tables already model authentication. Historical migrations are unchanged.

## Code walkthrough and checks

| File under `apps/web` | Responsibility |
| --- | --- |
| `src/app/api/auth/*/route.ts` | Declare Node runtime and delegate HTTP methods. |
| `src/server/auth/controller.ts` | Network limits, bounded JSON, responses, cookie issuance/clearing. |
| `src/server/auth/schemas.ts` | Strict registration/login validation and normalization. |
| `src/server/auth/passwords.ts` | Argon2 hashing, verification, unknown-user dummy work. |
| `src/server/auth/crypto.ts` | Key separation, JWTs, credential hashes, CSRF. |
| `src/server/auth/cookies.ts` | Cookie policy, duplicate rejection, matching clearing attributes. |
| `src/server/auth/service.ts` | Transactions, session lifecycle, role/ownership checks. |
| `src/server/auth/rate-limit.ts` | Trusted network extraction and shared atomic counters. |
| `src/server/auth/runtime.ts` | Lazy application service and exported route guards. |
| `src/server/auth/options.ts` | Defaults and supported ingress headers. |
| `scripts/create-admin.ts` | Explicit, local admin provisioning. |
| `test/unit/auth-crypto.test.ts` | Passwords, claims, cookies, CSRF, network trust, configuration. |
| `test/database/auth.test.ts` | Real transactions, refresh races/replay, authorization, rate counters. |

```sh
npm run test:unit
npm run test:db
npm run typecheck
npm run build
```

Tests use a public test-only key, never the application's `.env` signing key.
PostgreSQL tests create and remove their own isolated schemas. Auth logs retain
only the existing safe request metadata; passwords, cookies, tokens, and request
bodies are excluded.

Booking, availability, and admin management APIs now use these guards. Browser
auth forms and the responsive product UI are implemented. Password
reset, email verification, MFA, and device-management screens are outside this
assessment's agreed scope. Do not represent this milestone as an implementation
of those account lifecycle features.
