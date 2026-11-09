-- A job payout whose transaction reverts stops retrying and waits for a logged team retry, like escrow transfers do.
CREATE TABLE job_settlement_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES job_settlements(id) ON DELETE RESTRICT,
  retried_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  failed_phase text NOT NULL CHECK (failed_phase IN ('gas','payout','sweep')),
  previous_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_settlements_failed_idx ON job_settlements (updated_at) WHERE status = 'failed';
