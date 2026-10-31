import "server-only";
import { z } from "zod";
import { withApiHandler } from "../api/handler";
import { parseQuery } from "../api/validation";
import { validate } from "../api/validation";
import { requireAdmin, requireAuth } from "../auth/runtime";
import { consumeRateLimit } from "../auth/rate-limit";
import { getDatabase } from "../database";
import { getServerConfig } from "../config";
import { getBookingService } from "./runtime";
import { adminCancellationSchema, cancellationSchema, checkoutSchema, idempotencyKeySchema } from "./schemas";

type Resource = "bookings" | "booking" | "cancel";
type RouteContext = { params: Promise<Record<string, string>> };
export function bookingHandler(resource: Resource, admin = false) {
  const methods = resource === "cancel" ? ["POST"] as const : resource === "bookings" && !admin ? ["GET", "HEAD", "POST"] as const : ["GET", "HEAD"] as const;
  return withApiHandler<RouteContext>({ operation: `${admin ? "admin" : "customer"}.booking.${resource}`, methods }, async (request, context, route) => {
    const principal = admin ? await requireAdmin(request) : await requireAuth(request);
    const write = request.method === "POST";
    await consumeRateLimit(getDatabase(), getServerConfig(), `booking:${write ? "write" : "read"}:${principal.user.id}`, write ? 30 : 120, 60);
    const service = getBookingService(); const params = await route?.params ?? {};
    if (!write) {
      if (resource === "booking") return context.success(await service.get(principal, params.bookingId, admin));
      return context.success(await service.list(principal, parseQuery(request, z.record(z.string(), z.string())), admin));
    }
    const key = validate(idempotencyKeySchema, request.headers.get("idempotency-key"));
    const result = resource === "cancel"
      ? await service.cancel(principal, params.bookingId, await context.readJson(admin ? adminCancellationSchema : cancellationSchema), key, admin)
      : await service.create(principal, await context.readJson(checkoutSchema), key);
    const headers = new Headers({ "Idempotency-Replayed": String(result.replayed) });
    if (resource === "bookings") headers.set("Location", `/api/bookings/${result.data.booking.id}`);
    return context.success(result.data, { status: result.status, headers });
  });
}
