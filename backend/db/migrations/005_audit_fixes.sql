-- Audit fixes (2026-11): referral bonuses need team approval, escrows can return unrecorded deposits,
-- and failed payouts can be retried.

-- H-1: a qualifying referral creates bonuses that wait for team approval before anyone can claim them.
ALTER TABLE referral_bonuses DROP CONSTRAINT referral_bonuses_status_check;
ALTER TABLE referral_bonuses ADD CONSTRAINT referral_bonuses_status_check
  CHECK (status IN ('pending_review','claimable','claimed','rejected'));
ALTER TABLE referral_bonuses ALTER COLUMN status SET DEFAULT 'pending_review';
ALTER TABLE referral_bonuses ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE referral_bonuses ADD COLUMN reviewed_at timestamptz;
-- Bonuses created before this rule existed and not yet claimed go back to review.
UPDATE referral_bonuses SET status='pending_review' WHERE status='claimable';

-- M-2: USDG that reached an escrow without being recorded as a deposit is returned to the client.
CREATE TABLE escrow_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id uuid NOT NULL REFERENCES escrow_accounts(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escrow_recoveries_escrow_idx ON escrow_recoveries (escrow_id);

ALTER TABLE escrow_transfers DROP CONSTRAINT escrow_transfers_kind_check;
ALTER TABLE escrow_transfers ADD CONSTRAINT escrow_transfers_kind_check
  CHECK (kind IN ('assignment_pay','batch_refund','milestone_pay','milestone_refund','pay_period','pay_period_refund','referral_bonus','surplus_refund'));

-- L-5: every retry of a failed payout is logged.
CREATE TABLE escrow_transfer_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES escrow_transfers(id) ON DELETE RESTRICT,
  retried_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Team actions that change who gets paid or who reviews are kept in one audit log.
CREATE TABLE team_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  subject_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_actions_created_idx ON team_actions (created_at DESC);
