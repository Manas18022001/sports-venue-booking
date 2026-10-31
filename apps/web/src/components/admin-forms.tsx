"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Court, Venue } from "../client/contracts";
import { api, ClientError, errorMessage } from "../client/api";
import { SportCombobox } from "./sport-combobox";
import { Notice, useDialogBusy } from "./ui";

export function VenueForm({
  venue,
  saved,
}: {
  venue?: Venue;
  saved: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogBusy(busy);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
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
      setError(
        errorMessage(error) +
          (!venue &&
          error instanceof ClientError &&
          (error.status === 0 || error.status >= 500)
            ? " Check the venue list before trying to create it again."
            : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error && <Notice>{error}</Notice>}
      <fieldset disabled={busy} className="form-fields">
        <label>
          Venue name
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={venue?.name ?? ""}
            placeholder="e.g. The Rally Club"
          />
        </label>
        <div className="form-row">
          <label>
            City
            <input
              name="city"
              required
              maxLength={100}
              defaultValue={venue?.city ?? ""}
            />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              required
              maxLength={64}
              defaultValue={venue?.timezone ?? "Asia/Kolkata"}
            />
            <span className="field-hint">
              Keep this fixed after adding slots.
            </span>
          </label>
        </div>
        <label>
          Address
          <input
            name="address"
            required
            maxLength={500}
            defaultValue={venue?.address ?? ""}
          />
        </label>
        <label>
          About the venue
          <textarea
            name="description"
            maxLength={5000}
            rows={3}
            defaultValue={venue?.description ?? ""}
          />
        </label>
        <label>
          Venue image URL
          <input
            name="imageUrl"
            type="url"
            maxLength={2048}
            placeholder="https://…"
            defaultValue={venue?.imageUrl ?? ""}
          />
          <span className="field-hint">
            Optional HTTPS image. An illustration appears if no photo is
            provided.
          </span>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={venue?.isActive ?? true}
          />
          <span>
            Publish this venue for customers
            <span className="field-hint">
              Archiving hides it from discovery and keeps existing bookings.
            </span>
          </span>
        </label>
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
  const [error, setError] = useState("");
  useDialogBusy(busy);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
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
      setError(
        errorMessage(error) +
          (error instanceof ClientError && error.code === "CONFLICT"
            ? " Court names must be unique in this venue. The sport cannot change after slots exist."
            : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error && <Notice>{error}</Notice>}
      <fieldset className="form-fields" disabled={busy}>
        <label>
          Court name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={court?.name ?? ""}
          />
        </label>
        <SportCombobox defaultValue={court?.sport ?? "Badminton"} />
        <label className="check-label">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={court?.isActive ?? true}
          />
          <span>Make this court available to customers</span>
        </label>
      </fieldset>
      <button className="button button-full" disabled={busy}>
        {busy ? "Saving court…" : court ? "Save court" : "Add court"}
      </button>
    </form>
  );
}
