import { z } from "zod";
import { DEFAULT_DATABASE_POOL_OPTIONS } from "../../database/pool-options.ts";
import { DEFAULT_API_LIMITS, LOG_LEVELS } from "../api/options.ts";
import { AUTH_DEFAULTS, CLIENT_IP_HEADERS } from "../auth/options.ts";

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
      && (!url.searchParams.has("schema") || /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(url.searchParams.get("schema") ?? ""))
      && decodeURIComponent(url.pathname).slice(1).length > 0
      && url.hash.length === 0;
  } catch {
    return false;
  }
}

function isAppOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname.length > 0
      && url.username === "" && url.password === "" && url.pathname === "/"
      && url.search === "" && url.hash === "";
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
  APP_ORIGIN: z.string().refine(isAppOrigin, "Must be an HTTP(S) origin without credentials, a path, query, or fragment")
    .default("http://localhost:3000"),
  API_MAX_BODY_BYTES: integerSetting(DEFAULT_API_LIMITS.maxBodyBytes, 1_048_576),
  API_MAX_URL_BYTES: integerSetting(DEFAULT_API_LIMITS.maxUrlBytes, 65_536),
  API_BODY_TIMEOUT_MS: integerSetting(DEFAULT_API_LIMITS.bodyTimeoutMs, 60_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  AUTH_SECRET: z.string().regex(/^[0-9a-f]{64}$/i, "Must be a randomly generated 32-byte hexadecimal key")
    .refine((value) => new Set(value.toLowerCase()).size >= 8, "Use a randomly generated key, not a repeated placeholder"),
  AUTH_ACCESS_TTL_SECONDS: integerSetting(AUTH_DEFAULTS.accessTtlSeconds, 3_600),
  AUTH_SESSION_TTL_SECONDS: integerSetting(AUTH_DEFAULTS.sessionTtlSeconds, 2_592_000),
  AUTH_REFRESH_RETRY_SECONDS: integerSetting(AUTH_DEFAULTS.refreshRetrySeconds, 10),
  AUTH_CLIENT_IP_HEADER: z.enum(CLIENT_IP_HEADERS).default("none"),
}).superRefine((settings, context) => {
  if (settings.AUTH_SESSION_TTL_SECONDS <= settings.AUTH_ACCESS_TTL_SECONDS) {
    context.addIssue({ code: "custom", path: ["AUTH_SESSION_TTL_SECONDS"], message: "Session lifetime must exceed access token lifetime" });
  }
  if (settings.NODE_ENV !== "production" || !isAppOrigin(settings.APP_ORIGIN)) return;
  const origin = new URL(settings.APP_ORIGIN);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !loopback) {
    context.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "Production origins must use HTTPS; HTTP loopback is allowed for local testing" });
  }
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
    api: Object.freeze({
      origin: new URL(environment.APP_ORIGIN).origin,
      limits: Object.freeze({
        maxBodyBytes: environment.API_MAX_BODY_BYTES,
        maxUrlBytes: environment.API_MAX_URL_BYTES,
        bodyTimeoutMs: environment.API_BODY_TIMEOUT_MS,
      }),
    }),
    logging: Object.freeze({ level: environment.LOG_LEVEL }),
    auth: Object.freeze({
      secret: environment.AUTH_SECRET,
      accessTtlSeconds: environment.AUTH_ACCESS_TTL_SECONDS,
      sessionTtlSeconds: environment.AUTH_SESSION_TTL_SECONDS,
      refreshRetrySeconds: environment.AUTH_REFRESH_RETRY_SECONDS,
      clientIpHeader: environment.AUTH_CLIENT_IP_HEADER,
    }),
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
