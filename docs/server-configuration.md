# Validated server configuration

This checkpoint centralizes the settings currently consumed by Turfit's Next.js
server and PostgreSQL client. Configuration changes alone require no migration;
authentication separately adds a migration for shared rate-limit counters.

## Files and responsibilities

| File within `apps/web` | Responsibility |
| --- | --- |
| `src/database/pool-options.ts` | Shared pool defaults and their TypeScript contract. |
| `environment.mjs` | Canonical root environment loading shared by Next.js and the preflight script. |
| `scripts/check-config.ts` | Exit before starting development/build/production commands when settings are invalid. |
| `src/server/config/schema.ts` | Pure validation and conversion into an immutable typed configuration. |
| `src/server/config/index.ts` | Server-only access to one validated configuration snapshot. |
| `src/instrumentation.ts` | Validate before a Node.js server instance handles requests. |
| `src/database/client.ts` | Pass pool options to the PostgreSQL adapter. |
| `src/server/database.ts` | Create/reuse the application client using validated settings. |
| `test/unit` | Validate boundaries, defaults, credential redaction, immutability, and startup registration without a database. |

## Settings

| Variable | Default | Accepted values |
| --- | --- | --- |
| `NODE_ENV` | `development` when absent | `development`, `test`, `production`; normally set by Next.js. |
| `DATABASE_URL` | Required | `postgresql://` or `postgres://`, with a host and database name and no URL fragment. |
| `DATABASE_POOL_MAX` | `10` | Whole decimal number from 1 to 100. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` | Whole decimal number from 1 to 60000 milliseconds. |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | Whole decimal number from 1 to 600000 milliseconds. |
| `APP_ORIGIN` | `http://localhost:3000` | Exact HTTP(S) origin; remote production origins require HTTPS. |
| `API_MAX_BODY_BYTES` | `65536` | Whole decimal number from 1 to 1048576 bytes. |
| `API_MAX_URL_BYTES` | `8192` | Whole decimal number from 1 to 65536 bytes. |
| `API_BODY_TIMEOUT_MS` | `10000` | Whole decimal number from 1 to 60000 milliseconds. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `AUTH_SECRET` | Required | Random 32-byte key encoded as 64 hexadecimal characters; repeated placeholders rejected. |
| `AUTH_ACCESS_TTL_SECONDS` | `900` | Whole decimal number from 1 to 3600. |
| `AUTH_SESSION_TTL_SECONDS` | `604800` | Whole decimal number from 1 to 2592000; must exceed access lifetime. |
| `AUTH_REFRESH_RETRY_SECONDS` | `5` | Whole decimal number from 1 to 10. |
| `AUTH_CLIENT_IP_HEADER` | `none` | `none`, `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`; requires a trusted ingress when enabled. |

An absent optional setting uses its default. A present but empty or invalid
setting fails validation. Decimal fractions, scientific notation, hexadecimal,
zero, negative numbers, and units such as `5s` are rejected for numeric settings.

The numeric upper bounds are application configuration guardrails, not claimed
PostgreSQL limits. Pool size applies per application instance. Choose a value
that fits the database connection budget across every running instance.
Connection timeout limits establishing/acquiring connections; idle timeout
controls retiring idle connections. Neither is a query execution timeout.

## Loading and validation

`environment.mjs` uses Next.js environment-file loading from the repository root;
host-supplied environment variables retain precedence. It forces a root scan to
replace any earlier cached scan of the application directory. Next.js calls this
loader through `next.config.mjs`. Prisma CLI loading remains in `prisma.config.ts`.
The parser itself loads no files and opens no connections.

The npm `dev`, `build`, and `start` commands first run `scripts/check-config.ts`
using Node.js 24's native TypeScript support, with the correct development or
production mode. Invalid settings produce sanitized messages and exit code 1,
so the subsequent command never starts. This preflight uses runtime dependencies
only; it does not require tsx or generated database code.

`register()` in `src/instrumentation.ts` invokes `getServerConfig()` for the
Node.js runtime before that server instance handles requests. Database access
also obtains configuration through that accessor. This retains validation when
the app is started by a hosting platform without our npm preflight. Always use
the documented npm commands for immediate process failure on invalid settings.

Successful parsing returns a frozen configuration object, including frozen
database and pool objects. The accessor memoizes it. Restart the application
after changing deployment settings so the configuration and pool are recreated.
Development hot reloads continue to reuse the process-level database client.

Configuration validation checks syntax and bounds. It does not prove database
reachability or credentials and does not connect during build/startup. The
PostgreSQL integration suite verifies actual connectivity separately.

## Security

These variables are server-side settings. Never give credentials a `NEXT_PUBLIC_`
prefix, export them through Next.js `env` configuration, log the complete config,
or return it in an API response. The accessor imports `server-only` to prevent
accidental use in Client Components. The pure schema receives explicit input and
does not read environment variables at module scope.

`ServerConfigurationError` retains only sanitized issue descriptions; it does
not retain the source object or the original validation error as a cause.
The parser performs no network calls or TLS configuration changes.

## Checks

```sh
npm run test:unit
npm run typecheck
npm run build
npm run test:db
```

Unit tests require no PostgreSQL server. Integration tests use the separate
`TEST_DATABASE_URL`. The existing database factory still supports a connection
string alone, using the same shared defaults, for command-line utilities.

Configure `APP_ORIGIN` when changing the development port or deploying. A trailing
slash is normalized away; credentials, paths, query strings, and fragments are
rejected. HTTP loopback origins remain available for local production testing.

See [API infrastructure](api-infrastructure.md) for logging, HTTP errors, input
limits, and origin checks. See [authentication](authentication.md) for session
lifetimes, secret management, CSRF, and trusted proxy configuration.
