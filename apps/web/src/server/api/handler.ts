import "server-only";
import { randomUUID } from "node:crypto";
import { getSecurityHeaders } from "../../../security-headers.mjs";
import { getServerConfig } from "../config";
import type { ServerConfig } from "../config/schema";
import { checkDeclaredBodySize, parseJsonBody } from "./body";
import { ApiError } from "./errors";
import type { ApiErrorCode } from "./errors";
import { getApiLogger } from "./logger";
import type { ApiLogger } from "./logger";
import type { z } from "zod";

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type HttpMethod = typeof HTTP_METHODS[number];
type ApiRuntimeConfig = Pick<ServerConfig, "environment" | "api">;

export interface ApiContext {
  readonly requestId: string;
  success<T>(data: T, options?: { status?: 200 | 201 | 202; headers?: HeadersInit }): Response;
  readJson<T>(schema: z.ZodType<T>): Promise<T>;
}

interface HandlerOptions {
  readonly operation: string;
  readonly methods: readonly HttpMethod[];
  readonly automaticOptions?: boolean;
}

interface HandlerDependencies {
  readonly config?: ApiRuntimeConfig;
  readonly logger?: ApiLogger;
}

function verifyOrigin(request: Request, origin: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError("FORBIDDEN");
  }
}

export function withApiHandler<TRouteContext = unknown>(
  options: HandlerOptions,
  handler: (request: Request, context: ApiContext, routeContext?: TRouteContext) => Response | Promise<Response>,
  dependencies: HandlerDependencies = {},
) {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(options.operation) || options.methods.length === 0) {
    throw new TypeError("API handlers require a static operation name and supported methods.");
  }
  const methods = [...new Set<HttpMethod>([
    ...options.methods, ...(options.automaticOptions === false ? [] : ["OPTIONS" as const]),
  ])];
  const allow = methods.join(", ");

  return async (request: Request, routeContext?: TRouteContext): Promise<Response> => {
    const configuration = dependencies.config ?? getServerConfig();
    const logger = dependencies.logger ?? getApiLogger();
    const requestId = randomUUID();
    const started = performance.now();
    let response: Response;
    let errorCode: ApiErrorCode | undefined;
    const context: ApiContext = {
      requestId,
      success: (data, init = {}) => Response.json({ data, meta: { requestId } }, init),
      readJson: (schema) => parseJsonBody(request, schema, configuration.api.limits),
    };

    try {
      if (!methods.includes(request.method as HttpMethod)) throw new ApiError("METHOD_NOT_ALLOWED");
      if (Buffer.byteLength(request.url, "utf8") > configuration.api.limits.maxUrlBytes) throw new ApiError("URI_TOO_LONG");
      checkDeclaredBodySize(request, configuration.api.limits.maxBodyBytes);
      verifyOrigin(request, configuration.api.origin);
      response = request.method === "OPTIONS" && options.automaticOptions !== false
        ? new Response(null, { status: 204, headers: { Allow: allow } })
        : await handler(request, context, routeContext);
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
      errorCode = safe.code;
      const headers = new Headers(safe.headers);
      if (safe.code === "METHOD_NOT_ALLOWED") headers.set("Allow", allow);
      if (safe.retryAfterSeconds !== undefined) headers.set("Retry-After", String(safe.retryAfterSeconds));
      response = Response.json({
        error: {
          code: safe.code, message: safe.message,
          ...(safe.code === "VALIDATION_ERROR" && safe.issues ? { issues: safe.issues } : {}),
        },
        meta: { requestId },
      }, { status: safe.status, headers });
    }

    const headers = new Headers(response.headers);
    for (const header of getSecurityHeaders(configuration.environment === "production")) headers.set(header.key, header.value);
    headers.set("X-Request-Id", requestId);
    headers.set("Cache-Control", "private, no-store");
    const result = new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
    // A route that rejects without consuming its body should stop that stream.
    if (request.body && !request.body.locked && !request.bodyUsed) void request.body.cancel().catch(() => undefined);
    try {
      logger.write({
        requestId, operation: options.operation,
        method: HTTP_METHODS.includes(request.method as HttpMethod) ? request.method : "OTHER",
        status: result.status, durationMs: Math.round((performance.now() - started) * 100) / 100,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    } catch {
      // A failing logging sink must not turn an already committed operation into
      // an apparent failure that prompts the customer to submit it again.
    }
    return result;
  };
}
