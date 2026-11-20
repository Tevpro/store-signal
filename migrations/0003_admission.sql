-- F04 checkpoint: database-serialized conditional admission and fenced lease recovery.
-- Nullable lease on F03 historical jobs; non-null only for admitted F04 jobs.
ALTER TABLE investigation_jobs ADD COLUMN lease_until_ms INTEGER;
ALTER TABLE investigation_jobs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
-- F03 had no lease or fencing; old checking records cannot safely be resumed.
UPDATE investigation_jobs SET state='failed',payload=json_set(payload,'$.state','failed') WHERE state='checking' AND lease_until_ms IS NULL;
CREATE INDEX idx_jobs_store_time ON investigation_jobs(store_id,created_at);
CREATE INDEX idx_jobs_store_state ON investigation_jobs(store_id,state,lease_until_ms);
CREATE INDEX idx_assessments_store_expiry ON assessments(store_id,expires_at);
