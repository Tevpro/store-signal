import { parseV1, type Assessment } from "../../contracts/src/index.ts";
import type { SqlPort } from "./index.ts";
import { createQuotas } from "./quota.ts";
import type { QuotaScope } from "./types/quota-scope.ts";
import type { Admission } from "./types/admission-result.ts";
export type { Admission } from "./types/admission-result.ts";
const LEASE_MS = 60_000;
const WEEK_MS = 7 * 86_400_000;
const MAX_ATTEMPTS = 3;
const iso = (ms: number): string => {
  if (!Number.isSafeInteger(ms)) throw new Error("Invalid clock");
  return new Date(ms).toISOString();
};
const jobId = (id: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid job id");
  return id;
};
const number = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new Error("Invalid DB counter");
  return value;
};
const id = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid DB id");
  return value;
};

/** One conditional INSERT/UPDATE is one serialized SQLite write, including in D1.
 * Caller must authenticate the refresh permission before passing `earlyRefresh=true`;
 * this library never treats an install token or request-body flag as authorization.
 * No external provider dispatch is performed here. Workers must use the returned generation.
 */
export function createAdmission(port: SqlPort) {
  const quotas = createQuotas(port);
  return {
    /** Current attempt may extend an unexpired lease; generation fences old workers. */
    async renew(
      rawId: string,
      generation: number,
      now: number,
    ): Promise<boolean> {
      const key = jobId(rawId);
      iso(now + LEASE_MS);
      if (!Number.isSafeInteger(generation) || generation < 1)
        throw new Error("Invalid generation");
      const rows = await port.query(
        "UPDATE investigation_jobs SET lease_until_ms=? WHERE id=? AND state='checking' AND generation=? AND lease_until_ms>? RETURNING id",
        [now + LEASE_MS, key, generation, now],
      );
      return rows.length === 1;
    },
    async check(
      rawIdentity: unknown,
      rawId: string,
      now: number,
      earlyRefresh = false,
      scope?: QuotaScope,
    ): Promise<Admission> {
      const identity = parseV1("identity", rawIdentity);
      const nextId = jobId(rawId);
      const time = iso(now);
      const lease = now + LEASE_MS;
      iso(lease);
      const payload = JSON.stringify({
        id: nextId,
        storeId: identity.storeId,
        state: "checking",
        createdAt: time,
      });
      const stored = JSON.stringify({
        schemaVersion: 1,
        storeId: identity.storeId,
        origin: identity.origin,
        registrableDomain: identity.registrableDomain,
        ...(identity.tenantKey ? { tenantKey: identity.tenantKey } : {}),
        matchExplanation: identity.matchExplanation,
      });
      // Store identity upsert is independently idempotent; neither it nor the read below grants admission.
      await port.batch([
        {
          sql: "INSERT INTO store_identities(store_id,payload) VALUES (?,?) ON CONFLICT(store_id) DO NOTHING",
          params: [identity.storeId, stored],
        },
      ]);
      const active = async () =>
        (
          await port.query(
            "SELECT id,generation,lease_until_ms FROM investigation_jobs WHERE store_id=? AND state='checking' ORDER BY created_at DESC,id DESC LIMIT 1",
            [identity.storeId],
          )
        )[0];
      const cached = async () =>
        (
          await port.query(
            "SELECT job_id FROM assessments WHERE store_id=? AND julianday(expires_at)>julianday(?) ORDER BY expires_at DESC,job_id DESC LIMIT 1",
            [identity.storeId, time],
          )
        )[0];
      const cacheResult = async (
        hit: Record<string, unknown>,
      ): Promise<Admission> => {
        if (scope) {
          const taken = await quotas.take("cached", scope, now);
          if ("retryAfterMs" in taken)
            return {
              kind: "rate_limited",
              bucket: "cached",
              retryAfterMs: taken.retryAfterMs,
            };
        }
        return { kind: "cached", jobId: id(hit.job_id) };
      };
      // Fast paths are advisory only: the conditional INSERT rechecks both in its own serialized write.
      if (!earlyRefresh) {
        const hit = await cached();
        if (hit) return cacheResult(hit);
      }
      const current = await active();
      if (current) {
        if (number(current.lease_until_ms) <= now) {
          const recovered = await port.query(
            "UPDATE investigation_jobs SET generation=generation+1,lease_until_ms=?,state=CASE WHEN generation>=? THEN 'failed' ELSE 'checking' END,payload=json_set(payload,'$.state',CASE WHEN generation>=? THEN 'failed' ELSE 'checking' END) WHERE id=? AND state='checking' AND lease_until_ms<=? RETURNING id,generation,state",
            [lease, MAX_ATTEMPTS, MAX_ATTEMPTS, id(current.id), now],
          );
          if (recovered[0])
            return recovered[0].state === "failed"
              ? { kind: "failed", jobId: id(recovered[0].id) }
              : {
                  kind: "recovered",
                  jobId: id(recovered[0].id),
                  generation: number(recovered[0].generation),
                };
        } else
          return {
            kind: "joined",
            jobId: id(current.id),
            generation: number(current.generation),
          };
      }
      if (!earlyRefresh) {
        const hit = await cached();
        if (hit) return cacheResult(hit);
      }
      // Reserve before admission. A failed race releases the reservation; a crash
      // between reserve and release fails closed rather than exceeding the budget.
      const reservation = scope
        ? await quotas.take("new", scope, now)
        : undefined;
      if (reservation && "retryAfterMs" in reservation) {
        const joined = await active();
        if (joined)
          return {
            kind: "joined",
            jobId: id(joined.id),
            generation: number(joined.generation),
          };
        if (!earlyRefresh) {
          const hit = await cached();
          if (hit) return cacheResult(hit);
        }
        return {
          kind: "rate_limited",
          bucket: "new",
          retryAfterMs: reservation.retryAfterMs,
        };
      }
      const admitted = await port.query(
        `INSERT INTO investigation_jobs(id,store_id,state,created_at,payload,lease_until_ms,generation)
        SELECT ?,?,'checking',?,?,?,1
        WHERE NOT EXISTS (SELECT 1 FROM investigation_jobs WHERE store_id=? AND state='checking')
          AND NOT EXISTS (SELECT 1 FROM investigation_jobs WHERE store_id=? AND julianday(created_at)>julianday(?))
          AND (?=1 OR NOT EXISTS (SELECT 1 FROM assessments WHERE store_id=? AND julianday(expires_at)>julianday(?)))
        RETURNING id,generation`,
        [
          nextId,
          identity.storeId,
          time,
          payload,
          lease,
          identity.storeId,
          identity.storeId,
          iso(now - LEASE_MS),
          earlyRefresh ? 1 : 0,
          identity.storeId,
          time,
        ],
      );
      if (admitted[0])
        return {
          kind: "admitted",
          jobId: id(admitted[0].id),
          generation: number(admitted[0].generation),
        };
      if (reservation && "ticket" in reservation)
        await quotas.release(reservation.ticket);
      const joined = await active();
      if (joined)
        return {
          kind: "joined",
          jobId: id(joined.id),
          generation: number(joined.generation),
        };
      if (!earlyRefresh) {
        const hit = await cached();
        if (hit) return cacheResult(hit);
      }
      const [last] = await port.query(
        "SELECT created_at FROM investigation_jobs WHERE store_id=? ORDER BY created_at DESC LIMIT 1",
        [identity.storeId],
      );
      const remaining = last
        ? Date.parse(id(last.created_at)) + LEASE_MS - now
        : 0;
      return { kind: "cooldown", retryAfterMs: Math.max(1, remaining) };
    },
    /** Completion and assessment insert commit together, guarded by generation and unexpired lease.
     * A stale worker has no authority to write a result, even after a replacement finishes.
     */
    async complete(
      rawId: string,
      generation: number,
      now: number,
      rawAssessment: unknown,
    ): Promise<boolean> {
      const key = jobId(rawId);
      if (!Number.isSafeInteger(generation) || generation < 1)
        throw new Error("Invalid generation");
      const result: Assessment = parseV1("assessment", rawAssessment);
      if (result.aiMode === "byok" || result.evidenceIds.length)
        throw new Error(
          "Private or referenced evidence requires atomic evidence-writing path",
        );
      if (
        Date.parse(result.expiresAt) - Date.parse(result.checkedAt) !==
          WEEK_MS ||
        Date.parse(result.checkedAt) > now
      )
        throw new Error(
          "Assessment must carry seven-day freshness from its checked date",
        );
      const sanitized = {
        schemaVersion: 1,
        id: result.id,
        storeId: result.storeId,
        status: result.status,
        concern: result.concern,
        reasonCodes: result.reasonCodes,
        confidence: result.confidence,
        evidenceIds: [],
        coverage: result.coverage.map((c) => ({
          schemaVersion: 1,
          connector: c.connector,
          status: c.status,
          checkedAt: c.checkedAt,
          ...(c.limitation ? { limitation: c.limitation } : {}),
          ...(c.errorCode ? { errorCode: c.errorCode } : {}),
        })),
        limitations: result.limitations,
        checkedAt: result.checkedAt,
        expiresAt: result.expiresAt,
        aiMode: result.aiMode,
        publicationStatus: result.publicationStatus,
      };
      const ready = await port.query(
        "SELECT store_id FROM investigation_jobs WHERE id=? AND state='checking' AND generation=? AND lease_until_ms>?",
        [key, generation, now],
      );
      if (!ready.length || ready[0]!.store_id !== result.storeId) return false;
      await port.batch([
        {
          sql: "UPDATE investigation_jobs SET state='complete',payload=json_set(payload,'$.state','complete') WHERE id=? AND state='checking' AND generation=? AND lease_until_ms>? AND store_id=?",
          params: [key, generation, now, result.storeId],
        },
        {
          sql: `INSERT INTO assessments(job_id,id,store_id,expires_at,payload)
          SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM investigation_jobs WHERE id=? AND state='complete' AND generation=? AND lease_until_ms>? AND store_id=?)
          AND NOT EXISTS (SELECT 1 FROM assessments WHERE job_id=?)`,
          params: [
            key,
            result.id,
            result.storeId,
            new Date(result.expiresAt).toISOString(),
            JSON.stringify(sanitized),
            key,
            generation,
            now,
            result.storeId,
            key,
          ],
        },
      ]);
      const [written] = await port.query(
        "SELECT a.id FROM assessments a JOIN investigation_jobs j ON j.id=a.job_id WHERE a.job_id=? AND a.id=? AND j.generation=? AND j.state='complete'",
        [key, result.id, generation],
      );
      return !!written;
    },
  };
}
