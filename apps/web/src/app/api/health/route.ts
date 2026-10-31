import { withApiHandler } from "@/server/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Process liveness only. Database readiness is not implied by this response.
const health = withApiHandler(
  { operation: "health.liveness", methods: ["GET", "HEAD"] },
  (_request, context) => context.success({ status: "ok" }),
);

export { health as GET, health as HEAD, health as OPTIONS, health as POST, health as PUT, health as PATCH, health as DELETE };
