# Local PostgreSQL: one database

Turfit's local Docker setup runs PostgreSQL 18 with one application database,
`turfit`. Application tables live in its `public` schema. Integration tests use
uniquely named temporary schemas inside that same database and remove only those
schemas afterward. No separate test database is created.

## First-time setup on Windows

Install/start Docker Desktop using its Linux/WSL2 engine. Once Docker Desktop
reports that the engine is running, execute these commands in PowerShell from
the repository root:

```powershell
npm ci
npm run db:configure-local
docker compose up -d --wait postgres
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. Seeding is optional and adds only the sample venues
and future slots; it creates no user accounts. Register through the UI for a
customer account. Admin provisioning is explained in [authentication](authentication.md).

`db:configure-local` creates/updates the root ignored `.env`, generates a local
database password, and writes matching connection strings. Both `DATABASE_URL`
and `TEST_DATABASE_URL` use `127.0.0.1:5432/turfit`. It preserves an existing
authentication signing secret and other settings. It refuses to overwrite
remote database URLs. Keep `.env` out of Git.

## Start, check, and stop

Start Docker Desktop after a computer restart, then:

```powershell
docker compose up -d --wait postgres
npm run dev
```

Check the database container:

```powershell
docker compose ps
npm run db:migrate:status
```

Stop the database when finished:

```powershell
docker compose stop postgres
```

The named volume preserves data when the container stops. The Compose service
binds only to loopback, uses password authentication, sets UTC, and includes a
readiness check. PostgreSQL 18's persistent volume is mounted at
`/var/lib/postgresql`, following the [official image documentation](https://hub.docker.com/_/postgres).
Initialization credentials apply when creating a fresh volume; editing `.env`
alone does not change the password of an already initialized database.

## Tests in the same database

```powershell
npm run test:db
```

Every test file creates its own random `turfit_test_...` schema. Test clients set
their search path to that schema, and cleanup validates the schema's generated
name before dropping it. Application rows in `public` are not truncated or
deleted. Shared-database testing is permitted only for the matching local
application database; a remote test target still requires a separately designated
test database. Production integration tests must not target a live customer
database.

## If seeding fails

1. Run `docker compose ps` and confirm PostgreSQL is healthy.
2. Run `npm run db:migrate:deploy` to create the application tables and constraints.
3. Run `npm run db:seed` again.
4. Restart an already running Next.js server after changing `.env`, because its
   validated configuration/database client is memoized.

If Docker commands report a missing engine/pipe, open Docker Desktop and finish
its Windows/WSL setup first. If port 5432 is occupied by another server, choose a
free `POSTGRES_PORT` in `.env` and rerun `db:configure-local` before first startup.
