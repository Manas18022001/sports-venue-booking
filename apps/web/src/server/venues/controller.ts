import "server-only";
import { z } from "zod";
import { withApiHandler } from "../api/handler";
import { ApiError } from "../api/errors";
import { parseQuery } from "../api/validation";
import { requireAdmin } from "../auth/runtime";
import { clientNetwork, consumeRateLimit } from "../auth/rate-limit";
import { getServerConfig } from "../config";
import { getDatabase } from "../database";
import { getCatalogService, getVenueAdminService } from "./runtime";
import {
  courtCreateSchema, courtUpdateSchema, generationConfirmSchema, generationSchema,
  slotUpdateSchema, venueCreateSchema, venueUpdateSchema,
} from "./schemas";

type Resource = "venues" | "venue" | "courts" | "court" | "slots" | "preview" | "slot";
type RouteContext = { params: Promise<Record<string, string>> };

export function venueHandler(resource: Resource, admin = false) {
  const methods = !admin ? ["GET", "HEAD"] as const
    : resource === "preview" ? ["POST"] as const
    : resource === "slot" || resource === "court" ? ["PATCH"] as const
    : resource === "venue" ? ["GET", "HEAD", "PATCH"] as const
    : ["GET", "HEAD", "POST"] as const;
  return withApiHandler<RouteContext>({ operation: `${admin ? "admin" : "public"}.${resource}`, methods }, async (request, context, route) => {
    const config = getServerConfig();
    const principal = admin ? await requireAdmin(request) : undefined;
    const generation = resource === "preview" || (resource === "slots" && request.method === "POST");
    await consumeRateLimit(getDatabase(), config,
      admin ? `venue-admin:${generation ? "generation" : "management"}:${principal!.user.id}` : `venue-public:${clientNetwork(request, config)}`,
      admin ? generation ? 20 : 120 : 300, 60);
    const params = await route?.params ?? {};
    const catalog = getCatalogService();
    const reads = request.method === "GET" || request.method === "HEAD";
    if (reads) {
      // Preserve raw query strings: the service owns normalization/defaults.
      const query = parseQuery(request, z.record(z.string(), z.string()));
      if (resource === "venues") return context.success(await catalog.listVenues(query, admin));
      if (resource === "venue") return context.success(await catalog.getVenue(params.venueId, admin));
      if (resource === "courts") return context.success(await catalog.listCourts(params.venueId, query, admin));
      if (resource === "slots") return context.success(await catalog.listSlots(params.venueId, query, admin));
      throw new ApiError("NOT_FOUND");
    }
    const service = getVenueAdminService();
    if (resource === "venues") return context.success(await service.createVenue(await context.readJson(venueCreateSchema)), { status: 201 });
    if (resource === "venue") return context.success(await service.updateVenue(params.venueId, await context.readJson(venueUpdateSchema)));
    if (resource === "courts") return context.success(await service.createCourt(params.venueId, await context.readJson(courtCreateSchema)), { status: 201 });
    if (resource === "court") return context.success(await service.updateCourt(params.venueId, params.courtId, await context.readJson(courtUpdateSchema)));
    if (resource === "preview") return context.success(await service.previewSlots(params.venueId, await context.readJson(generationSchema), principal!.user.id));
    if (resource === "slots") return context.success(await service.generateSlots(params.venueId, await context.readJson(generationConfirmSchema), principal!.user.id), { status: 201 });
    return context.success(await service.updateSlot(params.venueId, params.slotId, await context.readJson(slotUpdateSchema)));
  });
}
