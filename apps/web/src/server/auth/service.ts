import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseClient, TransactionClient } from "../../database/client";
import type { User } from "../../generated/prisma/client";
import type { ServerConfig } from "../config/schema";
import { ApiError } from "../api/errors";
import { validate } from "../api/validation";
import { cookiePolicy, readCookie } from "./cookies";
import type { AuthCredentials } from "./cookies";
import { csrfToken, hashCredential, issueAccessToken, refreshCredential, verifyAccessToken, verifyCsrf } from "./crypto";
import { hashPassword, verifyPassword } from "./passwords";
import { consumeRateLimit } from "./rate-limit";
import { loginSchema, registrationSchema } from "./schemas";

export function publicUser(user: Pick<User, "id" | "name" | "email" | "role">) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
export type PublicUser = ReturnType<typeof publicUser>;
export interface Principal { user: PublicUser; sessionId: string; sessionExpiresAt: Date }
export interface AuthResult { principal: Principal; credentials: AuthCredentials; csrfToken: string }

async function databaseNow(tx: TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp()::timestamptz(3) AS now`;
  const now = rows[0]?.now;
  if (!now) throw new ApiError("SERVICE_UNAVAILABLE");
  return now;
}

async function lockSession(tx: TransactionClient, sessionId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
}

function uniqueConflict(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

export function createAuthService(db: DatabaseClient, config: ServerConfig) {
  const policy = cookiePolicy(config);
  const transactionOptions = { maxWait: 5_000, timeout: 10_000 };

  async function bundle(user: User, sessionId: string, expiry: Date, tokenId: string, now: Date): Promise<AuthResult> {
    const access = await issueAccessToken(config.auth, user.id, sessionId, expiry, now);
    return {
      principal: { user: publicUser(user), sessionId, sessionExpiresAt: expiry },
      csrfToken: csrfToken(config.auth, sessionId),
      credentials: { accessToken: access.token, accessExpiresAt: access.expiresAt,
        refreshToken: refreshCredential(config.auth, sessionId, tokenId), sessionExpiresAt: expiry },
    };
  }

  async function openSession(tx: TransactionClient, user: User, now: Date) {
    const sessionId = randomUUID();
    const tokenId = randomUUID();
    const expiry = new Date(now.getTime() + config.auth.sessionTtlSeconds * 1000);
    const result = await bundle(user, sessionId, expiry, tokenId, now);
    await tx.authSession.create({ data: { id: sessionId, userId: user.id, expiresAt: expiry, createdAt: now } });
    await tx.refreshToken.create({ data: { id: tokenId, sessionId,
      tokenHash: hashCredential(result.credentials.refreshToken), expiresAt: expiry, createdAt: now } });
    return result;
  }

  async function limitNetwork(network: string, operation: string) {
    const settings = operation === "register" ? [20, 900] : operation === "login" ? [50, 900] : [180, 60];
    await consumeRateLimit(db, config, `auth-network:${operation}:${network}`, settings[0]!, settings[1]!);
  }

  async function register(input: unknown): Promise<AuthResult> {
    const data = validate(registrationSchema, input);
    const passwordHash = await hashPassword(data.password);
    try {
      return await db.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const user = await tx.user.create({ data: { name: data.name, email: data.email, passwordHash, role: "CUSTOMER", createdAt: now } });
        return openSession(tx, user, now);
      }, transactionOptions);
    } catch (error) {
      if (uniqueConflict(error)) throw new ApiError("CONFLICT");
      throw error;
    }
  }

  async function login(input: unknown): Promise<AuthResult> {
    const data = validate(loginSchema, input);
    await consumeRateLimit(db, config, `login-account:${data.email}`, 10, 900);
    const candidate = await db.user.findUnique({ where: { email: data.email } });
    const verified = await verifyPassword(data.password, candidate?.passwordHash);
    if (!candidate || !verified || !candidate.isActive) throw new ApiError("INVALID_CREDENTIALS");
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.id}::uuid FOR SHARE`;
      const user = await tx.user.findUnique({ where: { id: candidate.id } });
      if (!user?.isActive || user.passwordHash !== candidate.passwordHash) throw new ApiError("INVALID_CREDENTIALS");
      return openSession(tx, user, await databaseNow(tx));
    }, transactionOptions);
  }

  async function authenticate(request: Request): Promise<Principal> {
    const token = readCookie(request, policy.access);
    if (!token) throw new ApiError("UNAUTHORIZED");
    const claims = await verifyAccessToken(config.auth, token);
    const session = await db.authSession.findUnique({ where: { id: claims.sid }, include: { user: true } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
      throw new ApiError("UNAUTHORIZED");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) verifyCsrf(config.auth, session.id, request.headers.get("x-csrf-token"));
    return { user: publicUser(session.user), sessionId: session.id, sessionExpiresAt: session.expiresAt };
  }

  async function refresh(request: Request): Promise<AuthResult> {
    const value = readCookie(request, policy.refresh);
    if (!value) throw new ApiError("UNAUTHORIZED");
    const found = await db.refreshToken.findUnique({ where: { tokenHash: hashCredential(value) }, include: { session: true } });
    if (!found) throw new ApiError("UNAUTHORIZED");
    await consumeRateLimit(db, config, `refresh-session:${found.sessionId}`, 60, 60);
    const result = await db.$transaction(async (tx) => {
      await lockSession(tx, found.sessionId, found.session.userId);
      const now = await databaseNow(tx);
      const session = await tx.authSession.findUnique({ where: { id: found.sessionId }, include: { user: true } });
      const token = await tx.refreshToken.findUnique({ where: { id: found.id } });
      if (!session || !token || session.revokedAt || session.expiresAt <= now || token.expiresAt <= now || !session.user.isActive) return null;
      verifyCsrf(config.auth, session.id, request.headers.get("x-csrf-token"));
      if (token.consumedAt) {
        if (now.getTime() - token.consumedAt.getTime() <= config.auth.refreshRetrySeconds * 1000) {
          const current = await tx.refreshToken.findFirst({ where: { sessionId: session.id, consumedAt: null, expiresAt: { gt: now } } });
          if (current && hashCredential(refreshCredential(config.auth, session.id, current.id)) === current.tokenHash) {
            return bundle(session.user, session.id, session.expiresAt, current.id, now);
          }
        }
        // Commit the revocation BEFORE reporting failure to the caller.
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
        return null;
      }
      await tx.refreshToken.update({ where: { id: token.id }, data: { consumedAt: now } });
      const nextId = randomUUID();
      const refreshed = await bundle(session.user, session.id, session.expiresAt, nextId, now);
      await tx.refreshToken.create({ data: { id: nextId, sessionId: session.id,
        tokenHash: hashCredential(refreshed.credentials.refreshToken), expiresAt: session.expiresAt, createdAt: now } });
      return refreshed;
    }, transactionOptions);
    if (!result) throw new ApiError("UNAUTHORIZED");
    return result;
  }

  async function getCsrf(request: Request): Promise<string> {
    const value = readCookie(request, policy.refresh);
    if (!value) throw new ApiError("UNAUTHORIZED");
    const token = await db.refreshToken.findUnique({ where: { tokenHash: hashCredential(value) }, include: { session: { include: { user: true } } } });
    const now = Date.now();
    if (!token || token.expiresAt.getTime() <= now || token.session.revokedAt || token.session.expiresAt.getTime() <= now || !token.session.user.isActive
      || (token.consumedAt && now - token.consumedAt.getTime() > config.auth.refreshRetrySeconds * 1000)) throw new ApiError("UNAUTHORIZED");
    return csrfToken(config.auth, token.sessionId);
  }

  async function logout(request: Request): Promise<void> {
    const value = readCookie(request, policy.refresh);
    let sessionId: string | undefined;
    let userId: string | undefined;
    if (value) {
      const token = await db.refreshToken.findUnique({ where: { tokenHash: hashCredential(value) }, include: { session: true } });
      sessionId = token?.sessionId; userId = token?.session.userId;
    }
    if (!sessionId) {
      try { const principal = await authenticate(request); sessionId = principal.sessionId; userId = principal.user.id; }
      catch (error) { if (!(error instanceof ApiError && error.code === "UNAUTHORIZED")) throw error; }
    }
    if (!sessionId || !userId) return;
    const id = sessionId;
    const owner = userId;
    await db.$transaction(async (tx) => {
      await lockSession(tx, id, owner);
      const session = await tx.authSession.findUnique({ where: { id } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return;
      verifyCsrf(config.auth, session.id, request.headers.get("x-csrf-token"));
      await tx.authSession.update({ where: { id }, data: { revokedAt: await databaseNow(tx) } });
    }, transactionOptions);
  }

  async function requireAdmin(request: Request) {
    const principal = await authenticate(request);
    if (principal.user.role !== "ADMIN") throw new ApiError("FORBIDDEN");
    return principal;
  }

  return { register, login, authenticate, refresh, getCsrf, logout, requireAdmin, limitNetwork };
}

export function assertOwner(principal: Principal, ownerId: string, allowAdmin = false) {
  if (principal.user.id !== ownerId && !(allowAdmin && principal.user.role === "ADMIN")) throw new ApiError("FORBIDDEN");
}
