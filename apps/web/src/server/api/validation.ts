import type { z } from "zod";
import { ApiError } from "./errors";
import type { ValidationIssue } from "./errors";

const messages: Readonly<Record<string, string>> = {
  invalid_type: "This field has an invalid type or is missing.",
  invalid_format: "This field has an invalid format.",
  too_small: "This value is too small or too short.",
  too_big: "This value is too large or too long.",
  unrecognized_keys: "Unsupported fields were provided.",
};

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues: ValidationIssue[] = result.error.issues.slice(0, 20).map((issue) => ({
    field: issue.path.map(String).join(".").slice(0, 200),
    // Never expose a custom validator's message: it might contain an input value.
    message: messages[issue.code] ?? "This field has an invalid value.",
  }));
  throw new ApiError("VALIDATION_ERROR", { issues });
}

export function parseQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const input: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(input, key)) throw new ApiError("BAD_REQUEST");
    input[key] = value;
  }
  return validate(schema, input);
}
