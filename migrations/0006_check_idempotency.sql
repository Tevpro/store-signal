-- Short-lived per-principal request replay. Digests are keyed with the server-only
-- status secret. No raw account ID, shopper key, URL path, or status token is stored.
-- Explicit deletion of expired entries is performed on keyed POST; job pruning
-- cascades entries for removed jobs. Retention/privacy policy still requires review.
CREATE TABLE check_idempotency (
  scope_mac TEXT NOT NULL,
  key_mac TEXT NOT NULL,
  request_mac TEXT NOT NULL,
  owner TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  job_id TEXT REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  reply_kind TEXT CHECK (reply_kind IN ('checking','cached')),
  PRIMARY KEY (scope_mac,key_mac),
  CHECK ((job_id IS NULL AND reply_kind IS NULL) OR (job_id IS NOT NULL AND reply_kind IS NOT NULL))
);
CREATE INDEX check_idempotency_expiry ON check_idempotency(expires_at_ms);
