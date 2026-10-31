import "server-only";
import { z } from "zod";
import { withApiHandler } from "../api/handler";
import { ApiError } from "../api/errors";
import { getServerConfig } from "../config";
import { csrfToken } from "./crypto";
import { clearCredentialHeaders, credentialHeaders } from "./cookies";
import { clientNetwork } from "./rate-limit";
import { getAuthService } from "./runtime";
import { emptyBodySchema } from "./schemas";
import type { AuthResult } from "./service";

type Operation = "register" | "login" | "refresh" | "logout" | "me" | "csrf";

function publicSession(result: AuthResult) {
  return { user: result.principal.user, csrfToken: result.csrfToken,
    accessExpiresAt: result.credentials.accessExpiresAt.toISOString(),
    sessionExpiresAt: result.principal.sessionExpiresAt.toISOString() };
}

export function authHandler(operation: Operation) {
  const read = operation === "me" || operation === "csrf";
  return withApiHandler({ operation: `auth.${operation}`, methods: read ? ["GET", "HEAD"] : ["POST"] }, async (request, context) => {
    const config = getServerConfig();
    const service = getAuthService();
    await service.limitNetwork(clientNetwork(request, config), operation);
    if (operation === "register" || operation === "login") {
      const input = await context.readJson(z.unknown());
      const result = operation === "register" ? await service.register(input) : await service.login(input);
      return context.success(publicSession(result), {
        status: operation === "register" ? 201 : 200, headers: credentialHeaders(config, result.credentials),
      });
    }
    if (operation === "me") {
      const principal = await service.authenticate(request);
      return context.success({ user: principal.user, csrfToken: csrfToken(config.auth, principal.sessionId),
        sessionExpiresAt: principal.sessionExpiresAt.toISOString() });
    }
    if (operation === "csrf") return context.success({ csrfToken: await service.getCsrf(request) });
    await context.readJson(emptyBodySchema);
    if (operation === "logout") {
      await service.logout(request);
      return context.success({ signedOut: true }, { headers: clearCredentialHeaders(config) });
    }
    try {
      const result = await service.refresh(request);
      return context.success(publicSession(result), { headers: credentialHeaders(config, result.credentials) });
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHORIZED") {
        throw new ApiError("UNAUTHORIZED", { headers: clearCredentialHeaders(config) });
      }
      throw error;
    }
  });
}
