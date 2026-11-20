export interface StoreIdentity {
  readonly schemaVersion: 1;
  readonly storeId: string;
  readonly origin: string;
  readonly registrableDomain: string;
  readonly tenantKey?: string;
  readonly matchExplanation: string;
}
