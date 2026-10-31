import "server-only";
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { ServerConfig } from "../config/schema";
import { ApiError } from "../api/errors";
import type { GenerationInput } from "./schemas";

export function generationPlan(input: GenerationInput) {
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  const step = input.durationMinutes * 60_000;
  const slotsPerCourt = Math.floor((end - start) / step);
  const generatedEnd = start + slotsPerCourt * step;
  const courtIds = [...input.courtIds].sort();
  const slots = courtIds.flatMap(courtId => Array.from({ length: slotsPerCourt }, (_, index) => ({
    courtId, startsAt: new Date(start + index * step).toISOString(),
    endsAt: new Date(start + (index + 1) * step).toISOString(), priceMinor: input.priceMinor,
  })));
  return {
    courtIds, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
    durationMinutes: input.durationMinutes, priceMinor: input.priceMinor,
    slotsPerCourt, totalSlots: slots.length, slots,
    unusedPeriod: generatedEnd === end ? null : {
      startsAt: new Date(generatedEnd).toISOString(), endsAt: new Date(end).toISOString(),
      durationMinutes: (end - generatedEnd) / 60_000,
    },
  };
}

type Binding = { adminId: string; venueId: string; timezone: string; currency: string; plan: ReturnType<typeof generationPlan> };
function digest(binding: Binding) { return createHash("sha256").update(JSON.stringify(binding)).digest("base64url"); }
function signature(config: ServerConfig, payload: string) {
  const key = hkdfSync("sha256", Buffer.from(config.auth.secret, "hex"), "turfit-auth-v1", "slot-generation-preview", 32);
  return createHmac("sha256", new Uint8Array(key)).update(payload).digest("base64url");
}
export function signPreview(config: ServerConfig, binding: Binding, now: Date) {
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const payload = Buffer.from(JSON.stringify({ digest: digest(binding), expiresAt: expiresAt.getTime() })).toString("base64url");
  return { previewToken: `${payload}.${signature(config, payload)}`, previewExpiresAt: expiresAt.toISOString() };
}
export function verifyPreview(config: ServerConfig, binding: Binding, token: string, now: Date) {
  try {
    const parts = token.split(".");
    const [payload, mac] = parts;
    if (parts.length !== 2 || !payload || !mac) throw new Error();
    const expected = Buffer.from(signature(config, payload)); const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const data: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object" || !("digest" in data) || !("expiresAt" in data)
      || data.digest !== digest(binding) || typeof data.expiresAt !== "number"
      || !Number.isFinite(data.expiresAt) || data.expiresAt <= now.getTime()) throw new Error();
  } catch { throw new ApiError("PREVIEW_EXPIRED"); }
}
