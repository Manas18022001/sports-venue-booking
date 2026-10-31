import "server-only";
import { getServerConfig } from "../config";
import { getDatabase } from "../database";
import { createAuthService } from "./service";

let service: ReturnType<typeof createAuthService> | undefined;

export function getAuthService() {
  service ??= createAuthService(getDatabase(), getServerConfig());
  return service;
}

export function requireAuth(request: Request) { return getAuthService().authenticate(request); }
export function requireAdmin(request: Request) { return getAuthService().requireAdmin(request); }
