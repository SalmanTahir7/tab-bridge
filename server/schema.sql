CREATE TABLE IF NOT EXISTS transfers (
  id text PRIMARY KEY CHECK (length(id) = 22),
  auth_hash text NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL CHECK (octet_length(ciphertext) <= 65560),
  expires_at timestamptz NOT NULL,
  claim_hash text,
  acknowledged boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS transfers_expiry ON transfers(expires_at);
CREATE TABLE IF NOT EXISTS quotas (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS quotas_expiry ON quotas(expires_at);
