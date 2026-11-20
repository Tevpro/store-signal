export interface Coverage {
  readonly schemaVersion: 1;
  readonly connector: string;
  readonly status: "checked" | "no_match" | "unavailable" | "failed";
  readonly checkedAt: string;
  readonly limitation?: string;
  readonly errorCode?: string;
}
