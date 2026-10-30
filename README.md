# Turfit

Sports venue booking built with Next.js App Router, TypeScript, Prisma, and
PostgreSQL. The current milestone integrates the existing database layer into
the Next.js application, with a minimal home page and database integration tests.

## Application structure

The full-stack application lives in `apps/web`, using the workspace name
`@turfit/web`. The former `apps/api` database code has moved here; its schema and
applied migration contents are unchanged.

- `src/app`: Next.js pages and layouts; Route Handlers will be added here later.
- `src/database/client.ts`: testable database client factory for server code and CLI tools.
- `src/server/database.ts`: server-only, lazy database access with one client per
  process, reused across development hot reloads.
- `prisma`: data models and the existing SQL migration history.
- `test/database`: the existing PostgreSQL constraint and concurrency tests.

The database test command also checks that the server-only client is reused and
can query PostgreSQL. It enables Node's `react-server` condition so the
`server-only` marker works outside the Next.js test runtime.

Server Components and future Route Handlers should import `getDatabase()` from
`src/server/database.ts`. Database queries execute in the Node.js runtime.
Client Components must never import database code. Do not disconnect the shared
client after individual HTTP requests.

## Requirements

- Node.js 24.11+ on the 24.x line and npm 11+.
- PostgreSQL 18 with the `btree_gist` extension available.
- Separate development and test databases. Migration credentials need permission
  to install `btree_gist`; the future runtime account should have narrower privileges.

Prisma is pinned to **7.10.1**. At implementation time Prisma 8's `latest` tag is
a release candidate with a different migration API; do not upgrade it implicitly.

## Setup

1. Copy `.env.example` to `.env` and replace the development connection strings.
2. Create the `turfit` and `turfit_test` databases using your PostgreSQL installation.
3. From the repository root, run:

```sh
npm ci
npm run db:validate
npm run db:generate
npm run db:migrate:deploy
npm run typecheck
npm run test:db
npm run dev
```

Open [localhost:3000](http://localhost:3000). Both Next.js and Prisma load environment
files from the repository root. Environment variables supplied by the host take
precedence. The home page does not access the database during build or requests.

For a local production build:

```sh
npm run build
npm run start
```

The build generates the Prisma client before compiling Next.js. It does not
apply migrations; deploy migrations as a separate release step before serving
application code that depends on them.

`TEST_DATABASE_URL` must point to a dedicated database whose name contains
`test`. Tests create a uniquely named schema and remove only that schema after
completion; they do not truncate existing application tables. PostgreSQL must
allow the test account to create schemas and install `btree_gist` if absent.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Generate Prisma Client and build Next.js for production. |
| `npm run start` | Serve the completed production build. |
| `npm run db:format` | Format the Prisma models. |
| `npm run db:validate` | Validate the Prisma schema. |
| `npm run db:generate` | Generate the ignored, typed database client. |
| `npm run db:migrate:dev -- --name change_name` | Draft a migration for review. |
| `npm run db:migrate:deploy` | Apply checked-in migrations. |
| `npm run db:migrate:status` | Inspect migration status. |
| `npm run typecheck` | Check database code and integration tests. |
| `npm run test:db` | Exercise constraints and races using real PostgreSQL connections. |

Inspect each generated migration and preserve the SQL constraints and triggers.
**Do not use `prisma db push`: the Prisma schema alone cannot recreate all protections.**

## Read the model

Start with [the model guide](docs/data-model.md), then
[`schema.prisma`](apps/web/prisma/schema.prisma), followed by the SQL migrations.
Database tests live in `apps/web/test/database`.

Validated server configuration and shared API infrastructure are the next two
separate checkpoints. Authentication, booking services, and the product UI follow
those. The database layer alone does not implement authentication or the
12-hour cancellation policy.
