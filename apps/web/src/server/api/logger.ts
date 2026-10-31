import "server-only";
import pino from "pino";
import type { DestinationStream } from "pino";
import { getServerConfig } from "../config";
import type { ApiErrorCode } from "./errors";
import type { LogLevel } from "./options";

export interface ApiLogEntry {
  readonly requestId: string;
  readonly operation: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
  readonly errorCode?: ApiErrorCode;
}

export interface ApiLogger { write(entry: ApiLogEntry): void }

export function createApiLogger(level: LogLevel, destination?: DestinationStream): ApiLogger {
  const logger = pino({
    level,
    base: { service: "turfit" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ["password", "passwordHash", "token", "accessToken", "refreshToken", "authorization", "cookie", "headers.authorization", "headers.cookie", 'headers["set-cookie"]'],
  }, destination);

  return {
    write(entry) {
      // Explicit allowlist: no request objects, headers, bodies, query strings,
      // arbitrary exception messages, or additional caller-provided fields.
      const fields = {
        requestId: entry.requestId, operation: entry.operation, method: entry.method,
        status: entry.status, durationMs: entry.durationMs,
        ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
      };
      const severity = entry.status >= 500 ? "error" : entry.status >= 400 ? "warn" : "info";
      logger[severity](fields, "api.request.completed");
    },
  };
}

let applicationLogger: ApiLogger | undefined;

export function getApiLogger(): ApiLogger {
  applicationLogger ??= createApiLogger(getServerConfig().logging.level);
  return applicationLogger;
}
