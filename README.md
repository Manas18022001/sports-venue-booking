# Sports venue booking

Turfit full-stack assessment. This first milestone implements the PostgreSQL data
model, migrations, a typed database client, and database integration tests.

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
```

`TEST_DATABASE_URL` must point to a dedicated database whose name contains
`test`. Tests create a uniquely named schema and remove only that schema after
completion; they do not truncate existing application tables. PostgreSQL must
allow the test account to create schemas and install `btree_gist` if absent.

## Commands

| Command | Purpose |
| --- | --- |
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
[`schema.prisma`](apps/api/prisma/schema.prisma), followed by the SQL migrations.
Database tests live in `apps/api/test/database`.

The HTTP API, JWT flows, middleware, UI, and deployment are subsequent milestones.
The database layer alone does not implement authentication or the cancellation policy.
