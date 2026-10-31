export interface DatabasePoolOptions {
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

export const DEFAULT_DATABASE_POOL_OPTIONS: DatabasePoolOptions = Object.freeze({
  maxConnections: 10,
  connectionTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
});
