export { HOSTED_TENANT_RULES } from "./v1/hosted-tenant-rules.ts";
export { normalizeStoreIdentity } from "./v1/normalize-store-identity.ts";
export {
  parseV1,
  serializeV1,
  parseAssessmentWithEvidence,
} from "./v1/parse-records.ts";
export type { StoreIdentity } from "./types/store-identity.ts";
export type { Evidence } from "./types/evidence.ts";
export type { Coverage } from "./types/coverage.ts";
export type { Assessment } from "./types/assessment.ts";
export type { HostedTenantRule } from "./types/hosted-tenant-rule.ts";
export type { V1Records } from "./types/records.ts";
export interface StoreFixture {
  readonly id: string;
  readonly origin: string;
}

export function parseFixtures(input: unknown): readonly StoreFixture[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new Error("Expected nonempty fixture array");
  const seen = new Set<string>();
  return input.map((value: unknown): StoreFixture => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      !("origin" in value) ||
      typeof value.id !== "string" ||
      !/^[a-z0-9-]+$/.test(value.id) ||
      typeof value.origin !== "string"
    )
      throw new Error("Invalid fixture");
    const url = new URL(value.origin);
    if (
      url.protocol !== "https:" ||
      url.origin !== value.origin ||
      url.username ||
      url.password
    )
      throw new Error("Invalid fixture origin");
    if (seen.has(value.id)) throw new Error("Duplicate fixture id");
    seen.add(value.id);
    return { id: value.id, origin: value.origin };
  });
}
