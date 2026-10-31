const definitions = {
  BAD_REQUEST: { status: 400, message: "The request is invalid." },
  UNAUTHORIZED: { status: 401, message: "Sign in to continue." },
  FORBIDDEN: { status: 403, message: "This request is not permitted." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  METHOD_NOT_ALLOWED: { status: 405, message: "This HTTP method is not supported." },
  REQUEST_TIMEOUT: { status: 408, message: "The request body took too long to arrive." },
  CONFLICT: { status: 409, message: "The request conflicts with the current resource state." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request body exceeds the allowed size." },
  URI_TOO_LONG: { status: 414, message: "The request URL exceeds the allowed size." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Use UTF-8 application/json without content encoding." },
  VALIDATION_ERROR: { status: 422, message: "Check the highlighted fields." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Try again later." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Try again later." },
  SERVICE_UNAVAILABLE: { status: 503, message: "The service is temporarily unavailable." },
} as const;

export type ApiErrorCode = keyof typeof definitions;
export interface ValidationIssue { readonly field: string; readonly message: string }

export class ApiError extends Error {
  readonly status: number;
  readonly issues: readonly ValidationIssue[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: ApiErrorCode,
    options: { issues?: readonly ValidationIssue[]; retryAfterSeconds?: number } = {},
  ) {
    super(definitions[code].message);
    this.name = "ApiError";
    this.status = definitions[code].status;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (this.retryAfterSeconds !== undefined && (code !== "RATE_LIMITED"
      || !Number.isInteger(this.retryAfterSeconds) || this.retryAfterSeconds < 1 || this.retryAfterSeconds > 86_400)) {
      throw new TypeError("Invalid API retry interval.");
    }
  }
}
