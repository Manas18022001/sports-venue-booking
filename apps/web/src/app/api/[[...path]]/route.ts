import { ApiError } from "@/server/api/errors";
import { HTTP_METHODS, withApiHandler } from "@/server/api/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = withApiHandler(
  { operation: "api.not_found", methods: HTTP_METHODS, automaticOptions: false },
  () => { throw new ApiError("NOT_FOUND"); },
);

export { notFound as GET, notFound as HEAD, notFound as OPTIONS, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
