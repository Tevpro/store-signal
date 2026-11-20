import type { V1Records } from "../types/records.ts";
import type { HostedTenantRule } from "../types/hosted-tenant-rule.ts";
import type { Evidence } from "../types/evidence.ts";
import type { Assessment } from "../types/assessment.ts";
import { invalid } from "./contract-validation.ts";
import { parseIdentity } from "./parse-identity.ts";
import { parseEvidence } from "./parse-evidence.ts";
import { parseCoverage } from "./parse-coverage.ts";
import { parseAssessment } from "./parse-assessment.ts";

export function parseV1<K extends keyof V1Records>(
  kind: K,
  input: unknown,
  trustedRules: readonly HostedTenantRule[] = [],
): V1Records[K] {
  if (kind === "identity")
    return parseIdentity(input, trustedRules) as V1Records[K];
  const parser = {
    evidence: parseEvidence,
    coverage: parseCoverage,
    assessment: parseAssessment,
  }[kind as "evidence" | "coverage" | "assessment"];
  return parser(input) as V1Records[K];
}
export function serializeV1<K extends keyof V1Records>(
  kind: K,
  input: unknown,
  trustedRules: readonly HostedTenantRule[] = [],
): string {
  return JSON.stringify(parseV1(kind, input, trustedRules));
}

/** Cross-record check when an assessment and its evidence set are available together. */
export function parseAssessmentWithEvidence(
  input: unknown,
  evidence: readonly unknown[],
): Assessment {
  const assessment = parseV1("assessment", input);
  const ids = new Map<string, Evidence>();
  for (const value of evidence) {
    const record = parseV1("evidence", value);
    if (ids.has(record.id)) invalid("duplicate evidence id");
    ids.set(record.id, record);
  }
  for (const id of assessment.evidenceIds) {
    const record = ids.get(id);
    if (!record || record.storeId !== assessment.storeId)
      invalid("foreign evidence id");
  }
  return assessment;
}
