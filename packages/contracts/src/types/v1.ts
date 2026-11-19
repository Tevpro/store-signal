/** Portable /v1 wire records. Validators preserve unknown additive fields on roundtrips. */
export interface StoreIdentity {
  readonly schemaVersion: 1;
  readonly storeId: string;
  readonly origin: string;
  readonly registrableDomain: string;
  readonly tenantKey?: string;
  readonly matchExplanation: string;
}
export interface Evidence {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly storeId: string;
  readonly kind: string;
  readonly sourceUrl: string;
  readonly provider: string;
  readonly retrievedAt: string;
  readonly observedAt?: string;
  readonly subjectMatch: { readonly status: 'exact' | 'corroborated' | 'ambiguous' | 'unmatched'; readonly rationale: string };
  readonly claim: string;
  readonly excerpt?: string;
  readonly excerptRights?: 'permitted';
  readonly limitations: readonly string[];
  readonly lineage: readonly string[];
}
export interface Coverage {
  readonly schemaVersion: 1;
  readonly connector: string;
  readonly status: 'checked' | 'no_match' | 'unavailable' | 'failed';
  readonly checkedAt: string;
  readonly limitation?: string;
  readonly errorCode?: string;
}
export interface Assessment {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly storeId: string;
  readonly status: 'complete' | 'limited' | 'no_match' | 'failed';
  readonly concern: 'low' | 'caution' | 'high' | 'insufficient';
  readonly reasonCodes: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high' | 'insufficient';
  readonly evidenceIds: readonly string[];
  readonly coverage: readonly Coverage[];
  readonly limitations: readonly string[];
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly aiMode: 'none' | 'managed' | 'byok';
  readonly publicationStatus: 'draft' | 'held' | 'published';
}
export interface HostedTenantRule { readonly platformDomain: string; readonly tenantLabels: number }

export interface V1Records { identity: StoreIdentity; evidence: Evidence; coverage: Coverage; assessment: Assessment }
