# Shared API infrastructure

This checkpoint adds reusable HTTP handling, bounded JSON input, validation,
metadata-only structured logs, response headers, and a public liveness endpoint.
Authentication builds on this layer; its implementation is described in the
[authentication guide](authentication.md). Booking business operations follow.

## Structure

| File within `apps/web` | Responsibility |
| --- | --- |
| `src/server/api/handler.ts` | Correlation, method checks, limits, origin checks, error handling, headers, and completion logging. |
| `src/server/api/body.ts` | Read bounded UTF-8 JSON streams with a read deadline. |
| `src/server/api/validation.ts` | Validate bodies/queries with Zod and sanitize public field issues. |
| `src/server/api/errors.ts` | Fixed public error codes, messages, statuses, and retry guidance. |
| `src/server/api/logger.ts` | Pino-backed logging through an explicit field allowlist. |
| `src/server/api/options.ts` | Shared limits, log levels, and types used by runtime and configuration. |
| `security-headers.mjs` | Shared response-header policy used by Next.js and API handling. |
| `src/app/api/health/route.ts` | Node.js process liveness using the common handler. |
| `src/app/api/[[...path]]/route.ts` | JSON not-found handling for unmatched API paths. |

## Request lifecycle

1. Obtain validated configuration and the logger.
2. Generate a server-owned UUID request ID; never trust a client-supplied ID.
3. Check the route's supported methods, URL size, and declared body length.
4. For writes, check the configured origin and cross-site fetch metadata.
5. Execute the route; its `context.readJson(schema)` validates bounded JSON.
6. Return a success envelope or translate an exception into a safe error.
7. Attach correlation/security headers and `Cache-Control: private, no-store`.
8. Record completion using allowed metadata fields only.

For dynamic routes, a typed route context can be supplied as the handler's third
argument. Keep controllers thin and business rules inside server services.

## Response contract

Success:

```json
{
  "data": { "status": "ok" },
  "meta": { "requestId": "server-generated-uuid" }
}
```

Failure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the highlighted fields.",
    "issues": [{ "field": "email", "message": "This field has an invalid format." }]
  },
  "meta": { "requestId": "server-generated-uuid" }
}
```

`X-Request-Id` matches the body ID and request log. `HEAD` and `204` responses
have no body. Automatic `OPTIONS` returns `Allow` but does not enable CORS.
Known errors preserve their defined status. Unexpected exceptions become a
generic 500; their messages/stacks are not exposed or automatically logged.
Field issues are bounded and use fixed messages, not raw Zod/custom messages.

| Status | Typical meaning |
| --- | --- |
| 400 | Malformed JSON, invalid lengths, ambiguous duplicate query parameters. |
| 401 / 403 | Authentication required / forbidden request. |
| 404 / 405 | Unknown resource / unsupported method. |
| 408 | Body read deadline exceeded. |
| 409 | Resource conflict. |
| 413 / 414 / 415 | Body too large / URL too long / unsupported media type. |
| 422 | Input validation failure. |
| 429 | Rate limit response, with validated `Retry-After` when provided. |
| 500 / 503 | Unexpected failure / temporary service unavailability. |

## JSON input

The reader requires `application/json`, permits UTF-8, and rejects compressed
content. It rejects oversized declarations early and also counts actual streamed
bytes, including when `Content-Length` is missing or understated. Declared and
actual lengths must agree. Empty, malformed, invalid-UTF-8, consumed, and aborted
bodies fail safely. Slow bodies time out and their streams are cancelled.

Apply matching ingress limits/timeouts at deployment: application checks do not
replace limits on connections, headers, and buffering before requests reach Next.js.

## Origin checks and authentication boundary

Configure `APP_ORIGIN` to the exact public browser origin (scheme, host, port).
Never derive it from `Host` or forwarded headers. Unsafe methods require a
matching `Origin` header and reject `Sec-Fetch-Site: cross-site`. Scripts calling
write endpoints must also send the configured Origin. Reads need no Origin.
No credentialed cross-origin API access is enabled.

Origin validation is a defense-in-depth component. The auth endpoints now add
session-bound CSRF, JWT/session validation, role and ownership guards, and shared
PostgreSQL rate limits. See [authentication](authentication.md) for the actual
endpoint limits and how future protected handlers must use the route guards.

## Logging

Pino emits JSON to stdout with `service`, `time`, numeric severity, request ID,
static operation name, normalized method, status, duration, and optional safe
error code. Success uses info, 4xx uses warn, and 5xx uses error.

The logger explicitly selects fields rather than serializing request/error
objects. Bodies, cookies, authorization headers, raw URLs/query strings, and
arbitrary exception messages are excluded. Common secret-field redaction is an
additional safeguard. Request IDs are generated per HTTP attempt; they are
separate from idempotency keys.

A failing log sink does not change an already completed operation's response.
Business services should add only deliberate, sanitized diagnostics; this
request logger is not a general exception dump or tracing system.

## Response headers

All application routes receive `nosniff`, frame denial, a referrer policy,
camera/microphone/geolocation restrictions, and CSP directives for framing,
base URLs, and embedded objects. Production adds HSTS for the current host,
without automatically including subdomains or requesting preload.

The current CSP does not restrict script sources. A complete script policy
depends on the finished UI and Next.js nonce requirements; these initial
directives should not be described as complete XSS protection.

## Health endpoint

`GET /api/health` returns 200 and `{ status: "ok" }` in the success envelope.
`HEAD` is bodyless; `OPTIONS` returns 204; unsupported write methods return 405.
It is dynamic, non-cacheable process liveness only, with no database query,
credentials, deployment details, or dependency version disclosure.

## Checks

```sh
npm run test:unit
npm run typecheck
npm run build
npm run start
```

Unit tests exercise streaming limits, timeouts, input redaction, error/status
mapping, origin checks, correlation, method handling, logging, and configuration.
The separate PostgreSQL suite continues to verify database invariants.
