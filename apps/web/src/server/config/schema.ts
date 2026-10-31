import { z } from "zod";
import { DEFAULT_DATABASE_POOL_OPTIONS } from "../../database/pool-options.ts";

function integerSetting(defaultValue: number, maximum: number) {
  return z.string()
    .regex(/^\d+$/, "Must contain only decimal digits")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum))
    .optional()
    .transform((value) => value ?? defaultValue);
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "postgresql:" || url.protocol === "postgres:")
      && url.hostname.length > 0
      && decodeURIComponent(url.pathname).slice(1).length > 0
      && url.hash.length === 0;
  } catch {
    return false;
  }
}

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "Is required")
    .refine(isPostgresUrl, "Must be a PostgreSQL URL with a host and database name, without a fragment"),
  DATABASE_POOL_MAX: integerSetting(DEFAULT_DATABASE_POOL_OPTIONS.maxConnections, 100),
  DATABASE_CONNECTION_TIMEOUT_MS: integerSetting(DEFAULT_DATABASE_POOL_OPTIONS.connectionTimeoutMs, 60_000),
  DATABASE_IDLE_TIMEOUT_MS: integerSetting(DEFAULT_DATABASE_POOL_OPTIONS.idleTimeoutMs, 600_000),
});

export class ServerConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid server configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ServerConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

// Pure parser: receives an explicit input rather than reading process.env.
// Errors contain field names and validation messages, never source values.
export function parseServerConfig(source: Readonly<Record<string, string | undefined>>) {
  const result = serverEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new ServerConfigurationError(result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ));
  }

  const environment = result.data;
  return Object.freeze({
    environment: environment.NODE_ENV,
    database: Object.freeze({
      connectionString: environment.DATABASE_URL,
      pool: Object.freeze({
        maxConnections: environment.DATABASE_POOL_MAX,
        connectionTimeoutMs: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        idleTimeoutMs: environment.DATABASE_IDLE_TIMEOUT_MS,
      }),
    }),
  });
}

export type ServerConfig = ReturnType<typeof parseServerConfig>;
