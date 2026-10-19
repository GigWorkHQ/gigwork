DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jobs WHERE asset <> 'usdg') THEN
    RAISE EXCEPTION 'Cannot enable USDG-only jobs while non-USDG jobs exist.';
  END IF;
END $$;

ALTER TABLE jobs DROP CONSTRAINT jobs_asset_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_asset_usdg_check CHECK (asset = 'usdg');
ALTER TABLE jobs DROP CONSTRAINT jobs_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_usdg_token_check
  CHECK (asset = 'usdg' AND token_address IS NOT NULL);
