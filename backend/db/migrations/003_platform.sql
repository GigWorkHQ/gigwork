-- Platform features beyond single jobs: pay handles, agent API keys, multi-payout escrows,
-- quick-task batches, milestone gigs, recurring contracts, reviewers, tips, history shares, referrals.

ALTER TABLE users ADD COLUMN handle text UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,24}$');
ALTER TABLE users ADD COLUMN referral_code text UNIQUE CHECK (referral_code ~ '^[a-z0-9]{8}$');
ALTER TABLE users ADD COLUMN referred_by uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN referred_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_no_self_referral CHECK (referred_by IS NULL OR referred_by <> id);
CREATE INDEX users_referred_by_idx ON users (referred_by) WHERE referred_by IS NOT NULL;

-- Jobs: review window for default approval.
ALTER TABLE jobs ADD COLUMN review_due_at timestamptz;
-- Jobs already in review when this ships get the default window from their submission time.
UPDATE jobs SET review_due_at = submitted_at + interval '72 hours' WHERE status = 'submitted' AND submitted_at IS NOT NULL;
CREATE INDEX jobs_review_due_idx ON jobs (review_due_at) WHERE status = 'submitted';
CREATE INDEX jobs_deadline_idx ON jobs (deadline_at) WHERE status IN ('awaiting_funding','ready');

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_keys_user_idx ON api_keys (user_id, created_at DESC);

-- Escrow accounts that can make many payouts (batches, gigs, contracts, the bonus vault).
CREATE TABLE escrow_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('batch','gig','contract','bonus_vault')),
  address text NOT NULL UNIQUE CHECK (address ~ '^0x[a-f0-9]{40}$'),
  encrypted_private_key text NOT NULL,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX escrow_single_bonus_vault ON escrow_accounts (kind) WHERE kind = 'bonus_vault';

-- Verified inbound USDG transfers into an escrow account. A transaction can fund exactly one thing.
CREATE TABLE escrow_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id uuid NOT NULL REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('batch','milestone','pay_period')),
  ref_id uuid NOT NULL,
  tx_hash text NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[a-f0-9]{64}$'),
  from_wallet text NOT NULL CHECK (from_wallet ~ '^0x[a-f0-9]{40}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  block_number bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose, ref_id)
);

-- Outbound USDG payouts from an escrow account. One transfer per (kind, ref) makes credit idempotent.
CREATE TABLE escrow_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id uuid NOT NULL REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('assignment_pay','batch_refund','milestone_pay','milestone_refund','pay_period','pay_period_refund','referral_bonus')),
  ref_id uuid NOT NULL,
  recipient_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  recipient text NOT NULL CHECK (recipient ~ '^0x[a-f0-9]{40}$'),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
  payout_note text,
  nonce bigint,
  signed_tx text,
  tx_hash text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (kind, ref_id),
  CHECK ((signed_tx IS NULL) = (tx_hash IS NULL))
);
CREATE INDEX escrow_transfers_pending_idx ON escrow_transfers (escrow_id, created_at) WHERE status = 'pending';
CREATE INDEX escrow_transfers_recipient_idx ON escrow_transfers (recipient_id, created_at DESC);
CREATE UNIQUE INDEX escrow_transfers_nonce_uq ON escrow_transfers (escrow_id, nonce) WHERE nonce IS NOT NULL;

-- Gas sent from the gas wallet to an escrow account so it can pay out.
CREATE TABLE gas_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id uuid NOT NULL REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  nonce bigint NOT NULL UNIQUE,
  amount_wei numeric(78,0) NOT NULL CHECK (amount_wei > 0),
  signed_tx text NOT NULL,
  tx_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gas_topups_pending_idx ON gas_topups (escrow_id) WHERE status = 'pending';

-- Quick tasks and agent batches.
CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  escrow_id uuid NOT NULL UNIQUE REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('web','agent')),
  task_type text NOT NULL CHECK (task_type IN ('judge','verify','label','test','other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  instructions text NOT NULL CHECK (char_length(instructions) BETWEEN 20 AND 20000),
  pay_raw numeric(78,0) NOT NULL CHECK (pay_raw > 0),
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 240),
  items_count integer NOT NULL CHECK (items_count BETWEEN 1 AND 1000),
  workers_per_item integer NOT NULL CHECK (workers_per_item BETWEEN 1 AND 50),
  claim_minutes integer NOT NULL CHECK (claim_minutes BETWEEN 2 AND 240),
  review_hours integer NOT NULL CHECK (review_hours BETWEEN 24 AND 336),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 60),
  total_raw numeric(78,0) NOT NULL CHECK (total_raw > 0),
  status text NOT NULL DEFAULT 'awaiting_funding' CHECK (status IN ('awaiting_funding','live','closing','closed','cancelled')),
  funded_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batches_live_idx ON batches (created_at DESC) WHERE status = 'live';
CREATE INDEX batches_client_idx ON batches (client_id, created_at DESC);

CREATE TABLE batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 1),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 5000),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  UNIQUE (batch_id, position)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES batch_items(id) ON DELETE RESTRICT,
  worker_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','released','submitted','credited','rejected','disputed','rejected_final')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL,
  submitted_at timestamptz,
  review_due_at timestamptz,
  answer_ciphertext text,
  answer_digest text,
  rejection_ciphertext text,
  rejected_at timestamptz,
  dispute_due_at timestamptz,
  credited_at timestamptz,
  credit_cause text CHECK (credit_cause IN ('client_approval','default_approval','review_resolution')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, worker_id)
);
CREATE INDEX assignments_worker_idx ON assignments (worker_id, updated_at DESC);
CREATE INDEX assignments_batch_idx ON assignments (batch_id, status);
CREATE INDEX assignments_lease_idx ON assignments (lease_until) WHERE status = 'claimed';
CREATE INDEX assignments_review_due_idx ON assignments (review_due_at) WHERE status = 'submitted';
CREATE INDEX assignments_dispute_due_idx ON assignments (dispute_due_at) WHERE status = 'rejected';

