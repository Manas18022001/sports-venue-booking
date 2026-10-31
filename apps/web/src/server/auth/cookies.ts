import "server-only";
import type { ServerConfig } from "../config/schema";
import { ApiError } from "../api/errors";

export function cookiePolicy(config: ServerConfig) {
  const secure = new URL(config.api.origin).protocol === "https:";
  const prefix = secure ? "__Host-" : "";
  return { secure, access: `${prefix}turfit_access`, refresh: `${prefix}turfit_refresh` };
}

export function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.slice(0, part.indexOf("=")) === name);
  if (matches.length > 1) throw new ApiError("UNAUTHORIZED");
  const value = matches[0]?.slice(name.length + 1);
  if (value !== undefined && (value.length > 4096 || !/^[A-Za-z0-9_.-]+$/.test(value))) throw new ApiError("UNAUTHORIZED");
  return value;
}

function cookie(config: ServerConfig, name: string, value: string, seconds: number) {
  const { secure } = cookiePolicy(config);
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}${secure ? "; Secure" : ""}`;
}

export interface AuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly sessionExpiresAt: Date;
}

export function credentialHeaders(config: ServerConfig, credentials: AuthCredentials): Headers {
  const policy = cookiePolicy(config);
  const now = Date.now();
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(config, policy.access, credentials.accessToken, (credentials.accessExpiresAt.getTime() - now) / 1000));
  headers.append("Set-Cookie", cookie(config, policy.refresh, credentials.refreshToken, (credentials.sessionExpiresAt.getTime() - now) / 1000));
  return headers;
}

export function clearCredentialHeaders(config: ServerConfig): Headers {
  const policy = cookiePolicy(config);
  const headers = new Headers();
  headers.append("Set-Cookie", cookie(config, policy.access, "", 0));
  headers.append("Set-Cookie", cookie(config, policy.refresh, "", 0));
  return headers;
}
