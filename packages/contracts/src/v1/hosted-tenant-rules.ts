import type { HostedTenantRule } from '../types/hosted-tenant-rule.ts';

/** Small reviewed registry; add platforms only with their tenant-host semantics tested. */
export const HOSTED_TENANT_RULES: readonly HostedTenantRule[] = [
  { platformDomain: 'myshopify.com', tenantLabels: 1 },
  { platformDomain: 'platform.example', tenantLabels: 1 }, // synthetic fixture only
];
