"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Courts, Slot, Slots, Venue } from "../client/contracts";
import {
  addDays,
  dayLabel,
  instantDate,
  localDate,
  money,
  timeLabel,
} from "../client/format";
import { cartTotal } from "../client/cart";
import { useCart } from "./providers";
import { Icon } from "./icon";
import { EmptyState, Modal, Notice, Spinner, useRequest } from "./ui";
import { VenueVisual } from "./venue-browser";

export function VenueDetail({ id }: { id: string }) {
  const venue = useRequest<Venue>(`/api/venues/${id}`);
  const courts = useRequest<Courts>(`/api/venues/${id}/courts?limit=50`);
  const [date, setDate] = useState("");
  const [court, setCourt] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [replace, setReplace] = useState<Slot | null>(null);
  const { cart, ready, toggle } = useCart();
  useEffect(() => {
    if (venue.data) {
      setDate(localDate(new Date(), venue.data.timezone));
      setCourt("");
      setCursor(null);
    }
  }, [venue.data]);
  const query = new URLSearchParams({ date, limit: "100" });
  if (court) query.set("courtId", court);
  if (cursor) query.set("cursor", cursor);
  const availability = useRequest<Slots>(
    date ? `/api/venues/${id}/slots?${query}` : null,
  );
  useEffect(() => {
    if (availability.data)
      setSlots((previous) =>
        cursor
          ? [
              ...previous,
              ...availability.data!.slots.filter(
                (slot) => !previous.some((item) => item.id === slot.id),
              ),
            ]
          : availability.data!.slots,
      );
  }, [availability.data, cursor]);
  const currentCart = cart?.venue.id === id ? cart : null;
  const dates = venue.data
    ? Array.from({ length: 7 }, (_, index) =>
        addDays(localDate(new Date(), venue.data!.timezone), index),
      )
    : [];
  if (venue.loading && !venue.data)
    return (
      <main className="container section">
        <Spinner label="Finding your venue" />
      </main>
    );
  if (!venue.data)
    return (
      <main className="container section">
        <EmptyState
          title="We couldn’t open this venue"
          action={
            <Link className="button" href="/">
              Explore venues
            </Link>
          }
        >
          {venue.error || "This venue may no longer be available."}
        </EmptyState>
      </main>
    );
  const info = venue.data;
  const grouped = [...new Set(slots.map((slot) => slot.courtId))];
  function chooseDate(day: string) {
    if (!day) return;
    if (day === date && !cursor) {
      availability.reload();
      return;
    }
    setDate(day);
    setCursor(null);
    setSlots([]);
  }
  function choose(slot: Slot) {
    if (!toggle(info, slot)) {
      if (!cart?.pendingUserId) setReplace(slot);
    }
  }
  return (
    <main className="container venue-detail">
      <Link className="back-link" href="/">
        <Icon name="arrow" className="rotate" size={16} />
        All venues
      </Link>
      <div className="venue-intro">
        <div>
          <div className="tags">
            {info.sports.map((sport) => (
              <span className="tag" key={sport}>
                {sport}
              </span>
            ))}
          </div>
          <h1>{info.name}</h1>
          <p className="venue-location">
            <Icon name="pin" size={17} />
            {info.address}, {info.city}
          </p>
        </div>
        <div className="detail-price">
          {info.startingPriceMinor !== null && (
            <>
              <span>Slots from</span>
              <strong>{money(info.startingPriceMinor, info.currency)}</strong>
            </>
          )}
        </div>
      </div>
      <div className="detail-banner">
        <VenueVisual venue={info} large />
        <div className="detail-banner-copy">
          <span className="eyebrow">A LITTLE TIME WELL SPENT</span>
          <strong>
            Leave it all
            <br />
            <em>on the court.</em>
          </strong>
          <span>
            {info.city} · {info.sports.join(" · ") || "Sports"}
          </span>
        </div>
      </div>
      <div className="detail-layout">
        <section className="availability-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">MAKE IT A PLAN</span>
              <h2>Find your time to play.</h2>
            </div>
            <label className="date-input-label">
              <Icon name="calendar" size={17} />
              <span className="sr-only">Choose date</span>
              <input
                aria-label="Choose date"
                aria-invalid={Boolean(availability.fieldError("date"))}
                aria-describedby={availability.fieldError("date") ? "availability-date-error" : undefined}
                type="date"
                value={date}
                min={localDate(new Date(), info.timezone)}
                onChange={(event) => {
                  chooseDate(event.target.value);
                }}
              />
            </label>
          </div>
          {availability.fieldError("date") && <p id="availability-date-error" className="field-error">{availability.fieldError("date")}</p>}
          <p className="small muted">
            Times shown in {info.timezone.replaceAll("_", " ")}. Select any
            combination of courts and dates.
          </p>
          <div className="date-strip" role="group" aria-label="Choose a day">
            {dates.map((day) => (
              <button
                key={day}
                className={`date-tile ${date === day ? "selected" : ""}`}
                aria-pressed={date === day}
                onClick={() => {
                  chooseDate(day);
                }}
              >
                <span>
                  {dayLabel(day, {
                    weekday: "short",
                    day: undefined,
                    month: undefined,
                  })}
                </span>
                <strong>{day.slice(-2)}</strong>
                <span>
                  {dayLabel(day, {
                    month: "short",
                    weekday: undefined,
                    day: undefined,
                  })}
                </span>
              </button>
            ))}
          </div>
          <div className="court-filter">
            <label htmlFor="court-filter">Court</label>
            <select
              id="court-filter"
              aria-invalid={Boolean(availability.fieldError("courtId"))}
              aria-describedby={availability.fieldError("courtId") ? "availability-court-error" : undefined}
              value={court}
              onChange={(event) => {
                setCourt(event.target.value);
                setCursor(null);
                setSlots([]);
              }}
            >
              <option value="">All courts</option>
              {courts.data?.courts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.sport}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh availability"
              onClick={() => {
                setCursor(null);
                availability.reload();
              }}
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
          {availability.fieldError("courtId") && <p id="availability-court-error" className="field-error">{availability.fieldError("courtId")}</p>}
          {courts.error && <Notice>{courts.error} <button type="button" className="inline-button" onClick={courts.reload}>Reload courts</button></Notice>}
          {availability.error && (
            <Notice>
              {availability.error}{" "}
              <button className="inline-button" onClick={availability.reload}>
                Try again
              </button>
            </Notice>
          )}
          {(!date || availability.loading) && !slots.length ? (
            <div className="section">
              <Spinner label="Checking court times" />
            </div>
          ) : !slots.length && !availability.error ? (
            <EmptyState title="No slots for this date" icon="calendar">
              Try another day or court. New time slots are added by the venue.
            </EmptyState>
          ) : (
            grouped.map((courtId) => (
              <div className="court-group" key={courtId}>
                <div className="court-group-heading">
                  <h3>
                    <Icon name="court" size={18} />
                    {slots.find((slot) => slot.courtId === courtId)!.courtName}
                  </h3>
                  <span>
                    {slots.find((slot) => slot.courtId === courtId)!.sport}
                  </span>
                </div>
                <div className="slot-grid">
                  {slots
                    .filter((slot) => slot.courtId === courtId)
                    .map((slot) => {
                      const selected = Boolean(
                        currentCart?.items.some((item) => item.id === slot.id),
                      );
                      return (
                        <button
                          key={slot.id}
                          className={`slot-button ${selected ? "selected" : ""}`}
                          disabled={
                            !slot.isAvailable ||
                            !ready ||
                            Boolean(cart?.pendingUserId)
                          }
                          aria-pressed={selected}
                          aria-label={`${slot.courtName}, ${timeLabel(slot.startsAt, info.timezone)} to ${timeLabel(slot.endsAt, info.timezone)}, ${slot.isAvailable ? money(slot.priceMinor, info.currency) : slot.availability.toLowerCase()}`}
                          onClick={() => choose(slot)}
                        >
                          <span>
                            {timeLabel(slot.startsAt, info.timezone)}
                            {selected && <Icon name="check" size={14} />}
                          </span>
                          <small>{timeLabel(slot.endsAt, info.timezone)}</small>
                          <strong>
                            {slot.isAvailable
                              ? money(slot.priceMinor, info.currency)
                              : slot.availability.toLowerCase()}
                          </strong>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))
          )}
          {availability.data?.nextCursor && (
            <button
              className="button button-secondary"
              disabled={availability.loading}
              onClick={() => setCursor(availability.data!.nextCursor)}
            >
              Show more time slots
            </button>
          )}
          <div className="slot-legend">
            <span>
              <i />
              Available
            </span>
            <span>
              <i className="selected" />
              Selected
            </span>
            <span>
              <i className="unavailable" />
              Unavailable
            </span>
          </div>
          {info.description && (
            <div className="about-venue">
              <h2>About this venue</h2>
              <p>{info.description}</p>
            </div>
          )}
        </section>
        <aside className="booking-summary">
          <span className="eyebrow">YOUR NEXT GAME</span>
          <h2>A little time for play.</h2>
          {cart?.pendingUserId ? (
            <Notice kind="info">
              Your checkout needs a final check.{" "}
              <Link className="text-link" href="/checkout">
                Return to checkout
              </Link>{" "}
              to safely retry.
            </Notice>
          ) : currentCart ? (
            <>
              <div className="summary-items">
                {[...currentCart.items]
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((item) => (
                    <div className="summary-item" key={item.id}>
                      <Icon name="court" size={17} />
                      <div>
                        <strong>{item.courtName}</strong>
                        <span>{instantDate(item.startsAt, info.timezone)}</span>
                        <span>
                          {timeLabel(item.startsAt, info.timezone)} –{" "}
                          {timeLabel(item.endsAt, info.timezone)}
                        </span>
                      </div>
                      <strong>{money(item.priceMinor, info.currency)}</strong>
                    </div>
                  ))}
              </div>
              <div className="summary-total">
                <span>
                  {currentCart.items.length}{" "}
                  {currentCart.items.length === 1 ? "slot" : "slots"} selected
                </span>
                <strong>{money(cartTotal(currentCart), info.currency)}</strong>
              </div>
              <Link className="button button-full" href="/checkout">
                Review booking <Icon name="arrow" />
              </Link>
            </>
          ) : (
            <>
              <div className="summary-placeholder">
                <Icon name="racket" size={40} />
                <p>
                  Pick a slot or two.
                  <br />
                  We’ll save your place here.
                </p>
              </div>
              {cart && (
                <Link className="text-link" href="/checkout">
                  View your selection at {cart.venue.name}
                </Link>
              )}
            </>
          )}
          <div className="summary-note">
            <Icon name="shield" size={17} />
            <p>
              Browse first. Sign in when you’re ready to book. Slots are
              confirmed at checkout.
            </p>
          </div>
          <div className="summary-policy">
            <strong>A change of plans?</strong>
            <p>Cancel individual slots more than 12 hours before they start.</p>
          </div>
        </aside>
      </div>
      {currentCart && !cart?.pendingUserId && (
        <div className="mobile-booking-bar">
          <div>
            <strong>{money(cartTotal(currentCart), info.currency)}</strong>
            <span>{currentCart.items.length} slots selected</span>
          </div>
          <Link className="button" href="/checkout">
            Review booking <Icon name="arrow" size={17} />
          </Link>
        </div>
      )}
      {replace && (
        <Modal
          title="Play at a different venue?"
          onClose={() => setReplace(null)}
        >
          <p>
            Your current selection is at {cart?.venue.name}. A booking can
            include courts and dates at one venue.
          </p>
          <p>Start a new selection at {info.name}?</p>
          <div className="modal-actions">
            <button
              className="button button-secondary"
              onClick={() => setReplace(null)}
            >
              Keep my selection
            </button>
            <button
              className="button"
              onClick={() => {
                toggle(info, replace, true);
                setReplace(null);
              }}
            >
              Start new selection
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
