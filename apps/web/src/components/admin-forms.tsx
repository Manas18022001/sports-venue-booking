"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Court, Venue } from "../client/contracts";
import { api, ClientError, errorMessage } from "../client/api";
import { SportCombobox } from "./sport-combobox";
import { useDialogBusy } from "./ui";
import { FieldError, FormErrors, useFormErrors } from "./form-errors";

export function VenueForm({
  venue,
  saved,
}: {
  venue?: Venue;
  saved: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors({ name: "Venue name", city: "City", address: "Address", description: "About the venue", timezone: "Timezone", currency: "Currency", imageUrl: "Venue image URL", isActive: "Publish venue" });
  useDialogBusy(busy);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    errors.clear();
    try {
      const result = await api<{ id: string }>(
        `/api/admin/venues${venue ? `/${venue.id}` : ""}`,
        {
          method: venue ? "PATCH" : "POST",
          auth: true,
          body: {
            name: String(fields.get("name")).trim(),
            city: String(fields.get("city")).trim(),
            address: String(fields.get("address")).trim(),
            description: String(fields.get("description")).trim(),
            timezone: String(fields.get("timezone")).trim(),
            currency: "INR",
            imageUrl: String(fields.get("imageUrl")).trim() || null,
            isActive: fields.get("isActive") === "on",
          },
        },
      );
      saved(result.id);
    } catch (error) {
      errors.report(error,
        (error instanceof ClientError && error.code === "CONFLICT"
          ? "The venue changed or its timezone cannot be changed after slots or bookings exist. Reload the venue before editing."
          : errorMessage(error, false)) +
          (!venue &&
          error instanceof ClientError &&
          (error.status === 0 || error.status >= 500)
            ? " Check the venue list before trying to create it again."
            : venue && error instanceof ClientError && (error.status === 0 || error.status >= 500)
              ? " Check the latest venue details before saving again."
              : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form {...errors.formProps} className="form-stack" onSubmit={(event) => void submit(event)}>
      <FormErrors errors={errors} />
      <fieldset disabled={busy} className="form-fields">
        <label>
          Venue name
          <input
            name="name"
            {...errors.input("name")}
            required
            maxLength={160}
            defaultValue={venue?.name ?? ""}
            placeholder="e.g. The Rally Club"
          />
          <FieldError errors={errors} field="name" />
        </label>
        <div className="form-row">
          <label>
            City
            <input
              name="city"
              {...errors.input("city")}
              required
              maxLength={100}
              defaultValue={venue?.city ?? ""}
            />
            <FieldError errors={errors} field="city" />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              {...errors.input("timezone")}
              required
              maxLength={64}
              defaultValue={venue?.timezone ?? "Asia/Kolkata"}
            />
            <FieldError errors={errors} field="timezone" />
            <span className="field-hint">
              Keep this fixed after adding slots.
            </span>
          </label>
        </div>
        <label>
          Address
          <input
            name="address"
            {...errors.input("address")}
            required
            maxLength={500}
            defaultValue={venue?.address ?? ""}
          />
          <FieldError errors={errors} field="address" />
        </label>
        <label>
          About the venue
          <textarea
            name="description"
            {...errors.input("description")}
            maxLength={5000}
            rows={3}
            defaultValue={venue?.description ?? ""}
          />
          <FieldError errors={errors} field="description" />
        </label>
        <label>
          Venue image URL
          <input
            name="imageUrl"
            {...errors.input("imageUrl")}
            type="url"
            maxLength={2048}
            placeholder="https://…"
            defaultValue={venue?.imageUrl ?? ""}
          />
          <FieldError errors={errors} field="imageUrl" />
          <span className="field-hint">
            Optional direct HTTPS image address, rather than a search or webpage link.
            An illustration appears if the image is missing or cannot load.
          </span>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="isActive"
            {...errors.input("isActive")}
            defaultChecked={venue?.isActive ?? true}
          />
          <span>
            Publish this venue for customers
            <span className="field-hint">
              Archiving hides it from discovery and keeps existing bookings.
            </span>
          </span>
        </label>
        <FieldError errors={errors} field="isActive" />
      </fieldset>
      <button className="button button-full" disabled={busy}>
        {busy ? "Saving venue…" : venue ? "Save venue" : "Create venue"}
      </button>
    </form>
  );
}

export function CourtForm({
  venueId,
  court,
  saved,
}: {
  venueId: string;
  court?: Court;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const errors = useFormErrors({ name: "Court name", sport: "Sport", isActive: "Court availability" });
  useDialogBusy(busy);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    errors.clear();
    try {
      await api(
        `/api/admin/venues/${venueId}/courts${court ? `/${court.id}` : ""}`,
        {
          method: court ? "PATCH" : "POST",
          auth: true,
          body: {
            name: String(fields.get("name")).trim(),
            sport: String(fields.get("sport")).trim(),
            isActive: fields.get("isActive") === "on",
          },
        },
      );
      saved();
    } catch (error) {
      errors.report(error,
        errorMessage(error, false) +
          (error instanceof ClientError && error.code === "CONFLICT"
            ? " Court names must be unique in this venue. The sport cannot change after slots exist."
            : error instanceof ClientError && (error.status === 0 || error.status >= 500)
              ? court ? " Check the latest court details before saving again." : " Check the court list before trying to create it again."
              : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form {...errors.formProps} className="form-stack" onSubmit={(event) => void submit(event)}>
      <FormErrors errors={errors} />
      <fieldset className="form-fields" disabled={busy}>
        <label>
          Court name
          <input
            name="name"
            {...errors.input("name")}
            required
            maxLength={120}
            defaultValue={court?.name ?? ""}
          />
          <FieldError errors={errors} field="name" />
        </label>
        <SportCombobox defaultValue={court?.sport ?? "Badminton"} error={errors.fieldMessage("sport")} errorId={errors.errorId("sport")} />
        <label className="check-label">
          <input
            type="checkbox"
            name="isActive"
            {...errors.input("isActive")}
            defaultChecked={court?.isActive ?? true}
          />
          <span>Make this court available to customers</span>
        </label>
        <FieldError errors={errors} field="isActive" />
      </fieldset>
      <button className="button button-full" disabled={busy}>
        {busy ? "Saving court…" : court ? "Save court" : "Add court"}
      </button>
    </form>
  );
}
