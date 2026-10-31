import { ClientError, errorMessage } from "./api";

export type FieldIssue = { field: string; message: string };
export class InputValueError extends Error {}
export class FormValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super("Review the fields below and try again.");
  }
}

// Local parsers expose only their expected, user-facing validation messages.
export async function checkedField<T>(field: string, parse: () => T | Promise<T>): Promise<T> {
  try { return await parse(); }
  catch (error) {
    if (!(error instanceof InputValueError)) throw error;
    throw new FormValidationError([{ field, message: error.message }]);
  }
}

export function describeFormError(error: unknown, message?: string) {
  const issues = error instanceof ClientError || error instanceof FormValidationError ? error.issues : [];
  return {
    message: message ?? (error instanceof FormValidationError ? error.message : errorMessage(error, false)),
    // Array errors such as courtIds.0 belong to the court selection group.
    issues: issues.map((issue) => ({ ...issue, field: issue.field.split(".")[0] ?? issue.field })),
  };
}
