"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BookingDetail, BookingList } from "../client/contracts";
import { api, ClientError, errorMessage } from "../client/api";
import { instantDate, money, timeLabel } from "../client/format";
import { useAuth } from "./providers";
import { EmptyState, Modal, Notice, Spinner, useRequest } from "./ui";
import { Icon } from "./icon";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}
    >
      {status.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}
export function BookingHistory({ admin = false }: { admin?: boolean }) {
  const { user } = useAuth();
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<BookingList["bookings"]>([]);
  const query = new URLSearchParams({ limit: "12" });
  if (cursor) query.set("cursor", cursor);
  const request = useRequest<BookingList>(
    user ? `/api/${admin ? "admin/" : ""}bookings?${query}` : null,
    true,
  );
  useEffect(() => {
    if (request.data)
      setRows((previous) =>
        cursor
          ? [
              ...previous,
              ...request.data!.bookings.filter(
                (booking) => !previous.some((item) => item.id === booking.id),
              ),
            ]
          : request.data!.bookings,
      );
  }, [request.data, cursor]);
  return (
    <main className="container bookings-page">
      {admin && (
        <Link className="back-link" href="/admin">
          <Icon name="arrow" className="rotate" size={16} />
          Admin workspace
        </Link>
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {admin ? "VENUE OPERATIONS" : "YOUR TIME TO PLAY"}
          </span>
          <h1>{admin ? "Venue bookings." : "Good games, on the calendar."}</h1>
          <p>
            {admin
              ? "View bookings and manage upcoming reservations."
              : "All your plans, in one place. See what’s next or revisit a good game."}
          </p>
        </div>
        <Link className="button button-secondary" href={admin ? "/admin" : "/"}>
          {admin ? "Manage venues" : "Find your next game"}
          <Icon name="arrow" size={18} />
        </Link>
      </div>
      {request.error && (
        <Notice>
          {request.error}{" "}
          <button className="inline-button" onClick={request.reload}>
            Try again
          </button>
        </Notice>
      )}
      {request.loading && !rows.length && (
        <Spinner label="Finding your bookings" />
      )}
      {!request.loading && !request.error && !rows.length && (
        <EmptyState
          title={admin ? "No bookings yet" : "Your next good game is waiting"}
          icon="ticket"
          action={
            <Link className="button" href={admin ? "/admin" : "/"}>
              {admin ? "Manage your venues" : "Explore venues"}
              <Icon name="arrow" />
            </Link>
          }
        >
          {admin
            ? "Customer bookings will appear here as soon as slots are reserved."
            : "Find a court, choose your time, and make a plan worth showing up for."}
        </EmptyState>
      )}
      <div className="booking-cards">
        {rows.map((booking) => (
          <Link
            className="booking-card"
            key={booking.id}
            href={`/${admin ? "admin/" : ""}bookings/${booking.id}`}
          >
            <div className="booking-card-icon">
              <Icon name="ticket" size={30} />
            </div>
            <div className="booking-card-main">
              <div className="booking-card-top">
                <span className="eyebrow">{booking.venue.city}</span>
                <StatusBadge
                  status={
                    booking.status === "CONFIRMED"
                      ? (booking.timeStatus ?? booking.status)
                      : booking.status
                  }
                />
              </div>
              <h2>{booking.venue.name}</h2>
              <p>
                {booking.counts.total}{" "}
                {booking.counts.total === 1 ? "slot" : "slots"} ·{" "}
                {booking.nextStartsAt
                  ? `Next game: ${instantDate(booking.nextStartsAt, booking.venue.timezone)}`
                  : "View booking details"}
              </p>
              {admin && (
                <p className="small">
                  {booking.customer.name} · {booking.customer.email}
                </p>
              )}
              <span className="booking-reference">{booking.reference}</span>
            </div>
            <div className="booking-card-value">
              <strong>
                {money(booking.totals.remainingMinor, booking.currency)}
              </strong>
              <span>
                View booking <Icon name="arrow" size={17} />
              </span>
            </div>
          </Link>
        ))}
      </div>
      {request.data?.nextCursor && (
        <div className="load-more">
          <button
            className="button button-secondary"
            disabled={request.loading}
            onClick={() => setCursor(request.data!.nextCursor)}
          >
            Load more bookings
          </button>
        </div>
      )}
    </main>
  );
}

export function BookingDetails({
  id,
  admin = false,
}: {
  id: string;
  admin?: boolean;
}) {
  const { user } = useAuth();
  const request = useRequest<BookingDetail>(
    user ? `/api/${admin ? "admin/" : ""}bookings/${id}` : null,
    true,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<{
    key: string;
    itemIds: string[];
    reason?: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    setConfirmed(new URLSearchParams(window.location.search).has("confirmed"));
  }, []);
  async function cancel() {
    if (busy) return;
    const operation = attempt ?? {
      key: crypto.randomUUID(),
      itemIds: [...selected].sort(),
      ...(admin ? { reason: reason.trim() } : {}),
    };
    setAttempt(operation);
    setBusy(true);
    setError("");
    try {
      await api<BookingDetail>(
        `/api/${admin ? "admin/" : ""}bookings/${id}/cancel`,
        {
          auth: true,
          method: "POST",
          key: operation.key,
          body: {
            itemIds: operation.itemIds,
            ...(admin ? { reason: operation.reason } : {}),
          },
        },
      );
      setModal(false);
      setSelected([]);
      setAttempt(null);
      setReason("");
      setUncertain(false);
      setSuccess("Your selected slots have been cancelled.");
      request.reload();
    } catch (error) {
      setError(errorMessage(error));
      const unknown =
        !(error instanceof ClientError) ||
        error.status === 0 ||
        error.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        setAttempt(null);
        request.reload();
      }
    } finally {
      setBusy(false);
    }
  }
  if (request.loading && !request.data)
    return (
      <main className="container section">
        <Spinner label="Opening your booking" />
      </main>
    );
  if (!request.data)
    return (
      <main className="container section">
        <EmptyState
          title="We couldn’t open this booking"
          icon="ticket"
          action={
            <Link className="button" href={`/${admin ? "admin/" : ""}bookings`}>
              Back to bookings
            </Link>
          }
        >
          {request.error || "Check your account and try again."}
        </EmptyState>
      </main>
    );
  const { booking } = request.data;
  const activeSelection = selected.filter((id) =>
    booking.items.some((item) => item.id === id && item.canCancel),
  );
  return (
    <main className="container booking-detail-page">
      <Link className="back-link" href={`/${admin ? "admin/" : ""}bookings`}>
        <Icon name="arrow" className="rotate" size={16} />
        All bookings
      </Link>
      {confirmed &&
        booking.status === "CONFIRMED" &&
        booking.timeStatus === "UPCOMING" && (
          <div className="confirmation-banner">
            <span className="confirmation-icon">
              <Icon name="check" size={26} />
            </span>
            <div>
              <span className="eyebrow">IT’S A PLAN</span>
              <h2>You’re booked. Let’s play.</h2>
              <p>Your slots are confirmed. We’ll see you on the court.</p>
            </div>
          </div>
        )}
      {success && <Notice kind="success">{success}</Notice>}
      {request.error && <Notice>{request.error}</Notice>}
      <div className="venue-intro">
        <div>
          <span className="eyebrow">{booking.reference}</span>
          <h1>{booking.venue.name}</h1>
          <p className="venue-location">
            <Icon name="pin" size={17} />
            {booking.venue.address}, {booking.venue.city}
          </p>
        </div>
        <StatusBadge
          status={
            booking.status === "CONFIRMED"
              ? (booking.timeStatus ?? booking.status)
              : booking.status
          }
        />
      </div>
      <div className="detail-layout">
        <section>
          <div className="section-heading compact">
            <div>
              <h2>Your courts & times</h2>
              <p className="small muted">
                Times in {booking.venue.timezone.replaceAll("_", " ")}.{" "}
                {admin
                  ? "Select upcoming slots to cancel."
                  : "Eligible slots can be cancelled more than 12 hours before their start."}
              </p>
            </div>
          </div>
          <div className="reserved-items">
            {booking.items.map((item) => (
              <article
                className={`reserved-item ${item.status === "CANCELLED" ? "cancelled" : ""}`}
                key={item.id}
              >
                <div className="reserved-item-select">
                  {item.canCancel && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.courtName}, ${instantDate(item.startsAt, booking.venue.timezone)}, ${timeLabel(item.startsAt, booking.venue.timezone)} for cancellation`}
                      checked={selected.includes(item.id)}
                      disabled={uncertain || busy}
                      onChange={(event) => {
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, item.id]
                            : previous.filter((id) => id !== item.id),
                        );
                        setAttempt(null);
                      }}
                    />
                  )}
                </div>
                <div className="reserved-item-info">
                  <div className="tags">
                    <span className="tag">{item.sport}</span>
                    <StatusBadge status={item.state} />
                  </div>
                  <h3>{item.courtName}</h3>
                  <p>
                    {instantDate(item.startsAt, booking.venue.timezone)} ·{" "}
                    {timeLabel(item.startsAt, booking.venue.timezone)} –{" "}
                    {timeLabel(item.endsAt, booking.venue.timezone)}
                  </p>
                  {item.cancellation ? (
                    <p className="small muted">
                      Cancelled{" "}
                      {instantDate(
                        item.cancellation.cancelledAt,
                        booking.venue.timezone,
                      )}
                      {item.cancellation.reason
                        ? ` · ${item.cancellation.reason}`
                        : ""}
                    </p>
                  ) : item.canCancel ? (
                    <p className="small muted">
                      Cancel before{" "}
                      {instantDate(
                        item.cancellationDeadline,
                        booking.venue.timezone,
                      )}
                      ,{" "}
                      {timeLabel(
                        item.cancellationDeadline,
                        booking.venue.timezone,
                      )}
                    </p>
                  ) : item.state === "UPCOMING" ? (
                    <p className="small muted">
                      The customer cancellation window has closed.
                    </p>
                  ) : null}
                </div>
                <strong>{money(item.priceMinor, booking.currency)}</strong>
              </article>
            ))}
          </div>
          {booking.items.some((item) => item.canCancel) && (
            <div className="cancellation-toolbar">
              <span>{activeSelection.length} slots selected</span>
              <button
                className="button button-danger"
                disabled={!activeSelection.length || busy}
                onClick={() => {
                  setError("");
                  setModal(true);
                }}
              >
                Cancel selected slots
              </button>
            </div>
          )}
          {uncertain && !modal && (
            <Notice kind="info">
              Your cancellation needs a final check.{" "}
              <button className="inline-button" onClick={() => setModal(true)}>
                Check cancellation result
              </button>
            </Notice>
          )}
        </section>
        <aside className="booking-summary">
          <span className="eyebrow">BOOKING DETAILS</span>
          <h2>Made time for play.</h2>
          <div className="booked-as">
            <Icon name="user" size={19} />
            <div>
              <strong>{booking.customer.name}</strong>
              <span>{booking.customer.email}</span>
            </div>
          </div>
          <div className="summary-line">
            <span>Original booking value</span>
            <strong>
              {money(booking.totals.originalMinor, booking.currency)}
            </strong>
          </div>
          <div className="summary-line">
            <span>Cancelled value</span>
            <strong>
              {money(booking.totals.cancelledMinor, booking.currency)}
            </strong>
          </div>
          <div className="summary-total">
            <span>Uncancelled value</span>
            <strong>
              {money(booking.totals.remainingMinor, booking.currency)}
            </strong>
          </div>
          <p className="small muted">
            No online payment or refund is processed here.
          </p>
          <Link
            className="button button-secondary button-full"
            href={`/venues/${booking.venue.id}`}
          >
            Plan another game <Icon name="arrow" size={17} />
          </Link>
          <p className="small muted">
            Booked {instantDate(booking.createdAt, booking.venue.timezone)}
          </p>
        </aside>
      </div>
      {modal && (
        <Modal
          title={uncertain ? "Check cancellation result" : "A change of plans?"}
          onClose={() => setModal(false)}
          busy={busy}
        >
          <p>
            {uncertain
              ? "Retrying checks the same cancellation attempt and won’t cancel additional slots."
              : `Cancel ${activeSelection.length} selected ${activeSelection.length === 1 ? "slot" : "slots"}? The rest of your booking stays confirmed.`}
          </p>
          {error && <Notice>{error}</Notice>}
          {admin && (
            <label className="form-label">
              Reason for cancellation
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setAttempt(null);
                }}
                maxLength={1000}
                required
                disabled={busy || uncertain}
                placeholder="Let the customer know why these slots are being cancelled."
              />
            </label>
          )}
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setModal(false)}
            >
              {uncertain ? "Close" : "Keep booking"}
            </button>
            <button
              className="button button-danger"
              disabled={
                busy ||
                (!uncertain &&
                  (!activeSelection.length || (admin && !reason.trim())))
              }
              onClick={() => void cancel()}
            >
              {busy
                ? "Checking…"
                : uncertain
                  ? "Check cancellation result"
                  : "Confirm cancellation"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
