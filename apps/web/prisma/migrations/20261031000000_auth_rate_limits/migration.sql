BEGIN;

CREATE TABLE "rate_limit_buckets" (
  "key_hash" CHAR(64) NOT NULL PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_hash_valid" CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "rate_limit_buckets_attempts_positive" CHECK (attempts > 0)
);

CREATE INDEX "rate_limit_buckets_expiry_idx" ON "rate_limit_buckets" ("expires_at");

COMMIT;
