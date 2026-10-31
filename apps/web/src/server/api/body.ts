import type { z } from "zod";
import { ApiError } from "./errors";
import { DEFAULT_API_LIMITS } from "./options";
import type { ApiLimits } from "./options";
import { validate } from "./validation";

export function checkDeclaredBodySize(request: Request, limit: number): number | undefined {
  const header = request.headers.get("content-length");
  if (header === null) return undefined;
  if (!/^\d+$/.test(header)) throw new ApiError("BAD_REQUEST");
  const declared = Number(header);
  if (!Number.isSafeInteger(declared) || declared > limit) throw new ApiError("PAYLOAD_TOO_LARGE");
  return declared;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>, deadline: number, signal: AbortSignal,
) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) throw new ApiError("REQUEST_TIMEOUT");
  if (signal.aborted) throw new ApiError("BAD_REQUEST");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError("REQUEST_TIMEOUT")), remaining);
    abort = () => reject(new ApiError("BAD_REQUEST"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export async function parseJsonBody<T>(
  request: Request, schema: z.ZodType<T>, limits: ApiLimits = DEFAULT_API_LIMITS,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  const charset = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || (charset !== undefined && charset !== "utf-8" && charset !== "utf8")
    || (encoding !== undefined && encoding !== "identity")) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }
  const declared = checkDeclaredBodySize(request, limits.maxBodyBytes);
  if (!request.body || request.bodyUsed) throw new ApiError("BAD_REQUEST");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  const deadline = performance.now() + limits.bodyTimeoutMs;
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await readChunk(reader, deadline, request.signal);
      if (chunk.done) { complete = true; break; }
      size += chunk.value.byteLength;
      if (size > limits.maxBodyBytes) throw new ApiError("PAYLOAD_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("BAD_REQUEST");
  } finally {
    // Do not wait for an uncooperative client's cancellation acknowledgment.
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (declared !== undefined && size !== declared) throw new ApiError("BAD_REQUEST");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("BAD_REQUEST");
  }
  return validate(schema, value);
}
