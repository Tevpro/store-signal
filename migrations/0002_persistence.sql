-- F03 v2: only source references/short claims; no third-party review corpora or keys.
-- Forward-only from 0001; Wrangler records applied migrations, Node migrator must likewise
-- track application. No destructive DOWN because losing correction history is unsafe.
CREATE TABLE IF NOT EXISTS store_identities (
  store_id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TABLE IF NOT EXISTS investigation_jobs (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_identities(store_id),
  state TEXT NOT NULL CHECK (state IN ('checking','complete','failed')),
  created_at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TABLE IF NOT EXISTS evidence_refs (
  job_id TEXT NOT NULL REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  id TEXT NOT NULL, store_id TEXT NOT NULL REFERENCES store_identities(store_id),
  retrieved_at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (job_id, id), UNIQUE (job_id, id, store_id)
);
CREATE TABLE IF NOT EXISTS assessments (
  job_id TEXT PRIMARY KEY REFERENCES investigation_jobs(id) ON DELETE CASCADE,
  id TEXT NOT NULL, store_id TEXT NOT NULL REFERENCES store_identities(store_id),
  expires_at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TABLE IF NOT EXISTS assessment_evidence (
  job_id TEXT NOT NULL REFERENCES assessments(job_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL, store_id TEXT NOT NULL,
  PRIMARY KEY (job_id, evidence_id),
  FOREIGN KEY (job_id, evidence_id, store_id) REFERENCES evidence_refs(job_id, id, store_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_identities(store_id),
  summary TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS private_analyses (
  account_id TEXT NOT NULL, id TEXT NOT NULL, store_id TEXT NOT NULL REFERENCES store_identities(store_id),
  expires_at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (account_id, id)
);
-- A live private analysis must never outlive the evidence it cites. These
-- references make a save racing with retention fail atomically, not orphan it.
CREATE TABLE IF NOT EXISTS private_analysis_evidence (
  account_id TEXT NOT NULL, analysis_id TEXT NOT NULL,
  job_id TEXT NOT NULL, evidence_id TEXT NOT NULL, store_id TEXT NOT NULL,
  PRIMARY KEY (account_id, analysis_id, evidence_id),
  FOREIGN KEY (account_id, analysis_id) REFERENCES private_analyses(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (job_id, evidence_id, store_id) REFERENCES evidence_refs(job_id, id, store_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_assessments_expiry ON assessments(expires_at);
CREATE INDEX IF NOT EXISTS idx_private_expiry ON private_analyses(expires_at);
