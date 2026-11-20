export type QuotaBucket = "new" | "cached" | "status" | "ai";
/** Trusted server-only context. Never populate from request storeId, tenantKey,
 * install claim alone, X-Forwarded-For, or shopper-provided quota key. Account IDs
 * must come from validated authentication; anonymous edge keys from trusted ingress.
 */
export interface QuotaScope {
  readonly principal: string;
  readonly edge?: string;
}
export type QuotaResult =
  { allowed: true; ticket: string } | { allowed: false; retryAfterMs: number };
