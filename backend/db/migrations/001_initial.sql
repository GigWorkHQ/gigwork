CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE CHECK (wallet_address ~ '^0x[a-f0-9]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_nonces (
  nonce text PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[a-f0-9]{40}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);
CREATE INDEX auth_nonces_expiry_idx ON auth_nonces (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  doer_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 20000),
  acceptance_criteria jsonb NOT NULL CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  asset text NOT NULL CHECK (asset IN ('eth', 'usdg')),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  token_address text CHECK (token_address IS NULL OR token_address ~ '^0x[a-f0-9]{40}$'),
  status text NOT NULL DEFAULT 'awaiting_funding'
    CHECK (status IN ('awaiting_funding','ready','in_progress','submitted','revision_requested','disputed','settlement_pending','completed','refunded','expired','cancelled')),
  deadline_at timestamptz,
  funding_tx_hash text UNIQUE CHECK (funding_tx_hash IS NULL OR funding_tx_hash ~ '^0x[a-f0-9]{64}$'),
  funding_block bigint,
  active_submission_id uuid,
  revision_count integer NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  funded_at timestamptz,
  claimed_at timestamptz,
  submitted_at timestamptz,
  settled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((asset = 'eth' AND token_address IS NULL) OR (asset = 'usdg' AND token_address IS NOT NULL))
);
CREATE INDEX jobs_ready_idx ON jobs (created_at DESC) WHERE status = 'ready';
CREATE INDEX jobs_doer_idx ON jobs (doer_id, status, updated_at DESC) WHERE doer_id IS NOT NULL;
CREATE INDEX jobs_client_idx ON jobs (client_id, created_at DESC);

CREATE TABLE job_escrow_wallets (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE RESTRICT,
  address text NOT NULL UNIQUE CHECK (address ~ '^0x[a-f0-9]{40}$'),
  encrypted_private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  payload_ciphertext text NOT NULL,
  payload_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, revision),
  UNIQUE (job_id, id)
);
CREATE INDEX job_submissions_history_idx ON job_submissions (job_id, revision DESC);
ALTER TABLE jobs ADD CONSTRAINT jobs_active_submission_fk
  FOREIGN KEY (id, active_submission_id) REFERENCES job_submissions(job_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE job_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES job_submissions(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  feedback_ciphertext text NOT NULL,
  feedback_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_revisions_history_idx ON job_revisions (job_id, created_at);

CREATE TABLE job_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_ciphertext text NOT NULL,
  reason_digest text NOT NULL,
  resolution text CHECK (resolution IN ('pay_doer','refund_client')),
  resolution_note_ciphertext text,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((resolution IS NULL) = (resolved_at IS NULL))
);

CREATE TABLE job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_events_history_idx ON job_events (job_id, id);

CREATE TABLE job_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('pay_doer','refund_client')),
  recipient text NOT NULL CHECK (recipient ~ '^0x[a-f0-9]{40}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
  phase text NOT NULL DEFAULT 'gas' CHECK (phase IN ('gas','payout','sweep','complete')),
  gas_nonce bigint,
  gas_signed_tx text,
  gas_tx_hash text,
  payout_nonce bigint,
  payout_signed_tx text,
  payout_tx_hash text,
  sweep_nonce bigint,
  sweep_signed_tx text,
  sweep_tx_hash text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((gas_signed_tx IS NULL) = (gas_tx_hash IS NULL)),
  CHECK ((payout_signed_tx IS NULL) = (payout_tx_hash IS NULL)),
  CHECK ((sweep_signed_tx IS NULL) = (sweep_tx_hash IS NULL))
);
CREATE UNIQUE INDEX job_settlement_gas_nonce_uq ON job_settlements (gas_nonce) WHERE gas_nonce IS NOT NULL;
CREATE INDEX job_settlement_pending_idx ON job_settlements (updated_at) WHERE status = 'pending';

