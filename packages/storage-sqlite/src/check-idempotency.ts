import type { SqlPort } from "./index.ts";

const WINDOW_MS = 10 * 60_000;
const LEASE_MS = 15_000;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function mac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export type Replay =
  | {
      kind: "owner";
      finish: (
        jobId: string,
        replyKind: "checking" | "cached",
      ) => Promise<void>;
      abandon: () => Promise<void>;
    }
  | { kind: "ready"; jobId: string; replyKind: "checking" | "cached" }
  | { kind: "conflict" | "pending" };
/** Per-principal key reservation uses one serialized SQLite INSERT/UPDATE, not an
 * advisory read-then-write. Lease recovery permits retry after a crashed owner;
 * global admission still enforces single-flight. In-flight waits are bounded. */
export async function reserveCheck(
  port: SqlPort,
  secret: string,
  principal: string,
  key: string,
  origin: string,
  now: number,
): Promise<Replay> {
  const [scopeMac, keyMac, requestMac] = await Promise.all([
    mac(secret, `scope\n${principal}`),
    mac(secret, `key\n${key}`),
    mac(secret, `request\n${origin}`),
  ]);
  const owner = crypto.randomUUID();
  const wall = Date.now();
  await port.batch([
    {
      sql: "DELETE FROM check_idempotency WHERE expires_at_ms<=?",
      params: [now],
    },
  ]);
  const inserted = await port.query(
    `INSERT OR IGNORE INTO check_idempotency(scope_mac,key_mac,request_mac,owner,lease_until_ms,expires_at_ms)
    VALUES (?,?,?,?,?,?) RETURNING owner`,
    [scopeMac, keyMac, requestMac, owner, wall + LEASE_MS, now + WINDOW_MS],
  );
  const owned = (): Replay => ({
    kind: "owner",
    finish: async (jobId, replyKind) => {
      const rows = await port.query(
        "UPDATE check_idempotency SET job_id=?,reply_kind=? WHERE scope_mac=? AND key_mac=? AND owner=? AND job_id IS NULL AND lease_until_ms>? RETURNING owner",
        [jobId, replyKind, scopeMac, keyMac, owner, Date.now()],
      );
      if (rows.length !== 1) throw new Error("Idempotency reservation lost");
    },
    abandon: async () => {
      await port.batch([
        {
          sql: "DELETE FROM check_idempotency WHERE scope_mac=? AND key_mac=? AND owner=? AND job_id IS NULL",
          params: [scopeMac, keyMac, owner],
        },
      ]);
    },
  });
  if (inserted.length) return owned();
  // Conditional takeover is serialized. A crashed owner may have admitted a job;
  // admission.check joins it rather than charging a second new-job reservation.
  for (let attempt = 0; attempt < 40; attempt++) {
    const [row] = await port.query(
      "SELECT request_mac,job_id,reply_kind,lease_until_ms FROM check_idempotency WHERE scope_mac=? AND key_mac=?",
      [scopeMac, keyMac],
    );
    if (!row) return { kind: "pending" };
    if (row.request_mac !== requestMac) return { kind: "conflict" };
    if (
      typeof row.job_id === "string" &&
      (row.reply_kind === "checking" || row.reply_kind === "cached")
    )
      return { kind: "ready", jobId: row.job_id, replyKind: row.reply_kind };
    const current = Date.now();
    if (Number(row.lease_until_ms) <= current) {
      const taken = await port.query(
        "UPDATE check_idempotency SET owner=?,lease_until_ms=? WHERE scope_mac=? AND key_mac=? AND job_id IS NULL AND lease_until_ms<=? RETURNING owner",
        [owner, current + LEASE_MS, scopeMac, keyMac, current],
      );
      if (taken.length) return owned();
    }
    await pause(25);
  }
  return { kind: "pending" };
}
