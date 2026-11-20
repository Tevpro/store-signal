-- Rolling 60-second per-principal counters: no user/store or user/job relationship persisted.
-- Entries are opaque reservations; prune older than the retention window operationally.
CREATE TABLE quota_events (
  id TEXT NOT NULL,
  scope TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('new','cached','status','ai')),
  at_ms INTEGER NOT NULL,
  PRIMARY KEY(id, scope, bucket)
);
CREATE INDEX idx_quota_scope_bucket_time ON quota_events(scope,bucket,at_ms);
