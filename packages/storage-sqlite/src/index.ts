import {
  parseAssessmentWithEvidence,
  parseV1,
  type Assessment,
  type Coverage,
  type Evidence,
  type StoreIdentity,
} from "../../contracts/src/index.ts";

export type Param = string | number | null;
export interface Statement {
  readonly sql: string;
  readonly params: readonly Param[];
}
export interface SqlPort {
  query(
    sql: string,
    params?: readonly Param[],
  ): Promise<readonly Record<string, unknown>[]>;
  /** Must commit all statements or none; D1 batch or native SQLite transaction. */
  batch(statements: readonly Statement[]): Promise<void>;
}
export interface InvestigationJob {
  id: string;
  storeId: string;
  state: "checking" | "complete" | "failed";
  createdAt: string;
}
export interface Correction {
  id: string;
  storeId: string;
  summary: string;
  createdAt: string;
}
const statement = (sql: string, ...params: Param[]): Statement => ({
  sql,
  params,
});
// SQLite TEXT order is wrong when seconds and fractional seconds are mixed:
// `...00.500Z` sorts before `...00Z`. Persist one UTC precision for expiry.
const expiry = (value: string): string => new Date(utc(value)).toISOString();
// Wire /v1 readers tolerate additive fields; persisted records deliberately allowlist
// fields so provider review bodies, credentials and arbitrary shopper data cannot sneak in.
const identityJson = (v: StoreIdentity) =>
  JSON.stringify({
    schemaVersion: 1,
    storeId: v.storeId,
    origin: v.origin,
    registrableDomain: v.registrableDomain,
    ...(v.tenantKey ? { tenantKey: v.tenantKey } : {}),
    matchExplanation: v.matchExplanation,
  });
const evidenceJson = (v: Evidence) =>
  JSON.stringify({
    schemaVersion: 1,
    id: v.id,
    storeId: v.storeId,
    kind: v.kind,
    sourceUrl: v.sourceUrl,
    provider: v.provider,
    retrievedAt: v.retrievedAt,
    ...(v.observedAt ? { observedAt: v.observedAt } : {}),
    subjectMatch: {
      status: v.subjectMatch.status,
      rationale: v.subjectMatch.rationale,
    },
    claim: v.claim,
    ...(v.excerpt
      ? { excerpt: v.excerpt, excerptRights: v.excerptRights }
      : {}),
    limitations: v.limitations,
    lineage: v.lineage,
  });
const coverageRecord = (v: Coverage) => ({
  schemaVersion: 1,
  connector: v.connector,
  status: v.status,
  checkedAt: v.checkedAt,
  ...(v.limitation ? { limitation: v.limitation } : {}),
  ...(v.errorCode ? { errorCode: v.errorCode } : {}),
});
const assessmentJson = (v: Assessment) =>
  JSON.stringify({
    schemaVersion: 1,
    id: v.id,
    storeId: v.storeId,
    status: v.status,
    concern: v.concern,
    reasonCodes: v.reasonCodes,
    confidence: v.confidence,
    evidenceIds: v.evidenceIds,
    coverage: v.coverage.map(coverageRecord),
    limitations: v.limitations,
    checkedAt: v.checkedAt,
    expiresAt: v.expiresAt,
    aiMode: v.aiMode,
    publicationStatus: v.publicationStatus,
  });
