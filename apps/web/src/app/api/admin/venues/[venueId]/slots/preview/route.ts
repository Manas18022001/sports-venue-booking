import { venueHandler } from "@/server/venues/controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = venueHandler("preview", true);
export { handler as GET, handler as HEAD, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
