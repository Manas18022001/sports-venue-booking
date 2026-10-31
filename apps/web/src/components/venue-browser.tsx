"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Venue, Venues } from "../client/contracts";
import { money, sports } from "../client/format";
import { Icon } from "./icon";
import { EmptyState, Notice, useRequest } from "./ui";

export function VenueVisual({
  venue,
  large = false,
}: {
  venue: Pick<Venue, "name" | "imageUrl" | "sports">;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [venue.imageUrl]);
  const sport = venue.sports[0] ?? "Sport";
  return (
    <div
      className={`venue-visual ${large ? "venue-visual-large" : ""} visual-${sport.toLowerCase().replace(/[^a-z]/g, "")}`}
    >
      {venue.imageUrl && !failed ? (
        <img
          src={venue.imageUrl}
          alt={`${venue.name} venue`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="court-illustration"
          role="img"
          aria-label={`${sport} court illustration; venue photo not provided`}
        >
          <div className="court-outline">
            <div className="court-net" />
            <div className="court-inner" />
            <div className="court-midline" />
            <span className="court-ball" />
          </div>
          <span className="illustration-caption">A LITTLE SPACE TO PLAY</span>
          <span className="photo-label">Court illustration</span>
        </div>
      )}
    </div>
  );
}
export function VenueCard({ venue }: { venue: Venue }) {
  return (
    <Link className="venue-card" href={`/venues/${venue.id}`}>
      <div className="venue-card-image">
        <VenueVisual venue={venue} />
        <span className="venue-sport-label">
          {venue.sports[0] ?? "Sports venue"}
          {venue.sports.length > 1 ? ` +${venue.sports.length - 1}` : ""}
        </span>
        <span className="card-arrow">
          <Icon name="arrow" />
        </span>
      </div>
      <div className="venue-card-body">
        <p className="venue-location">
          <Icon name="pin" size={14} />
          {venue.city}
        </p>
        <h3>{venue.name}</h3>
        <p className="venue-card-address">{venue.address}</p>
        <div className="venue-card-bottom">
          <span>
            {venue.startingPriceMinor === null ? (
              "Check the schedule"
            ) : (
              <>
                <strong>
                  {money(venue.startingPriceMinor, venue.currency)}
                </strong>
                <span> / slot onwards</span>
              </>
            )}
          </span>
          <span className="text-link">View slots</span>
        </div>
      </div>
    </Link>
  );
}
export function HomeHero() {
  return (
    <section className="container hero">
      <div className="hero-copy">
        <span className="eyebrow">
          <span className="tiny-line" />
          LESS SCROLLING. MORE PLAYING.
        </span>
        <h1>
          Your next
          <br />
          <em>great game</em>
          <br />
          starts here<span className="accent-dot">.</span>
        </h1>
        <p>
          Find a court. Rally your people.
          <br />
          Make a little room for play.
        </p>
        <a className="button hero-button" href="#venues">
          Find your court <Icon name="arrow" />
        </a>
        <div className="hero-footnote">
          <span className="hero-sport-icon">
            <Icon name="racket" size={22} />
          </span>
          <span>
            For the early birds, the after-work crews,
            <br />
            and the “one more game” people.
          </span>
        </div>
      </div>
      <div className="hero-art">
        <div className="hero-photo">
          <Image
            src="/images/turfit-courts.png"
            alt="Sunlit green tennis courts surrounded by trees"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 46vw"
          />
          <div className="photo-shade" />
          <div className="hero-photo-caption">
            <span>THE BEST PLANS START WITH</span>
            <strong>“Let’s play.”</strong>
          </div>
        </div>
        <div className="hero-stamp">
          <Icon name="court" size={28} />
          <span>
            FIND YOUR
            <br />
            <b>HAPPY PLACE.</b>
          </span>
        </div>
        <span className="hero-coordinate">A COURT. A CREW. A GOOD TIME.</span>
      </div>
    </section>
  );
}
export function VenueBrowser() {
  const [city, setCity] = useState("");
  const [appliedCity, setAppliedCity] = useState("");
  const [sport, setSport] = useState("All sports");
  const [cursor, setCursor] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const query = new URLSearchParams({ limit: "12" });
  if (appliedCity) query.set("city", appliedCity);
  if (sport !== "All sports") query.set("sport", sport);
  if (cursor) query.set("cursor", cursor);
  const request = useRequest<Venues>(`/api/venues?${query}`);
  useEffect(() => {
    if (request.data)
      setVenues((previous) =>
        cursor
          ? [
              ...previous,
              ...request.data!.venues.filter(
                (venue) => !previous.some((item) => item.id === venue.id),
              ),
            ]
          : request.data!.venues,
      );
  }, [request.data, cursor]);
  function filter(event: FormEvent) {
    event.preventDefault();
    if (city.trim() === appliedCity && !cursor) {
      request.reload();
      return;
    }
    setCursor(null);
    setVenues([]);
    setAppliedCity(city.trim());
  }
  return (
    <section id="venues" className="venue-section">
      <div className="container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR GAME, YOUR PLACE</span>
            <h2>Where are we playing?</h2>
            <p>Great spaces for whatever gets you moving.</p>
          </div>
          <form className="city-search" onSubmit={filter}>
            <Icon name="pin" size={18} />
            <label className="sr-only" htmlFor="city">
              Search by city
            </label>
            <input
              id="city"
              name="city"
              aria-invalid={Boolean(request.fieldError("city"))}
              aria-describedby={request.fieldError("city") ? "venue-city-error" : undefined}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Search your city"
              maxLength={100}
            />
            <button type="submit" aria-label="Search venues">
              <Icon name="search" size={19} />
            </button>
          </form>
        </div>
        {request.fieldError("city") && <p id="venue-city-error" className="field-error">{request.fieldError("city")}</p>}
        <div
          className="sports-filter"
          role="group"
          aria-label="Filter by sport"
        >
          {sports.map((item) => (
            <button
              key={item}
              className={`sport-chip ${sport === item ? "selected" : ""}`}
              aria-pressed={sport === item}
              onClick={() => {
                if (item === sport && !cursor) {
                  request.reload();
                  return;
                }
                setSport(item);
                setCursor(null);
                setVenues([]);
              }}
            >
              <Icon
                name={
                  item === "All sports"
                    ? "court"
                    : item === "Tennis" ||
                        item === "Badminton" ||
                        item === "Pickleball"
                      ? "racket"
                      : "ball"
                }
                size={18}
              />
              {item}
            </button>
          ))}
        </div>
        {request.error && (
          <Notice>
            {request.error}{" "}
            <button className="inline-button" onClick={request.reload}>
              Try again
            </button>
          </Notice>
        )}
        <div className="venue-grid">
          {venues.map((venue) => (
            <VenueCard key={venue.id} venue={venue} />
          ))}
          {request.loading &&
            !venues.length &&
            Array.from({ length: 3 }, (_, index) => (
              <div className="venue-skeleton" key={index} aria-hidden="true">
                <div />
                <span />
                <span />
              </div>
            ))}
        </div>
        {!request.loading && !request.error && !venues.length && (
          <EmptyState
            title={
              appliedCity || sport !== "All sports"
                ? "No venues match just yet"
                : "Good games are on the way"
            }
            action={
              appliedCity || sport !== "All sports" ? (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setCity("");
                    setAppliedCity("");
                    setSport("All sports");
                    setCursor(null);
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {appliedCity || sport !== "All sports"
              ? "Try another city or sport to find a place to play."
              : "There aren’t any published venues yet. Check back soon, or sign in as an admin to add your first venue."}
          </EmptyState>
        )}
        {request.data?.nextCursor && (
          <div className="load-more">
            <button
              className="button button-secondary"
              disabled={request.loading}
              onClick={() => setCursor(request.data!.nextCursor)}
            >
              {request.loading ? "Finding more…" : "Explore more venues"}
              <Icon name="down" size={17} />
            </button>
          </div>
        )}
        <div className="how-it-works">
          <div>
            <span>01</span>
            <h3>Find your spot</h3>
            <p>A court for your sport, in your city.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Make it yours</h3>
            <p>Pick the courts and times that work for you.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Show up. Play on.</h3>
            <p>Your plans are sorted. The game is yours.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
