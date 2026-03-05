-- One-time upgrade script for existing databases.
-- Applies checkout request workflow states, moderation/result metadata,
-- and immutable checkout appointment event logging.

BEGIN;

-- 1) Upgrade checkout appointment status enum and remap legacy values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'checkout_appointment_status'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'checkout_appointment_status'
        AND e.enumlabel = 'scheduled'
    ) THEN
      CREATE TYPE checkout_appointment_status_new AS ENUM (
        'pending',
        'accepted',
        'rejected',
        'cancelled',
        'completed'
      );

      ALTER TABLE checkout_appointments
      ALTER COLUMN status DROP DEFAULT;

      ALTER TABLE checkout_appointments
      ALTER COLUMN status TYPE checkout_appointment_status_new
      USING (
        CASE status::text
          WHEN 'scheduled' THEN 'accepted'
          WHEN 'cancelled' THEN 'cancelled'
          WHEN 'completed' THEN 'completed'
          ELSE 'pending'
        END::checkout_appointment_status_new
      );

      DROP TYPE checkout_appointment_status;
      ALTER TYPE checkout_appointment_status_new RENAME TO checkout_appointment_status;

      ALTER TABLE checkout_appointments
      ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
  ELSE
    CREATE TYPE checkout_appointment_status AS ENUM (
      'pending',
      'accepted',
      'rejected',
      'cancelled',
      'completed'
    );
  END IF;
END
$$;

-- 2) Add new enum types used by the workflow.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'checkout_appointment_result'
  ) THEN
    CREATE TYPE checkout_appointment_result AS ENUM ('pass', 'fail');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'checkout_appointment_event_type'
  ) THEN
    CREATE TYPE checkout_appointment_event_type AS ENUM (
      'requested',
      'accepted',
      'rejected',
      'passed',
      'failed',
      'cancelled'
    );
  END IF;
END
$$;

-- 3) Extend notification enum for new checkout workflow updates.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checkout_request_submitted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checkout_request_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checkout_request_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checkout_result_passed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checkout_result_failed';

-- 4) Add moderation/result metadata columns.
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS reviewed_at timestamp;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS result checkout_appointment_result;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS result_notes text;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS resulted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE checkout_appointments ADD COLUMN IF NOT EXISTS resulted_at timestamp;

-- 5) Create immutable checkout appointment events table.
CREATE TABLE IF NOT EXISTS checkout_appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES checkout_appointments(id) ON DELETE CASCADE,
  event_type checkout_appointment_event_type NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role user_role,
  from_status checkout_appointment_status,
  to_status checkout_appointment_status,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_appt_event_appt_created_idx
  ON checkout_appointment_events (appointment_id, created_at);
CREATE INDEX IF NOT EXISTS checkout_appt_event_actor_created_idx
  ON checkout_appointment_events (actor_id, created_at);
CREATE INDEX IF NOT EXISTS checkout_appt_event_type_created_idx
  ON checkout_appointment_events (event_type, created_at);

-- 6) Add queue/workflow indexes and one-pending-per-machine constraint.
CREATE INDEX IF NOT EXISTS checkout_appt_status_start_idx
  ON checkout_appointments (status, start_time);
CREATE INDEX IF NOT EXISTS checkout_appt_status_created_idx
  ON checkout_appointments (status, created_at);
CREATE INDEX IF NOT EXISTS checkout_appt_reviewed_by_idx
  ON checkout_appointments (reviewed_by);
CREATE INDEX IF NOT EXISTS checkout_appt_resulted_by_idx
  ON checkout_appointments (resulted_by);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_appt_user_machine_pending_idx
  ON checkout_appointments (user_id, machine_id)
  WHERE status = 'pending';

-- 7) Backfill immutable events for legacy appointments lacking history.
INSERT INTO checkout_appointment_events (
  appointment_id,
  event_type,
  actor_id,
  actor_role,
  from_status,
  to_status,
  metadata,
  created_at
)
SELECT
  appt.id,
  CASE
    WHEN appt.status = 'pending' THEN 'requested'::checkout_appointment_event_type
    WHEN appt.status = 'accepted' THEN 'accepted'::checkout_appointment_event_type
    WHEN appt.status = 'rejected' THEN 'rejected'::checkout_appointment_event_type
    WHEN appt.status = 'cancelled' THEN 'cancelled'::checkout_appointment_event_type
    WHEN appt.status = 'completed' AND appt.result = 'pass' THEN 'passed'::checkout_appointment_event_type
    WHEN appt.status = 'completed' AND appt.result = 'fail' THEN 'failed'::checkout_appointment_event_type
    ELSE 'accepted'::checkout_appointment_event_type
  END,
  COALESCE(appt.resulted_by, appt.reviewed_by, appt.manager_id),
  NULL::user_role,
  NULL::checkout_appointment_status,
  appt.status,
  jsonb_build_object('legacyBackfill', true),
  COALESCE(appt.updated_at, appt.created_at, now())
FROM checkout_appointments appt
WHERE NOT EXISTS (
  SELECT 1
  FROM checkout_appointment_events evt
  WHERE evt.appointment_id = appt.id
);

COMMIT;
