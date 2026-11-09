-- A settled job's wallet can be registered as an escrow account, so USDG sent to it beyond the listed amount
-- (a double send, say) is returned to the client through the same surplus recovery as other escrows.
ALTER TABLE escrow_accounts DROP CONSTRAINT escrow_accounts_kind_check;
ALTER TABLE escrow_accounts ADD CONSTRAINT escrow_accounts_kind_check
  CHECK (kind IN ('batch','gig','contract','bonus_vault','job'));
ALTER TABLE escrow_accounts ADD COLUMN job_id uuid UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT;
ALTER TABLE escrow_accounts ADD CONSTRAINT escrow_accounts_job_link CHECK ((kind = 'job') = (job_id IS NOT NULL));
