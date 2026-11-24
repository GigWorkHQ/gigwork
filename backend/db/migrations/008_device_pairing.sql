-- Companion app pairing. A signed-in web session creates a short, single-use code; the Android app redeems it for a
-- device session on the same account. The phone never holds a wallet: anything that needs the wallet stays on the web.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD CONSTRAINT sessions_id_key UNIQUE (id);
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'wallet' CHECK (kind IN ('wallet','device'));
ALTER TABLE sessions ADD COLUMN device_name text CHECK (device_name IS NULL OR char_length(device_name) BETWEEN 1 AND 60);
ALTER TABLE sessions ADD COLUMN last_used_at timestamptz;
ALTER TABLE sessions ADD CONSTRAINT sessions_device_named CHECK ((kind = 'device') = (device_name IS NOT NULL));
CREATE INDEX sessions_devices_idx ON sessions (user_id, created_at DESC) WHERE kind = 'device';

CREATE TABLE pairing_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX pairing_codes_user_idx ON pairing_codes (user_id, created_at DESC);
