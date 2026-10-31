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
import { api, ClientError } from "../client/api";
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
import { checkedField, FormValidationError } from "../client/form-errors";
import { FieldError, FormErrors, useFormErrors } from "./form-errors";

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
  const errors = useFormErrors({ startsAt: "Start", endsAt: "End", durationMinutes: { label: "Slot duration", name: "duration" }, priceMinor: { label: "Price per slot", name: "price" }, courtIds: "Courts", acknowledgeUnusedPeriod: "Unused period acknowledgement", previewToken: "Preview" });
  const [uncertain, setUncertain] = useState(false);
  useDialogBusy(busy);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preview) return;
    const fields = new FormData(event.currentTarget);
    errors.clear();
    setBusy(true);
    try {
      const startsAt = await checkedField("startsAt", () => toInstant(
        String(fields.get("startsAt")),
        venue.timezone,
      ));
      const endsAt = await checkedField("endsAt", () => toInstant(
        String(fields.get("endsAt")),
        venue.timezone,
      ));
      const input: Generation = {
        courtIds: fields.getAll("courtIds").map(String),
        startsAt,
        endsAt,
        durationMinutes: Number(fields.get("duration")),
        priceMinor: await checkedField("priceMinor", () => priceMinor(String(fields.get("price")))),
      };
      if (!input.courtIds.length || input.courtIds.length > 20)
        throw new FormValidationError([{ field: "courtIds", message: "Choose between 1 and 20 courts." }]);
      const result = await api<Preview>(
        `/api/admin/venues/${venue.id}/slots/preview`,
        { method: "POST", body: input, auth: true },
      );
      setPlan(input);
      setPreview(result);
      setAck(false);
    } catch (error) {
      errors.report(error, error instanceof ClientError && error.code === "CONFLICT"
        ? "The venue or selected courts are no longer active. Close this dialog and reload the venue before choosing courts."
        : undefined);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!plan || !preview || busy || uncertain) return;
    setBusy(true);
    errors.clear();
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
      errors.report(error, error instanceof ClientError && error.code === "CONFLICT"
        ? "The venue or selected courts changed. Close this dialog and reload the venue before generating another batch."
        : undefined);
      if (
        !(error instanceof ClientError) ||
        error.status === 0 ||
        error.status >= 500
      )
        setUncertain(true);
      if (error instanceof ClientError && ["PREVIEW_EXPIRED", "SLOT_OVERLAP"].includes(error.code))
        setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form {...errors.formProps} className="form-stack" onSubmit={(event) => void review(event)}>
      <p className="small muted">
        Create a schedule for {venue.name}. All dates and times are in{" "}
        {venue.timezone.replaceAll("_", " ")}.
      </p>
      <FormErrors errors={errors} />
      <fieldset className="form-fields" disabled={busy || Boolean(preview)}>
        <div className="form-row">
          <label>
            Start
            <input
              name="startsAt"
              {...errors.input("startsAt")}
              type="datetime-local"
              required
              defaultValue={`${date}T09:00`}
            />
            <FieldError errors={errors} field="startsAt" />
          </label>
          <label>
            End
            <input
              name="endsAt"
              {...errors.input("endsAt")}
              type="datetime-local"
              required
              defaultValue={`${date}T22:00`}
            />
            <FieldError errors={errors} field="endsAt" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Slot duration, minutes
            <input
              name="duration"
              {...errors.input("durationMinutes")}
              type="number"
              min={5}
              max={1440}
              step={1}
              defaultValue={60}
              required
            />
            <FieldError errors={errors} field="durationMinutes" />
          </label>
          <label>
            Price per slot, ₹
            <input
              name="price"
              {...errors.input("priceMinor")}
              inputMode="decimal"
              type="number"
              min={0}
              step="0.01"
              defaultValue="500"
              required
            />
            <FieldError errors={errors} field="priceMinor" />
          </label>
        </div>
        <div role="group" aria-labelledby="generation-courts-label" aria-describedby={errors.fieldMessage("courtIds") ? errors.errorId("courtIds") : undefined}>
          <span className="form-label" id="generation-courts-label">Courts</span>
          <div className="generation-courts">
            {courts
              .filter((court) => court.isActive !== false)
              .map((court) => (
                <label className="check-label" key={court.id}>
                  <input
                    name="courtIds"
                    {...errors.input("courtIds")}
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
          <FieldError errors={errors} field="courtIds" />
          <span className="field-hint">
            Per batch: 1–20 courts, up to 500 slots across all courts, and at most
            26 hours between Start and End. Generate additional batches for other dates.
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
                  name="acknowledgeUnusedPeriod"
                  {...errors.input("acknowledgeUnusedPeriod")}
                  checked={ack}
                  onChange={(event) => setAck(event.target.checked)}
                  disabled={busy || uncertain}
                />
                <span>I understand and accept this unused period.</span>
              </label>
              <FieldError errors={errors} field="acknowledgeUnusedPeriod" />
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
                  errors.clear();
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
  const errors = useFormErrors({ startsAt: "Start", endsAt: "End", priceMinor: { label: "Price per slot", name: "price" }, isBlocked: "Block slot", version: "Slot version" });
  useDialogBusy(busy);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    errors.clear();
    try {
      await api(`/api/admin/venues/${venue.id}/slots/${slot.id}`, {
        method: "PATCH",
        auth: true,
        body: {
          version: slot.version,
          startsAt: await checkedField("startsAt", () => toInstant(
            String(fields.get("startsAt")),
            venue.timezone,
          )),
          endsAt: await checkedField("endsAt", () => toInstant(String(fields.get("endsAt")), venue.timezone)),
          priceMinor: await checkedField("priceMinor", () => priceMinor(String(fields.get("price")))),
          isBlocked: fields.get("isBlocked") === "on",
        },
      });
      saved();
    } catch (error) {
      errors.report(error, error instanceof ClientError && error.code === "STALE_SLOT"
        ? "This slot changed. Close this dialog, refresh the schedule, and reopen the slot before saving."
        : error instanceof ClientError && (error.status === 0 || error.status >= 500)
          ? "We couldn’t confirm whether the slot was updated. Close this dialog and refresh the schedule before editing it again."
          : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form {...errors.formProps} className="form-stack" onSubmit={(event) => void submit(event)}>
      <FormErrors errors={errors} />
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
            {...errors.input("startsAt")}
            defaultValue={localInput(slot.startsAt, venue.timezone)}
            required
          />
          <FieldError errors={errors} field="startsAt" />
        </label>
        <label>
          End
          <input
            type="datetime-local"
            name="endsAt"
            {...errors.input("endsAt")}
            defaultValue={localInput(slot.endsAt, venue.timezone)}
            required
          />
          <FieldError errors={errors} field="endsAt" />
        </label>
        <label>
          Price per slot, ₹
          <input
            type="number"
            name="price"
            {...errors.input("priceMinor")}
            min={0}
            step="0.01"
            defaultValue={(slot.priceMinor / 100).toFixed(2)}
            required
          />
          <FieldError errors={errors} field="priceMinor" />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="isBlocked"
            {...errors.input("isBlocked")}
            defaultChecked={slot.isBlocked}
          />
          <span>Block this slot from new bookings</span>
        </label>
        <FieldError errors={errors} field="isBlocked" />
      </fieldset>
      <button className="button button-full" disabled={busy}>
        {busy ? "Saving slot…" : "Save slot"}
      </button>
    </form>
  );
}
