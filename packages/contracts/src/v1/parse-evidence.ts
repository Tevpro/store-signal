import type { Evidence } from '../types/evidence.ts';
import { date, enumValue, list, object, optionalText, storeId, text, version, invalid } from './contract-validation.ts';
import { normalizeStoreIdentity } from './normalize-store-identity.ts';

export function parseEvidence(input: unknown): Evidence {
  const v = object(input); version(v);
  text(v.id, 'id'); storeId(v.storeId); text(v.kind, 'kind'); text(v.provider, 'provider');
  const url = text(v.sourceUrl, 'sourceUrl', 2048);
  normalizeStoreIdentity(url);
  date(v.retrievedAt, 'retrievedAt'); if (v.observedAt !== undefined) date(v.observedAt, 'observedAt');
  const match = object(v.subjectMatch);
  enumValue(match.status, ['exact', 'corroborated', 'ambiguous', 'unmatched'], 'subjectMatch.status');
  text(match.rationale, 'subjectMatch.rationale', 512);
  text(v.claim, 'claim', 512);
  optionalText(v.excerpt, 'excerpt', 500);
  if (v.excerpt !== undefined && v.excerptRights !== 'permitted') invalid('excerpt rights');
  if (v.excerptRights !== undefined) enumValue(v.excerptRights, ['permitted'], 'excerptRights');
  list(v.limitations, 'limitations'); list(v.lineage, 'lineage');
  return v as unknown as Evidence;
}
