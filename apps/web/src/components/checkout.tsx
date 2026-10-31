"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingDetail } from "../client/contracts";
import { api, ClientError, errorMessage } from "../client/api";
import { cartTotal } from "../client/cart";
import { instantDate, money, timeLabel } from "../client/format";
import { useAuth, useCart } from "./providers";
import { EmptyState, Notice, Spinner } from "./ui";
import { Icon } from "./icon";

export function Checkout() {
  const { cart, ready, remove, clear, pending } = useCart();
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  if (!ready)
    return (
      <main className="container section">
        <Spinner label="Loading your selection" />
      </main>
    );
  if (!cart)
    return (
      <main className="container section">
        <EmptyState
          title="A good game starts with a court"
          icon="ticket"
          action={
            <Link className="button" href="/">
              Explore venues <Icon name="arrow" />
            </Link>
          }
        >
          Your selection is empty. Find a venue and pick your time to play.
        </EmptyState>
      </main>
    );
  const selection = cart;
  const anotherAccount = Boolean(
    selection.pendingUserId &&
    auth.user &&
    selection.pendingUserId !== auth.user.id,
  );
  async function confirm() {
    if (!auth.user || busy || anotherAccount) return;
    setBusy(true);
    setError("");
    setConflict(false);
    pending(auth.user.id);
    try {
      const result = await api<BookingDetail>("/api/bookings", {
        method: "POST",
        auth: true,
        key: selection.key,
        body: {
          venueId: selection.venue.id,
          currency: selection.venue.currency,
          items: selection.items.map((item) => ({
            slotId: item.id,
            version: item.version,
            priceMinor: item.priceMinor,
          })),
        },
      });
      clear();
      router.replace(`/bookings/${result.booking.id}?confirmed=1`);
    } catch (error) {
      setError(errorMessage(error));
      if (
        error instanceof ClientError &&
        error.status > 0 &&
        error.status < 500
      ) {
        pending(null);
        setConflict(error.status === 409);
        if (error.status === 401) router.push("/login?next=%2Fcheckout");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="container checkout-page">
      <Link className="back-link" href={`/venues/${selection.venue.id}`}>
        <Icon name="arrow" className="rotate" size={16} />
        Back to venue
      </Link>
      <span className="eyebrow">ONE STEP CLOSER TO PLAY</span>
      <h1>Make it a game.</h1>
      <p className="page-subtitle">
        Review your courts and times. We’ll take care of the booking.
      </p>
      <div className="checkout-layout">
        <section>
          <div className="checkout-venue">
            <span className="empty-icon">
              <Icon name="court" size={26} />
            </span>
            <div>
              <h2>{selection.venue.name}</h2>
              <span className="muted">
                Times in {selection.venue.timezone.replaceAll("_", " ")}
              </span>
            </div>
          </div>
          <div className="checkout-items">
            {[...selection.items]
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map((item) => (
                <article className="checkout-item" key={item.id}>
                  <div className="checkout-date">
                    <strong>
                      {
                        instantDate(
                          item.startsAt,
                          selection.venue.timezone,
                        ).split(" ")[1]
                      }
                    </strong>
                    <span>
                      {instantDate(item.startsAt, selection.venue.timezone)
                        .split(" ")
                        .slice(2)
                        .join(" ")}
                    </span>
                  </div>
                  <div className="checkout-item-info">
                    <span className="eyebrow">{item.sport}</span>
                    <h3>{item.courtName}</h3>
                    <span>
                      <Icon name="calendar" size={15} />
                      {instantDate(item.startsAt, selection.venue.timezone)}
                    </span>
                    <span>
                      <Icon name="clock" size={15} />
                      {timeLabel(
                        item.startsAt,
                        selection.venue.timezone,
                      )} – {timeLabel(item.endsAt, selection.venue.timezone)}
                    </span>
                  </div>
                  <div className="checkout-item-price">
                    <strong>
                      {money(item.priceMinor, selection.venue.currency)}
                    </strong>
                    <button
                      className="text-button"
                      disabled={busy || Boolean(selection.pendingUserId)}
                      onClick={() => remove(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <div className="policy-card">
            <Icon name="info" />
            <div>
              <h3>A little flexibility for your plans.</h3>
              <p>
                You can cancel individual slots more than 12 hours before their
                start time. Bookings within 12 hours can’t be cancelled by
                customers.
              </p>
            </div>
          </div>
        </section>
        <aside className="booking-summary checkout-summary">
          <span className="eyebrow">BOOKING SUMMARY</span>
          <h2>All set to play?</h2>
          <div className="summary-line">
            <span>Selected time slots</span>
            <strong>{selection.items.length}</strong>
          </div>
          <div className="summary-total">
            <span>Total booking value</span>
            <strong>
              {money(cartTotal(selection), selection.venue.currency)}
            </strong>
          </div>
          <p className="small muted">
            No online payment is collected in this application.
          </p>
          {error && <Notice>{error}</Notice>}
          {conflict && (
            <Link
              className="button button-secondary button-full"
              href={`/venues/${selection.venue.id}`}
            >
              Review updated availability
            </Link>
          )}
          {selection.pendingUserId && (
            <Notice kind="info">
              {anotherAccount
                ? "This checkout was started with another account. Sign in to that account to check its result."
                : "We’re checking this same booking attempt. Retrying uses your original request and won’t create a duplicate booking."}{" "}
              <Link className="text-link" href="/bookings">
                Check My bookings
              </Link>
            </Notice>
          )}
          {auth.error ? (
            <>
              <Notice>{auth.error}</Notice>
              <button className="button button-secondary" onClick={auth.reload}>
                Check session again
              </button>
            </>
          ) : auth.loading ? (
            <Spinner label="Checking your session" />
          ) : auth.user ? (
            <>
              <div className="booked-as">
                <Icon name="user" size={17} />
                <div>
                  <strong>Booking as {auth.user.name}</strong>
                  <span>{auth.user.email}</span>
                </div>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  I’ve checked the dates, times, and cancellation policy.
                </span>
              </label>
              <button
                className="button button-full"
                disabled={busy || !acknowledged || anotherAccount}
                onClick={() => void confirm()}
              >
                {busy
                  ? "Confirming your booking…"
                  : selection.pendingUserId
                    ? "Check booking result"
                    : "Confirm booking"}
                <Icon name="arrow" size={18} />
              </button>
            </>
          ) : (
            <>
              <p className="small">
                Your courts and times are saved. Sign in to confirm your
                booking.
              </p>
              <Link
                className="button button-full"
                href="/login?next=%2Fcheckout"
              >
                Sign in to book <Icon name="arrow" size={18} />
              </Link>
              <Link
                className="text-link centered"
                href="/register?next=%2Fcheckout"
              >
                New here? Create an account
              </Link>
            </>
          )}
          <div className="summary-note">
            <Icon name="shield" size={17} />
            <p>
              Your slots are confirmed together. If any slot becomes
              unavailable, no partial booking is made.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
