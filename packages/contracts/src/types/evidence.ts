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