-- Milestone gigs.
CREATE TABLE gigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  invited_worker_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  escrow_id uuid NOT NULL UNIQUE REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 20000),
  category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 60),
  review_hours integer NOT NULL CHECK (review_hours BETWEEN 72 AND 336),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','active','completed','cancelled')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (worker_id IS NULL OR worker_id <> client_id),
  CHECK (invited_worker_id IS NULL OR invited_worker_id <> client_id)
);
CREATE INDEX gigs_open_idx ON gigs (created_at DESC) WHERE status = 'open' AND invited_worker_id IS NULL;
CREATE INDEX gigs_client_idx ON gigs (client_id, updated_at DESC);
CREATE INDEX gigs_worker_idx ON gigs (worker_id, updated_at DESC);
CREATE INDEX gigs_invited_idx ON gigs (invited_worker_id) WHERE invited_worker_id IS NOT NULL;

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES gigs(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 20),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  due_days integer CHECK (due_days IS NULL OR due_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'unfunded' CHECK (status IN ('unfunded','funded','in_progress','submitted','revision_requested','approved','disputed','refunded','split','cancelled')),
  funded_at timestamptz,
  started_at timestamptz,
  due_at timestamptz,
  submitted_at timestamptz,
  review_due_at timestamptz,
  revision_count integer NOT NULL DEFAULT 0,
  delivery_ciphertext text,
  delivery_digest text,
  approved_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gig_id, position)
);
CREATE INDEX milestones_review_due_idx ON milestones (review_due_at) WHERE status = 'submitted';

-- Recurring contracts paid by reserved pay periods ("Pay runs").
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  escrow_id uuid NOT NULL UNIQUE REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 20000),
  rate_raw numeric(78,0) NOT NULL CHECK (rate_raw > 0),
  period_days integer NOT NULL CHECK (period_days IN (7,14,30)),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','active','declined','withdrawn','ended')),
  starts_at timestamptz,
  proposed_rate_raw numeric(78,0) CHECK (proposed_rate_raw IS NULL OR proposed_rate_raw > 0),
  proposed_at timestamptz,
  ended_at timestamptz,
  ended_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (worker_id <> client_id)
);
CREATE INDEX contracts_client_idx ON contracts (client_id, updated_at DESC);
CREATE INDEX contracts_worker_idx ON contracts (worker_id, updated_at DESC);

CREATE TABLE pay_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  number integer NOT NULL CHECK (number >= 1),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  status text NOT NULL DEFAULT 'awaiting_funding' CHECK (status IN ('awaiting_funding','reserved','paid','refunded','cancelled')),
  reserved_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, number),
  CHECK (ends_at > starts_at)
);
CREATE INDEX pay_periods_due_idx ON pay_periods (ends_at) WHERE status = 'reserved';

-- External reviewers and review cases (disputes on jobs, quick-task rejections, milestones).
CREATE TABLE reviewers (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  added_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL CHECK (subject_kind IN ('job','assignment','milestone')),
  subject_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','assigned','escalated','resolved')),
  reviewer_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  draw_after timestamptz NOT NULL,
  due_at timestamptz,
  draws integer NOT NULL DEFAULT 0,
  excluded_reviewers uuid[] NOT NULL DEFAULT '{}',
  resolution text CHECK (resolution IN ('pay_worker','refund_client','split')),
  worker_share_bps integer CHECK (worker_share_bps BETWEEN 0 AND 10000),
  note_ciphertext text,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_id)
);
CREATE INDEX review_cases_open_idx ON review_cases (status, draw_after) WHERE status <> 'resolved';
CREATE INDEX review_cases_reviewer_idx ON review_cases (reviewer_id) WHERE status = 'assigned';

-- Tips paid directly client -> worker on credited work, verified on-chain.
CREATE TABLE tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject_kind text NOT NULL CHECK (subject_kind IN ('job','assignment','milestone','pay_period')),
  subject_id uuid NOT NULL,
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  tx_hash text NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[a-f0-9]{64}$'),
  message text CHECK (message IS NULL OR char_length(message) <= 280),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tips_to_idx ON tips (to_id, created_at DESC);
CREATE INDEX tips_subject_idx ON tips (subject_kind, subject_id);

-- Worker payout preference. USDG is the default; a stock-token share needs a configured route.
CREATE TABLE payout_elections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stock_symbol text,
  stock_bps integer NOT NULL DEFAULT 0 CHECK (stock_bps BETWEEN 0 AND 5000),
  country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  risk_acknowledged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stock_bps = 0) = (stock_symbol IS NULL))
);

-- Selected work-history entries shared on a public page.
CREATE TABLE history_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]{12}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX history_shares_user_idx ON history_shares (user_id, created_at DESC);

-- Referral bonuses paid by pull claim from the bonus vault.
CREATE TABLE referral_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('referrer','referee')),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  status text NOT NULL DEFAULT 'claimable' CHECK (status IN ('claimable','claimed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  UNIQUE (referee_id, role)
);
CREATE INDEX referral_bonuses_recipient_idx ON referral_bonuses (recipient_id);
