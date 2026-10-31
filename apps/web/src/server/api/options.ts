export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export interface ApiLimits {
  readonly maxBodyBytes: number;
  readonly maxUrlBytes: number;
  readonly bodyTimeoutMs: number;
}

export const DEFAULT_API_LIMITS: ApiLimits = Object.freeze({
  maxBodyBytes: 65_536,
  maxUrlBytes: 8_192,
  bodyTimeoutMs: 10_000,
});
