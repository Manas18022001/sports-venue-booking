"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { describeFormError } from "../client/form-errors";
import type { FieldIssue } from "../client/form-errors";
import { Notice } from "./ui";

type Field = string | { label: string; name: string };

export function useFormErrors(fields: Record<string, Field> = {}) {
  const id = useId();
  const ref = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ message: string; issues: FieldIssue[] }>({ message: "", issues: [] });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!revision) return;
    const target = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)');
    (target ?? summary.current)?.focus();
  }, [revision]);

  function clear() { setState({ message: "", issues: [] }); }
  function report(error: unknown, message?: string) {
    setState(describeFormError(error, message));
    setRevision((value) => value + 1);
  }
  function errorId(field: string) { return `${id}-${field}-error`; }
  function message(field: string) { return state.issues.find((issue) => issue.field === field)?.message; }
  function name(field: string) {
    const config = Object.hasOwn(fields, field) ? fields[field] : undefined;
    return typeof config === "object" ? config.name : field;
  }
  function label(field: string) {
    const config = Object.hasOwn(fields, field) ? fields[field] : undefined;
    return typeof config === "object" ? config.label : config ?? "Selection";
  }
  function clearField(controlName: string) {
    setState((previous) => {
      const remaining = previous.issues.filter((issue) => name(issue.field) !== controlName);
      if (remaining.length === previous.issues.length) return previous;
      return { message: remaining.length ? previous.message : "", issues: remaining };
    });
  }
  function changed(event: FormEvent<HTMLFormElement>) {
    const control = event.target;
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
      clearField(control.name);
  }
  function invalid(event: FormEvent<HTMLFormElement>) {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
    event.preventDefault();
    const field = Object.keys(fields).find((key) => name(key) === control.name) ?? control.name;
    setState((previous) => ({
      message: "Review the fields below and try again.",
      issues: [...previous.issues.filter((issue) => issue.field !== field), { field, message: control.validationMessage }],
    }));
    setRevision((value) => value + 1);
  }
  return {
    ...state, ref, summary, report, clear, clearField, errorId, fieldMessage: message, name, label,
    formProps: { ref, onChangeCapture: changed, onInvalidCapture: invalid },
    input(field: string, hint?: string) {
      return {
        "aria-invalid": Boolean(message(field)),
        "aria-describedby": [hint, message(field) ? errorId(field) : undefined].filter(Boolean).join(" ") || undefined,
      };
    },
  };
}

type Errors = ReturnType<typeof useFormErrors>;

export function FieldError({ errors, field }: { errors: Errors; field: string }) {
  const message = errors.fieldMessage(field);
  // aria-describedby still reads this directly referenced text. Keep it out of
  // a surrounding label's name so an error does not rename the input itself.
  return message ? <span aria-hidden="true" className="field-error" id={errors.errorId(field)}>{message}</span> : null;
}

export function FormErrors({ errors }: { errors: Errors }) {
  if (!errors.message) return null;
  const issues = errors.issues.filter((issue, index, all) => all.findIndex((other) => other.field === issue.field && other.message === issue.message) === index);
  return (
    <div ref={errors.summary} tabIndex={-1} className="form-error-summary">
      <Notice>
        <p>{errors.message}</p>
        {issues.length > 0 && (
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <button type="button" className="inline-button" onClick={() => {
                  const control = errors.ref.current?.elements.namedItem(errors.name(issue.field));
                  if (control instanceof HTMLElement) control.focus();
                  else if (control instanceof RadioNodeList) (Array.from(control).find((item) => item instanceof HTMLElement) as HTMLElement | undefined)?.focus();
                  else Array.from(errors.ref.current?.querySelectorAll<HTMLElement>("[data-error-field]") ?? []).find((item) => item.dataset.errorField === errors.name(issue.field))?.focus();
                }}>
                  {errors.label(issue.field)}: {issue.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Notice>
    </div>
  );
}
