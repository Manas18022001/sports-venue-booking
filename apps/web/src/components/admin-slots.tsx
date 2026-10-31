"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type {
  Court,
  Generation,
  Preview,
  Slot,
  Venue,
} from "../client/contracts";
import { api, ClientError, errorMessage } from "../client/api";
import {
  instantDate,
  localInput,
  money,
  priceMinor,
  timeLabel,
  toInstant,
} from "../client/format";
import { Notice, useDialogBusy } from "./ui";
import { Icon } from "./icon";

export function GenerationForm({
  venue,
  courts,
  date,
  saved,
}: {
  venue: Venue;
  courts: Court[];
  date: string;
  saved: (date: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [plan, setPlan] = useState<Generation | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  useDialogBusy(busy);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      const startsAt = await toInstant(
        String(fields.get("startsAt")),
        venue.timezone,
      );
      const endsAt = await toInstant(
        String(fields.get("endsAt")),
        venue.timezone,
      );
      const input: Generation = {
        courtIds: fields.getAll("courtIds").map(String),
        startsAt,
        endsAt,
        durationMinutes: Number(fields.get("duration")),
        priceMinor: priceMinor(String(fields.get("price"))),
      };
      if (!input.courtIds.length || input.courtIds.length > 20)
        throw new Error("Choose between 1 and 20 courts.");
      const result = await api<Preview>(
        `/api/admin/venues/${venue.id}/slots/preview`,
        { method: "POST", body: input, auth: true },
      );
      setPlan(input);
      setPreview(result);
      setAck(false);
    } catch (error) {
      setError(
        error instanceof ClientError
          ? errorMessage(error)
          : error instanceof Error
            ? error.message
            : "Check the venue-local dates and times. Daylight-saving times must be unambiguous.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!plan || !preview || busy || uncertain) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/venues/${venue.id}/slots`, {
        method: "POST",
        auth: true,
        body: {
          ...plan,
          previewToken: preview.previewToken,
          acknowledgeUnusedPeriod: ack,
        },
      });
      saved(localInput(plan.startsAt, venue.timezone).slice(0, 10));
    } catch (error) {
      setError(errorMessage(error));
      if (
        !(error instanceof ClientError) ||
        error.status === 0 ||
        error.status >= 500
      )
        setUncertain(true);
      if (error instanceof ClientError && error.code === "PREVIEW_EXPIRED")
        setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={(event) => void review(event)}>
      <p className="small muted">
        Create a schedule for {venue.name}. All dates and times are in{" "}
        {venue.timezone.replaceAll("_", " ")}.
      </p>
      {error && <Notice>{error}</Notice>}
      <fieldset className="form-fields" disabled={busy || Boolean(preview)}>
        <div className="form-row">
          <label>
            Start
            <input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={`${date}T09:00`}
            />
          </label>
          <label>
            End
            <input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={`${date}T22:00`}
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Slot duration, minutes
            <input
              name="duration"
              type="number"
              min={5}
              max={1440}
              step={1}
              defaultValue={60}
              required
            />
          </label>
          <label>
            Price per slot, ₹
            <input
              name="price"
              inputMode="decimal"
              type="number"
              min={0}
              step="0.01"
              defaultValue="500"
              required
            />
          </label>
        </div>
        <div>
          <span className="form-label">Courts</span>
          <div className="generation-courts">
            {courts
              .filter((court) => court.isActive !== false)
              .map((court) => (
                <label className="check-label" key={court.id}>
                  <input
                    name="courtIds"
                    type="checkbox"
                    value={court.id}
                    defaultChecked={
                      courts.filter((item) => item.isActive !== false)
                        .length === 1
                    }
                  />
                  <span>
                    {court.name}
                    <small>{court.sport}</small>
                  </span>
                </label>
              ))}
          </div>
          <span className="field-hint">
            Choose up to 20 courts. A preview can contain up to 500 slots within
            a 26-hour window.
          </span>
        </div>
      </fieldset>
      {!preview ? (
        <button className="button button-full" disabled={busy}>
          {busy ? "Preparing preview…" : "Preview time slots"}
          <Icon name="arrow" size={18} />
        </button>
      ) : (
        <div className="generation-preview">
          <div className="preview-count">
            <strong>{preview.totalSlots}</strong>
            <span>
              time slots
              <br />
              {preview.slotsPerCourt} per court ·{" "}
              {money(preview.priceMinor, venue.currency)} each
            </span>
          </div>
          {preview.conflicts.length > 0 && (
            <Notice>
              Some proposed times overlap existing slots. Edit the dates, times,
              or courts before generating.
              {preview.conflicts.slice(0, 4).map((slot) => (
                <div className="small" key={slot.id}>
                  {courts.find((court) => court.id === slot.courtId)?.name ??
                    "Court"}{" "}
                  · {timeLabel(slot.startsAt, venue.timezone)} –{" "}
                  {timeLabel(slot.endsAt, venue.timezone)}
                </div>
              ))}
            </Notice>
          )}
          <div className="preview-list">
            {preview.slots.slice(0, 8).map((slot) => (
              <div key={`${slot.courtId}-${slot.startsAt}`}>
                <span>
                  {courts.find((court) => court.id === slot.courtId)?.name ??
                    "Court"}
                </span>
                <span>
                  {instantDate(slot.startsAt, venue.timezone)} ·{" "}
                  {timeLabel(slot.startsAt, venue.timezone)} –{" "}
                  {timeLabel(slot.endsAt, venue.timezone)}
                </span>
              </div>
            ))}
            {preview.totalSlots > 8 && (
              <p className="small muted">
                And {preview.totalSlots - 8} more slots in the reviewed range.
              </p>
            )}
          </div>
          {preview.unusedPeriod && (
            <div className="unused-period">
              <strong>
                {preview.unusedPeriod.durationMinutes} minutes will remain
                unused per court
              </strong>
              <p>
                {timeLabel(preview.unusedPeriod.startsAt, venue.timezone)} –{" "}
                {timeLabel(preview.unusedPeriod.endsAt, venue.timezone)}. No
                partial slot will be created.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(event) => setAck(event.target.checked)}
                  disabled={busy || uncertain}
                />
                <span>I understand and accept this unused period.</span>
              </label>
            </div>
          )}
          {uncertain ? (
            <Notice kind="info">
              The batch may have been created. Close this dialog and refresh the
              schedule before generating another batch.
            </Notice>
          ) : (
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setAck(false);
                  setError("");
                }}
              >
                Edit selection
              </button>
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  !preview.canGenerate ||
                  Boolean(preview.unusedPeriod && !ack)
                }
                onClick={() => void generate()}
              >
                {busy
                  ? "Creating slots…"
                  : `Create ${preview.totalSlots} slots`}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export function SlotForm({
  venue,
  slot,
  saved,
}: {
  venue: Venue;
  slot: Slot;
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
      await api(`/api/admin/venues/${venue.id}/slots/${slot.id}`, {
        method: "PATCH",
        auth: true,
        body: {
          version: slot.version,
          startsAt: await toInstant(
            String(fields.get("startsAt")),
            venue.timezone,
          ),
          endsAt: await toInstant(String(fields.get("endsAt")), venue.timezone),
          priceMinor: priceMinor(String(fields.get("price"))),
          isBlocked: fields.get("isBlocked") === "on",
        },
      });
      saved();
    } catch (error) {
      setError(
        error instanceof ClientError
          ? errorMessage(error)
          : error instanceof Error
            ? error.message
            : "Check the dates, times, and price.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error && <Notice>{error}</Notice>}
      <p className="small muted">
        {slot.courtName} · {venue.timezone.replaceAll("_", " ")}. Reserved slots
        must be cancelled before editing.
      </p>
      <fieldset className="form-fields" disabled={busy}>
        <label>
          Start
          <input
            type="datetime-local"
            name="startsAt"
            defaultValue={localInput(slot.startsAt, venue.timezone)}
            required
          />
        </label>
        <label>
          End
          <input
            type="datetime-local"
            name="endsAt"
            defaultValue={localInput(slot.endsAt, venue.timezone)}
            required
          />
        </label>
        <label>
          Price per slot, ₹
          <input
            type="number"
            name="price"
            min={0}
            step="0.01"
            defaultValue={(slot.priceMinor / 100).toFixed(2)}
            required
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="isBlocked"
            defaultChecked={slot.isBlocked}
          />
          <span>Block this slot from new bookings</span>
        </label>
      </fieldset>
      <button className="button button-full" disabled={busy}>
        {busy ? "Saving slot…" : "Save slot"}
      </button>
    </form>
  );
}
