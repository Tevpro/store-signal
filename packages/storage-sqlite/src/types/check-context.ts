import type { QuotaScope } from './quota-scope.ts';

/** Trusted ingress context only; never populate from shopper-controlled headers. */
export interface CheckContext {
  readonly scope: QuotaScope;
  readonly enabled: boolean; // requires authenticated ingress, real dispatcher and licensed connectors
  readonly statusTokenKey?: string; // stable, high-entropy server secret
  readonly now: () => number;
}
