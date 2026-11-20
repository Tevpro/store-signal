-- A scoped status capability is recorded only after server-derived admission.
-- Store the HMAC digest, never the raw principal or shopper-supplied identifier.
-- Cascade deletes keep the grant lifetime bounded by the investigation job.
CREATE TABLE check_access_grants (
  job_id TEXT NOT NULL REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  token_mac TEXT NOT NULL CHECK(length(token_mac) = 64),
  PRIMARY KEY (job_id, token_mac)
);