function text(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(`Invalid ${label}`);
  return value;
}
function utc(value: unknown): string {
  const timestamp = text(value, "date");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !==
      (timestamp.includes(".")
        ? timestamp.replace(
            /\.(\d{1,3})Z$/,
            (_, digits: string) => `.${digits.padEnd(3, "0")}Z`,
          )
        : timestamp.replace("Z", ".000Z"))
  )
    throw new Error("Invalid UTC date");
  return timestamp;
}
function parseJob(value: unknown): InvestigationJob {
  if (!value || typeof value !== "object") throw new Error("Invalid job");
  const job = value as Record<string, unknown>;
  text(job.id, "job id");
  text(job.storeId, "store id");
  utc(job.createdAt);
  if (!["checking", "complete", "failed"].includes(String(job.state)))
    throw new Error("Invalid job state");
  return {
    id: job.id as string,
    storeId: job.storeId as string,
    state: job.state as InvestigationJob["state"],
    createdAt: job.createdAt as string,
  };
}
function decode<T>(
  row: Record<string, unknown>,
  kind: "identity" | "evidence" | "assessment",
): T {
  if (typeof row.payload !== "string")
    throw new Error("Invalid stored payload");
  return parseV1(kind, JSON.parse(row.payload) as unknown) as T;
}
/** Storage only: authorization of the caller/account is an API concern, never inferred from a shopper-supplied ID. */
export function createStorage(port: SqlPort) {
  return {
    async saveInvestigation(
      inputIdentity: unknown,
      inputJob: unknown,
      inputEvidence: readonly unknown[],
      inputAssessment?: unknown,
    ): Promise<void> {
      const identity = parseV1("identity", inputIdentity);
      const job = parseJob(inputJob);
      const evidence = inputEvidence.map((record) =>
        parseV1("evidence", record),
      );
      if (
        job.storeId !== identity.storeId ||
        evidence.some((record) => record.storeId !== identity.storeId)
      )
        throw new Error("foreign evidence/store");
      const assessment =
        inputAssessment === undefined
          ? undefined
          : parseAssessmentWithEvidence(inputAssessment, evidence);
      if (assessment?.aiMode === "byok")
        throw new Error("private BYOK cannot enter shared assessments");
      if (
        assessment &&
        (assessment.storeId !== identity.storeId || job.state === "checking")
      )
        throw new Error("foreign assessment/store or checking job result");
      const writes: Statement[] = [
        statement(
          "INSERT INTO store_identities(store_id,payload) VALUES (?,?) ON CONFLICT(store_id) DO UPDATE SET payload=excluded.payload",
          identity.storeId,
          identityJson(identity),
        ),
        statement(
          "INSERT INTO investigation_jobs(id,store_id,state,created_at,payload) VALUES (?,?,?,?,?)",
          job.id,
          job.storeId,
          job.state,
          job.createdAt,
          JSON.stringify(job),
        ),
        ...evidence.map((record) =>
          statement(
            "INSERT INTO evidence_refs(job_id,id,store_id,retrieved_at,payload) VALUES (?,?,?,?,?)",
            job.id,
            record.id,
            record.storeId,
            record.retrievedAt,
            evidenceJson(record),
          ),
        ),
      ];
      if (assessment) {
        writes.push(
          statement(
            "INSERT INTO assessments(job_id,id,store_id,expires_at,payload) VALUES (?,?,?,?,?)",
            job.id,
            assessment.id,
            assessment.storeId,
            expiry(assessment.expiresAt),
            assessmentJson(assessment),
          ),
        );
        for (const id of assessment.evidenceIds)
          writes.push(
            statement(
              "INSERT INTO assessment_evidence(job_id,evidence_id,store_id) VALUES (?,?,?)",
              job.id,
              id,
              assessment.storeId,
            ),
          );
      }
      await port.batch(writes);
    },
    async getInvestigation(id: string): Promise<{
      identity: StoreIdentity;
      job: InvestigationJob;
      evidence: Evidence[];
      assessment: Assessment | null;
    } | null> {
      text(id, "job id");
      const [job] = await port.query(
        "SELECT payload,store_id FROM investigation_jobs WHERE id=?",
        [id],
      );
      if (
        !job ||
        typeof job.payload !== "string" ||
        typeof job.store_id !== "string"
      )
        return null;
      const [store] = await port.query(
        "SELECT payload FROM store_identities WHERE store_id=?",
        [job.store_id],
      );
      if (!store) throw new Error("Orphaned store identity");
      const evidence = (
        await port.query(
          "SELECT payload FROM evidence_refs WHERE job_id=? ORDER BY id",
          [id],
        )
      ).map((row) => decode<Evidence>(row, "evidence"));
      const [result] = await port.query(
        "SELECT payload FROM assessments WHERE job_id=?",
        [id],
      );
      const assessment = result
        ? parseAssessmentWithEvidence(
            JSON.parse(String(result.payload)) as unknown,
            evidence,
          )
        : null;
      return {
        identity: decode<StoreIdentity>(store, "identity"),
        job: parseJob(JSON.parse(job.payload) as unknown),
        evidence,
        assessment,
      };
    },
    async saveCorrection(input: Correction): Promise<void> {
      const correction = {
        id: text(input.id, "correction id"),
        storeId: text(input.storeId, "store id"),
        summary: text(input.summary, "summary"),
        createdAt: utc(input.createdAt),
      };
      await port.batch([
        statement(
          "INSERT INTO corrections(id,store_id,summary,created_at) VALUES (?,?,?,?)",
          correction.id,
          correction.storeId,
          correction.summary,
          correction.createdAt,
        ),
      ]);
    },
    async getCorrections(storeId: string): Promise<Correction[]> {
      return (
        await port.query(
          "SELECT id,store_id,summary,created_at FROM corrections WHERE store_id=? ORDER BY created_at,id",
          [text(storeId, "store id")],
        )
      ).map((row) => ({
        id: String(row.id),
        storeId: String(row.store_id),
        summary: String(row.summary),
        createdAt: String(row.created_at),
      }));
    },
    async savePrivateAnalysis(
      accountId: string,
      input: unknown,
    ): Promise<void> {
      text(accountId, "account id");
      const analysis = parseV1("assessment", input);
      if (analysis.aiMode !== "byok" || analysis.publicationStatus !== "draft")
        throw new Error("Private BYOK analysis must remain draft");
      const [store] = await port.query(
        "SELECT store_id FROM store_identities WHERE store_id=?",
        [analysis.storeId],
      );
      if (!store) throw new Error("Unknown store identity");
      for (const evidenceId of analysis.evidenceIds) {
        const [known] = await port.query(
          "SELECT id FROM evidence_refs WHERE id=? AND store_id=? LIMIT 1",
          [evidenceId, analysis.storeId],
        );
        if (!known) throw new Error("foreign evidence in private analysis");
      }
      await port.batch([
        statement(
          "INSERT INTO private_analyses(account_id,id,store_id,expires_at,payload) VALUES (?,?,?,?,?)",
          accountId,
          analysis.id,
          analysis.storeId,
          expiry(analysis.expiresAt),
          assessmentJson(analysis),
        ),
        ...analysis.evidenceIds.map((evidenceId) =>
          statement(
            "INSERT INTO private_analysis_evidence(account_id,analysis_id,job_id,evidence_id,store_id) VALUES (?,?,(SELECT job_id FROM evidence_refs WHERE id=? AND store_id=? ORDER BY job_id LIMIT 1),?,?)",
            accountId,
            analysis.id,
            evidenceId,
            analysis.storeId,
            evidenceId,
            analysis.storeId,
          ),
        ),
      ]);
    },
    async getPrivateAnalysis(
      accountId: string,
      id: string,
    ): Promise<Assessment | null> {
      const [row] = await port.query(
        "SELECT payload FROM private_analyses WHERE account_id=? AND id=?",
        [text(accountId, "account id"), text(id, "analysis id")],
      );
      return row ? decode<Assessment>(row, "assessment") : null;
    },
    async deletePrivateAnalysis(
      accountId: string,
      id: string,
    ): Promise<boolean> {
      const key = [text(accountId, "account id"), text(id, "analysis id")];
      const [row] = await port.query(
        "SELECT id FROM private_analyses WHERE account_id=? AND id=?",
        key,
      );
      if (!row) return false;
      await port.batch([
        statement(
          "DELETE FROM private_analyses WHERE account_id=? AND id=?",
          ...key,
        ),
      ]);
      return true;
    },
    /** Explicit purge: caller supplies controlled clock; corrections retained for human policy. */
    async prune(now: string): Promise<void> {
      const at = expiry(now);
      await port.batch([
        statement(
          `DELETE FROM private_analyses WHERE expires_at <= ? OR EXISTS (
          SELECT 1 FROM private_analysis_evidence AS link JOIN assessments AS result ON result.job_id=link.job_id
          WHERE link.account_id=private_analyses.account_id AND link.analysis_id=private_analyses.id AND result.expires_at <= ?
        )`,
          at,
          at,
        ),
        statement(
          "DELETE FROM investigation_jobs WHERE id IN (SELECT job_id FROM assessments WHERE expires_at <= ?)",
          at,
        ),
      ]);
    },
  };
}
