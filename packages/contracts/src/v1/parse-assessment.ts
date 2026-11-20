import type { Assessment } from "../types/assessment.ts";
import type { Coverage } from "../types/coverage.ts";
import {
  date,
  enumValue,
  list,
  object,
  storeId,
  text,
  version,
  invalid,
} from "./contract-validation.ts";
import { parseCoverage } from "./parse-coverage.ts";

export function parseAssessment(input: unknown): Assessment {
  const v = object(input);
  version(v);
  text(v.id, "id");
  storeId(v.storeId);
  const status = enumValue(
    v.status,
    ["complete", "limited", "no_match", "failed"],
    "assessment status",
  );
  const concern = enumValue(
    v.concern,
    ["low", "caution", "high", "insufficient"],
    "concern",
  );
  if (list(v.reasonCodes, "reasonCodes").length === 0) invalid("reasonCodes");
  enumValue(
    v.confidence,
    ["low", "medium", "high", "insufficient"],
    "confidence",
  );
  const evidenceIds = list(v.evidenceIds, "evidenceIds");
  const coverageInput = v.coverage;
  if (!Array.isArray(coverageInput) || coverageInput.length === 0)
    invalid("coverage");
  const coverage = (coverageInput as unknown[]).map((entry: unknown) =>
    parseCoverage(entry),
  );
  if (
    new Set(coverage.map((entry: Coverage) => entry.connector)).size !==
    coverage.length
  )
    invalid("duplicate connector");
  list(v.limitations, "limitations");
  const checkedAt = date(v.checkedAt, "checkedAt");
  const expiresAt = date(v.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(checkedAt)) invalid("expiry");
  const ai = enumValue(v.aiMode, ["none", "managed", "byok"], "aiMode");
  const publication = enumValue(
    v.publicationStatus,
    ["draft", "held", "published"],
    "publicationStatus",
  );
  const allNoMatch = coverage.every((c: Coverage) => c.status === "no_match");
  const allFailed = coverage.every((c: Coverage) => c.status === "failed");
  const hasUsableSource =
    evidenceIds.length > 0 ||
    coverage.some((c: Coverage) => c.status === "checked");
  if (
    (allNoMatch && status !== "no_match") ||
    (allFailed && status !== "failed") ||
    (!hasUsableSource && concern !== "insufficient")
  )
    invalid("assessment state");
  if (
    (status === "no_match" &&
      (concern !== "insufficient" ||
        evidenceIds.length ||
        coverage.some((c: Coverage) => c.status !== "no_match"))) ||
    (status === "failed" &&
      (concern !== "insufficient" ||
        evidenceIds.length ||
        !coverage.some((c: Coverage) => c.status === "failed") ||
        coverage.some((c: Coverage) => c.status === "checked"))) ||
    (status === "complete" &&
      (ai === "none" ||
        coverage.some(
          (c: Coverage) => c.status === "failed" || c.status === "unavailable",
        ))) ||
    (status === "limited" && concern === "high") ||
    (ai === "byok" && publication === "published") ||
    ((status === "failed" || status === "no_match") &&
      publication === "published")
  )
    invalid("assessment state");
  return v as unknown as Assessment;
}
