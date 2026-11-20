export type Admission =
  | {
      kind: "admitted" | "recovered" | "joined";
      jobId: string;
      generation: number;
    }
  | { kind: "cached"; jobId: string }
  | { kind: "cooldown"; retryAfterMs: number }
  | { kind: "rate_limited"; bucket: "new" | "cached"; retryAfterMs: number }
  | { kind: "failed"; jobId: string };
