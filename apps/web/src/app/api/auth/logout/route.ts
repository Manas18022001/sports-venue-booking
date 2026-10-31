import { authHandler } from "@/server/auth/controller";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = authHandler("logout");
export { handler as GET, handler as HEAD, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
