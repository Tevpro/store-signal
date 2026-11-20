import type { Coverage } from "./coverage.ts";

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
