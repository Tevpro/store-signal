import type { StoreIdentity } from '../types/store-identity.ts';
import type { HostedTenantRule } from '../types/hosted-tenant-rule.ts';
import { invalid, object, storeId, text, version } from './contract-validation.ts';
import { normalizeStoreIdentity } from './normalize-store-identity.ts';

export function parseIdentity(input: unknown, trustedRules: readonly HostedTenantRule[] = []): StoreIdentity {
  const v = object(input); version(v);
  const id = storeId(v.storeId);
  const origin = text(v.origin, 'origin', 2048);
  const normalized = normalizeStoreIdentity(origin, trustedRules);
  if (normalized.origin !== origin || normalized.storeId !== id || normalized.registrableDomain !== v.registrableDomain || normalized.tenantKey !== v.tenantKey) invalid('identity mismatch');
  text(v.matchExplanation, 'matchExplanation', 512);
  return v as unknown as StoreIdentity;
}
