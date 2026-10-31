import "server-only";
import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { ApiError } from "../api/errors";
import type { ServerConfig } from "../config/schema";

type AuthConfig = ServerConfig["auth"];
const claimsSchema = z.object({ sub: z.uuid(), sid: z.uuid(), jti: z.uuid(), iat: z.number().int(), exp: z.number().int() });

function key(config: AuthConfig, purpose: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", Buffer.from(config.secret, "hex"), "turfit-auth-v1", purpose, 32));
}

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function rateKey(config: AuthConfig, scope: string): string {
  return createHmac("sha256", key(config, "rate-limits")).update(scope).digest("hex");
}

export function refreshCredential(config: AuthConfig, sessionId: string, tokenId: string): string {
  const mac = createHmac("sha256", key(config, "refresh-tokens")).update(`${sessionId}:${tokenId}`).digest("base64url");
  return `${tokenId}.${mac}`;
}

export function csrfToken(config: AuthConfig, sessionId: string): string {
  return createHmac("sha256", key(config, "csrf")).update(sessionId).digest("base64url");
}

export function verifyCsrf(config: AuthConfig, sessionId: string, value: string | null) {
  const expected = Buffer.from(csrfToken(config, sessionId));
  const actual = Buffer.from(value ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiError("FORBIDDEN");
}

export async function issueAccessToken(config: AuthConfig, userId: string, sessionId: string, sessionExpiry: Date, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = Math.min(issuedAt + config.accessTtlSeconds, Math.floor(sessionExpiry.getTime() / 1000));
  if (expiresAt <= issuedAt) throw new ApiError("UNAUTHORIZED");
  const token = await new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId).setJti(randomUUID()).setIssuer("turfit").setAudience("turfit-api")
    .setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(key(config, "access-signing"));
  return { token, expiresAt: new Date(expiresAt * 1000) };
}

export async function verifyAccessToken(config: AuthConfig, token: string, now = new Date()) {
  try {
    const { payload } = await jwtVerify(token, key(config, "access-signing"), {
      algorithms: ["HS256"], typ: "at+jwt", issuer: "turfit", audience: "turfit-api",
      requiredClaims: ["sub", "sid", "jti", "iat", "exp"], currentDate: now, maxTokenAge: config.accessTtlSeconds,
    });
    const claims = claimsSchema.parse(payload);
    if (claims.exp - claims.iat > config.accessTtlSeconds) throw new Error("Invalid lifetime");
    return claims;
  } catch {
    throw new ApiError("UNAUTHORIZED");
  }
}
