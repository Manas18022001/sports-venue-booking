-- PostgreSQL-specific invariants that are not representable in Prisma 7's
-- stable schema language. Keep these in migration history, not in db push.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized" CHECK (email = lower(btrim(email)) AND email <> ''),
  ADD CONSTRAINT "users_name_present" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "users_password_hash_present" CHECK (password_hash <> '');

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_expiry_valid" CHECK (expires_at > created_at),
  ADD CONSTRAINT "auth_sessions_revocation_valid" CHECK (revoked_at IS NULL OR revoked_at >= created_at);

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_hash_valid" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "refresh_tokens_expiry_valid" CHECK (expires_at > created_at),
  ADD CONSTRAINT "refresh_tokens_consumption_valid" CHECK (consumed_at IS NULL OR consumed_at >= created_at);

CREATE UNIQUE INDEX "refresh_tokens_one_unconsumed_per_session"
  ON "refresh_tokens" (session_id) WHERE consumed_at IS NULL;

ALTER TABLE "venues"
  ADD CONSTRAINT "venues_name_present" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "venues_address_present" CHECK (btrim(address) <> ''),
  ADD CONSTRAINT "venues_city_present" CHECK (btrim(city) <> ''),
  ADD CONSTRAINT "venues_timezone_present" CHECK (btrim(timezone) <> ''),
  ADD CONSTRAINT "venues_currency_valid" CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "courts"
  ADD CONSTRAINT "courts_name_present" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "courts_sport_present" CHECK (btrim(sport) <> '');

ALTER TABLE "slots"
  ADD CONSTRAINT "slots_interval_valid" CHECK (ends_at > starts_at AND isfinite(starts_at) AND isfinite(ends_at)),
  ADD CONSTRAINT "slots_price_nonnegative" CHECK (price_minor >= 0),
  ADD CONSTRAINT "slots_version_positive" CHECK (version > 0),
  ADD CONSTRAINT "slots_court_time_exclusion" EXCLUDE USING gist (
    court_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_reference_present" CHECK (btrim(reference) <> ''),
  ADD CONSTRAINT "bookings_customer_name_present" CHECK (btrim(customer_name) <> ''),
  ADD CONSTRAINT "bookings_customer_email_present" CHECK (btrim(customer_email) <> ''),
  ADD CONSTRAINT "bookings_currency_valid" CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_interval_valid" CHECK (ends_at > starts_at AND isfinite(starts_at) AND isfinite(ends_at)),
  ADD CONSTRAINT "booking_items_price_nonnegative" CHECK (price_minor >= 0),
  ADD CONSTRAINT "booking_items_cancellation_consistent" CHECK (
    (status = 'RESERVED' AND cancelled_at IS NULL AND cancelled_by_id IS NULL
      AND cancellation_source IS NULL AND cancellation_reason IS NULL)
    OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_at >= created_at
      AND cancelled_by_id IS NOT NULL AND cancellation_source IS NOT NULL
      AND (cancellation_source <> 'ADMIN' OR
        (cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')))
  );

CREATE UNIQUE INDEX "booking_items_one_reserved_per_slot"
  ON "booking_items" (slot_id) WHERE status = 'RESERVED';

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_operation_present" CHECK (btrim(operation) <> ''),
  ADD CONSTRAINT "idempotency_records_hash_valid" CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_records_success_only" CHECK (response_status BETWEEN 200 AND 299),
  ADD CONSTRAINT "idempotency_records_response_object" CHECK (jsonb_typeof(response_body) = 'object');

-- Slot UPDATE already owns a row lock. Reservation creation below takes this
-- same lock, making concurrent booking, blocking, and editing coordinate.
CREATE FUNCTION protect_reserved_slot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.court_id, NEW.venue_id, NEW.starts_at, NEW.ends_at, NEW.price_minor, NEW.is_blocked)
     IS DISTINCT FROM
     ROW(OLD.court_id, OLD.venue_id, OLD.starts_at, OLD.ends_at, OLD.price_minor, OLD.is_blocked) THEN
    IF EXISTS (SELECT 1 FROM booking_items WHERE slot_id = OLD.id AND status = 'RESERVED') THEN
      RAISE EXCEPTION 'Cancel active reservations before changing or blocking this slot'
        USING ERRCODE = '23514', CONSTRAINT = 'slots_reserved_details_immutable';
    END IF;
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "slots_protect_and_version"
  BEFORE UPDATE ON "slots"
  FOR EACH ROW EXECUTE FUNCTION protect_reserved_slot();

CREATE FUNCTION protect_booking_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  selected_slot slots%ROWTYPE;
  selected_court courts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reservation history must be retained'
      USING ERRCODE = '23514', CONSTRAINT = 'booking_items_history_retained';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.booking_id, NEW.slot_id, NEW.venue_id, NEW.court_name, NEW.sport,
           NEW.starts_at, NEW.ends_at, NEW.price_minor, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.booking_id, OLD.slot_id, OLD.venue_id, OLD.court_name, OLD.sport,
           OLD.starts_at, OLD.ends_at, OLD.price_minor, OLD.created_at) THEN
      RAISE EXCEPTION 'Confirmed reservation details are immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'booking_items_snapshot_immutable';
    END IF;
    IF OLD.status = 'CANCELLED' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Cancelled reservations cannot be changed or reactivated'
        USING ERRCODE = '23514', CONSTRAINT = 'booking_items_cancellation_final';
    END IF;
  END IF;

  SELECT * INTO selected_slot FROM slots WHERE id = NEW.slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced slot does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'booking_items_slot_exists';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'New reservations must begin as RESERVED'
        USING ERRCODE = '23514', CONSTRAINT = 'booking_items_initial_status';
    END IF;
    IF selected_slot.is_blocked OR selected_slot.starts_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Only open future slots can be reserved'
        USING ERRCODE = '23514', CONSTRAINT = 'booking_items_slot_bookable';
    END IF;
    SELECT * INTO STRICT selected_court FROM courts WHERE id = selected_slot.court_id;
    IF ROW(NEW.venue_id, NEW.starts_at, NEW.ends_at, NEW.price_minor, NEW.court_name, NEW.sport)
       IS DISTINCT FROM
       ROW(selected_slot.venue_id, selected_slot.starts_at, selected_slot.ends_at,
           selected_slot.price_minor, selected_court.name, selected_court.sport) THEN
      RAISE EXCEPTION 'Reservation snapshots must match the selected slot and court'
        USING ERRCODE = '23514', CONSTRAINT = 'booking_items_snapshot_matches_slot';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_items_protect_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "booking_items"
  FOR EACH ROW EXECUTE FUNCTION protect_booking_item();

COMMIT;
