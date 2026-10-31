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

// Only fixed, reviewed messages selected by a code can leave a custom validator.
// Its raw message may contain submitted values, credentials, or implementation details.
const publicMessages: Readonly<Record<string, string>> = {
  timezone: "Enter a valid timezone, such as Asia/Kolkata.",
  minuteAligned: "Choose a date and time on a whole minute.",
  passwordLength: "Use a password of 15–128 characters.",
  passwordBytes: "This password is too long when encoded. Use a shorter passphrase.",
  passwordCommon: "This password is too common. Choose a different passphrase.",
  distinctCourts: "Choose each court only once.",
  windowOrder: "End must be after Start.",
  windowLength: "Choose an End no more than 26 hours after Start.",
  batchMinimum: "The selected window must fit at least one complete slot per court.",
  batchMaximum: "This batch exceeds 500 slots across all courts. Choose fewer courts, a shorter window, or a longer slot duration.",
};

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues: ValidationIssue[] = result.error.issues.slice(0, 20).map((issue) => ({
    field: issue.path.map(String).join(".").slice(0, 200),
    message: (() => {
      if (issue.code === "custom") {
        const key: unknown = issue.params?.messageCode;
        return typeof key === "string" && Object.hasOwn(publicMessages, key) ? publicMessages[key]! : "This field has an invalid value.";
      }
      if (issue.code === "invalid_format" && issue.format === "email") return "Enter a valid email address.";
      if (issue.code === "invalid_format" && issue.format === "url") return "Enter a valid HTTPS URL.";
      if (issue.code === "too_small" && typeof issue.minimum === "number") {
        if (issue.origin === "string") return issue.minimum === 1 ? "Enter a value." : `Use at least ${issue.minimum} characters.`;
        if (issue.origin === "array") return `Choose at least ${issue.minimum} item(s).`;
        if (issue.origin === "number") return `Enter a value of at least ${issue.minimum}.`;
      }
      if (issue.code === "too_big" && typeof issue.maximum === "number") {
        if (issue.origin === "string") return `Use at most ${issue.maximum} characters.`;
        if (issue.origin === "array") return `Choose at most ${issue.maximum} item(s).`;
        if (issue.origin === "number") return `Enter a value no greater than ${issue.maximum}.`;
      }
      return messages[issue.code] ?? "This field has an invalid value.";
    })(),
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
