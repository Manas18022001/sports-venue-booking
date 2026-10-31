"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  Court,
  Courts,
  Slot,
  Slots,
  Venue,
  Venues,
} from "../client/contracts";
import { instantDate, localDate, money, timeLabel } from "../client/format";
import { useAuth } from "./providers";
import { EmptyState, Modal, Notice, Spinner, useRequest } from "./ui";
import { Icon } from "./icon";
import { CourtForm, VenueForm } from "./admin-forms";
import { GenerationForm, SlotForm } from "./admin-slots";
import { StatusBadge } from "./bookings";

export function AdminDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [create, setCreate] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<Venue[]>([]);
  const request = useRequest<Venues>(
    user?.role === "ADMIN"
      ? `/api/admin/venues?limit=20${cursor ? `&cursor=${cursor}` : ""}`
      : null,
    true,
  );
  useEffect(() => {
    if (request.data)
      setRows((previous) =>
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
  return (
    <main className="container admin-page">
      <div className="admin-topline">
        <span className="tag">
          <Icon name="shield" size={14} />
          ADMIN WORKSPACE
        </span>
        <Link className="text-link" href="/admin/bookings">
          View bookings <Icon name="arrow" size={17} />
        </Link>
      </div>
      <div className="section-heading">
        <div>
          <h1>
            Set the stage.
            <br />
            <em>Let them play.</em>
          </h1>
          <p>Your venues, courts, and schedules. All in one place.</p>
        </div>
        <button className="button" onClick={() => setCreate(true)}>
          <Icon name="plus" size={18} />
          Add a venue
        </button>
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
        <Spinner label="Opening your workspace" />
      )}
      {!request.loading && !request.error && !rows.length && (
        <EmptyState
          title="Every good game needs a place"
          action={
            <button className="button" onClick={() => setCreate(true)}>
              Add your first venue <Icon name="plus" />
            </button>
          }
        >
          Start with a venue, add its courts, and publish a schedule for
          customers.
        </EmptyState>
      )}
      <div className="admin-venue-list">
        {rows.map((venue) => (
          <Link
            className="admin-venue-row"
            key={venue.id}
            href={`/admin/venues/${venue.id}`}
          >
            <span className="admin-venue-icon">
              <Icon name="court" size={30} />
            </span>
            <div>
              <div className="tags">
                <span className="eyebrow">{venue.city}</span>
                <StatusBadge
                  status={venue.isActive === false ? "ARCHIVED" : "PUBLISHED"}
                />
              </div>
              <h2>{venue.name}</h2>
              <p>{venue.sports.join(" · ") || "Add your first court"}</p>
            </div>
            <span className="text-link">
              Manage venue <Icon name="arrow" size={18} />
            </span>
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
            Load more venues
          </button>
        </div>
      )}
      {create && (
        <Modal title="A new place to play" onClose={() => setCreate(false)}>
          <VenueForm
            saved={(id) => {
              setCreate(false);
              router.push(`/admin/venues/${id}`);
            }}
          />
        </Modal>
      )}
    </main>
  );
}

export function AdminVenue({ id }: { id: string }) {
  const { user } = useAuth();
  const [date, setDate] = useState("");
  const [courtFilter, setCourtFilter] = useState("");
  const [courtCursor, setCourtCursor] = useState<string | null>(null);
  const [allCourts, setAllCourts] = useState<Court[]>([]);
  const [slotCursor, setSlotCursor] = useState<string | null>(null);
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [editVenue, setEditVenue] = useState(false);
  const [courtEditor, setCourtEditor] = useState<Court | "new" | null>(null);
  const [generator, setGenerator] = useState(false);
  const [slotEditor, setSlotEditor] = useState<Slot | null>(null);
  const [success, setSuccess] = useState("");
  const enabled = user?.role === "ADMIN";
  const venue = useRequest<Venue>(
    enabled ? `/api/admin/venues/${id}` : null,
    true,
  );
  const courts = useRequest<Courts>(
    enabled
      ? `/api/admin/venues/${id}/courts?limit=50${courtCursor ? `&cursor=${courtCursor}` : ""}`
      : null,
    true,
  );
  useEffect(() => {
    if (venue.data && !date)
      setDate(localDate(new Date(), venue.data.timezone));
  }, [venue.data, date]);
  useEffect(() => {
    if (courts.data)
      setAllCourts((previous) =>
        courtCursor
          ? [
              ...previous,
              ...courts.data!.courts.filter(
                (court) => !previous.some((item) => item.id === court.id),
              ),
            ]
          : courts.data!.courts,
      );
  }, [courts.data, courtCursor]);
  const query = new URLSearchParams({ date, limit: "100" });
  if (courtFilter) query.set("courtId", courtFilter);
  if (slotCursor) query.set("cursor", slotCursor);
  const schedule = useRequest<Slots>(
    enabled && date ? `/api/admin/venues/${id}/slots?${query}` : null,
    true,
  );
  useEffect(() => {
    if (schedule.data)
      setAllSlots((previous) =>
        slotCursor
          ? [
              ...previous,
              ...schedule.data!.slots.filter(
                (slot) => !previous.some((item) => item.id === slot.id),
              ),
            ]
          : schedule.data!.slots,
      );
  }, [schedule.data, slotCursor]);
  function refreshSlots() {
    setSlotCursor(null);
    schedule.reload();
  }
  if (venue.loading && !venue.data)
    return (
      <main className="container section">
        <Spinner label="Opening venue workspace" />
      </main>
    );
  if (!venue.data)
    return (
      <main className="container section">
        <EmptyState
          title="We couldn’t open this venue"
          action={
            <Link className="button" href="/admin">
              Back to workspace
            </Link>
          }
        >
          {venue.error || "Try reopening it from your venue list."}
        </EmptyState>
      </main>
    );
  const info = venue.data;
  return (
    <main className="container admin-page">
      <Link className="back-link" href="/admin">
        <Icon name="arrow" className="rotate" size={16} />
        All venues
      </Link>
      <div className="section-heading">
        <div>
          <div className="tags">
            <span className="eyebrow">VENUE WORKSPACE</span>
            <StatusBadge
              status={info.isActive === false ? "ARCHIVED" : "PUBLISHED"}
            />
          </div>
          <h1>{info.name}</h1>
          <p>
            <Icon name="pin" size={16} />
            {info.address}, {info.city}
          </p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => setEditVenue(true)}
        >
          <Icon name="edit" size={17} />
          Edit venue
        </button>
      </div>
      {success && <Notice kind="success">{success}</Notice>}
      {info.isActive === false && (
        <Notice kind="info">
          This venue is archived. Existing bookings are retained. Publish it to
          offer new slots.
        </Notice>
      )}
      <section className="admin-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">THE SPACES</span>
            <h2>Your courts</h2>
          </div>
          <button
            className="button button-small button-secondary"
            onClick={() => setCourtEditor("new")}
          >
            <Icon name="plus" size={16} />
            Add court
          </button>
        </div>
        {courts.error && <Notice>{courts.error}</Notice>}
        <div className="court-cards">
          {allCourts.map((court) => (
            <article className="court-card" key={court.id}>
              <Icon name="court" size={28} />
              <div>
                <h3>{court.name}</h3>
                <p>
                  {court.sport} ·{" "}
                  {court.isActive === false ? "Archived" : "Active"}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Edit ${court.name}`}
                onClick={() => setCourtEditor(court)}
              >
                <Icon name="edit" size={17} />
              </button>
            </article>
          ))}
        </div>
        {!courts.loading && !allCourts.length && (
          <p className="muted">Add a court before generating time slots.</p>
        )}
        {courts.data?.nextCursor && (
          <button
            className="text-button"
            disabled={courts.loading}
            onClick={() => setCourtCursor(courts.data!.nextCursor)}
          >
            Load more courts
          </button>
        )}
      </section>
      <section className="admin-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">THE SCHEDULE</span>
            <h2>Make room for the game.</h2>
          </div>
          <button
            className="button"
            disabled={
              info.isActive === false ||
              !allCourts.some((court) => court.isActive !== false)
            }
            onClick={() => setGenerator(true)}
          >
            <Icon name="plus" size={17} />
            Generate slots
          </button>
        </div>
        <div className="schedule-filters">
          <label>
            Schedule date
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) {
                  setDate(event.target.value);
                  setSlotCursor(null);
                  setAllSlots([]);
                }
              }}
            />
          </label>
          <label>
            Court
            <select
              value={courtFilter}
              onChange={(event) => {
                setCourtFilter(event.target.value);
                setSlotCursor(null);
                setAllSlots([]);
              }}
            >
              <option value="">All courts</option>
              {allCourts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" onClick={refreshSlots}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        </div>
        {schedule.error && <Notice>{schedule.error}</Notice>}
        {schedule.loading && !allSlots.length ? (
          <Spinner label="Checking the schedule" />
        ) : !allSlots.length && !schedule.error ? (
          <EmptyState title="A fresh day, ready for play" icon="calendar">
            No slots are scheduled for this date and court. Generate a batch to
            open up the calendar.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="schedule-table">
              <caption className="sr-only">
                Court schedule in {info.timezone}
              </caption>
              <thead>
                <tr>
                  <th>Court</th>
                  <th>Time · {info.timezone.replaceAll("_", " ")}</th>
                  <th>Price</th>
                  <th>Availability</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {allSlots.map((slot) => (
                  <tr key={slot.id}>
                    <td>
                      <strong>{slot.courtName}</strong>
                      <span>{slot.sport}</span>
                    </td>
                    <td>
                      {timeLabel(slot.startsAt, info.timezone)} –{" "}
                      {timeLabel(slot.endsAt, info.timezone)}
                      <span>{instantDate(slot.startsAt, info.timezone)}</span>
                    </td>
                    <td>{money(slot.priceMinor, info.currency)}</td>
                    <td>
                      <StatusBadge status={slot.availability} />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={
                          slot.availability === "BOOKED" ||
                          slot.availability === "PAST" ||
                          slot.availability === "INACTIVE"
                        }
                        onClick={() => setSlotEditor(slot)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {schedule.data?.nextCursor && (
          <div className="load-more">
            <button
              className="button button-secondary"
              disabled={schedule.loading}
              onClick={() => setSlotCursor(schedule.data!.nextCursor)}
            >
              Load more slots
            </button>
          </div>
        )}
      </section>
      <div className="admin-links">
        <Link className="text-link" href="/admin/bookings">
          View customer bookings <Icon name="arrow" size={17} />
        </Link>
        {info.isActive !== false && (
          <Link className="text-link" href={`/venues/${info.id}`}>
            View customer page <Icon name="arrow" size={17} />
          </Link>
        )}
      </div>
      {editVenue && (
        <Modal title="Edit venue" onClose={() => setEditVenue(false)}>
          <VenueForm
            venue={info}
            saved={() => {
              setEditVenue(false);
              venue.reload();
              setSuccess("Venue details saved.");
            }}
          />
        </Modal>
      )}
      {courtEditor && (
        <Modal
          title={courtEditor === "new" ? "Add a court" : "Edit court"}
          onClose={() => setCourtEditor(null)}
        >
          <CourtForm
            venueId={id}
            {...(courtEditor === "new" ? {} : { court: courtEditor })}
            saved={() => {
              setCourtEditor(null);
              setCourtCursor(null);
              courts.reload();
              venue.reload();
              refreshSlots();
              setSuccess("Court details saved.");
            }}
          />
        </Modal>
      )}
      {generator && (
        <Modal
          title="Create time to play"
          onClose={() => {
            setGenerator(false);
            refreshSlots();
          }}
        >
          <GenerationForm
            venue={info}
            courts={allCourts}
            date={date}
            saved={(nextDate) => {
              setGenerator(false);
              setDate(nextDate);
              refreshSlots();
              venue.reload();
              setSuccess("The reviewed time slots are now published.");
            }}
          />
        </Modal>
      )}
      {slotEditor && (
        <Modal title="Edit time slot" onClose={() => setSlotEditor(null)}>
          <SlotForm
            venue={info}
            slot={slotEditor}
            saved={() => {
              setSlotEditor(null);
              refreshSlots();
              venue.reload();
              setSuccess("Slot updated.");
            }}
          />
        </Modal>
      )}
    </main>
  );
}
