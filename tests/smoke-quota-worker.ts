import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const bin = "./node_modules/.bin/wrangler",
  config = "tests/wrangler.admission.jsonc";
const dir = mkdtempSync(join(tmpdir(), "quota-d1-"));
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address();
if (!address || typeof address === "string") throw Error("No port");
const port = address.port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
let child: ChildProcess | undefined,
  output = "";
async function start() {
  child = spawn(
    bin,
    [
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      dir,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`Wrangler exited: ${output}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return;
    } catch {
      /* startup */
    }
    await delay(250);
  }
  throw Error(`Wrangler unavailable: ${output}`);
}
async function stop() {
  if (!child) return;
  const old = child;
  old.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => old.once("exit", resolve)),
    delay(3000),
  ]);
  if (old.exitCode === null && old.signalCode === null) old.kill("SIGKILL");
  child = undefined;
}
async function call<T>(route: string, body?: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${port}${route}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok)
    throw Error(
      `${route}: ${response.status}: ${await response.text()} ${output}`,
    );
  return response.json() as Promise<T>;
}
const time = Date.parse("2026-11-18T12:00:00Z");
try {
  execFileSync(
    bin,
    [
      "d1",
      "migrations",
      "apply",
      "store-signal-local-fixtures",
      "--local",
      "--config",
      config,
      "--persist-to",
      dir,
    ],
    { stdio: "pipe" },
  );
  await start();
  await call("/arm", {});
  const pending = Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      call<{ kind: string; retryAfterMs?: number }>("/quota-check", {
        id: `quota-${i}`,
        name: `store-${i}`,
        now: time,
        principal: `install:rotated-${i}`,
        tenantKey: `tenant-${i}`,
      }),
    ),
  );
  let arrivals = 0;
  for (let i = 0; i < 100; i++) {
    arrivals = (await call<{ waiting: number }>("/waiting")).waiting;
    if (arrivals === 12) break;
    await delay(50);
  }
  assert.equal(arrivals, 12, "all requests reached HTTP barrier");
  await call("/release", {});
  const results = await pending;
  assert.equal(results.filter((r) => r.kind === "admitted").length, 5);
  assert.equal(results.filter((r) => r.kind === "rate_limited").length, 7);
  const before = await call<{
    jobs: unknown[];
    events: { scope: string; bucket: string }[];
  }>("/quota-state");
  assert.equal(before.jobs.length, 5);
  assert.equal(
    before.events.filter(
      (x) => x.scope === "account:trusted-a" && x.bucket === "new",
    ).length,
    5,
  );
  await stop();
  await start();
  assert.equal(
    (
      await call<{ kind: string }>("/quota-check", {
        id: "restart",
        name: "restart",
        now: time + 1,
        principal: "account:forged",
        tenantKey: "other",
      })
    ).kind,
    "rate_limited",
  );
  assert.equal(
    (
      await call<{ kind: string }>("/quota-check", {
        id: "minute",
        name: "minute",
        now: time + 60_000,
      })
    ).kind,
    "admitted",
  );
  const statuses = await Promise.all(
    Array.from({ length: 80 }, () =>
      call<{ allowed: boolean }>("/quota-take", {
        bucket: "status",
        now: time,
      }),
    ),
  );
  assert.equal(statuses.filter((x) => x.allowed).length, 60);
  const ai = await Promise.all(
    Array.from({ length: 8 }, () =>
      call<{ allowed: boolean }>("/quota-take", { bucket: "ai", now: time }),
    ),
  );
  assert.equal(ai.filter((x) => x.allowed).length, 2);
  const after = await call<{
    violations: unknown[];
    events: { scope: string; bucket: string }[];
  }>("/quota-state");
  assert.equal(after.violations.length, 0);
  assert.ok(after.events.every((x) => !x.scope.includes("forged")));
  const store = { id: "cached-job", name: "cacheable", now: time + 120_000 };
  assert.equal(
    (await call<{ kind: string }>("/quota-check", store)).kind,
    "admitted",
  );
  assert.deepEqual(
    await call("/quota-complete", {
      id: "cached-job",
      name: "cacheable",
      at: time + 120_000,
      now: time + 120_001,
    }),
    { completed: true },
  );
  const caches = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      call<{ kind: string }>("/quota-check", {
        id: `cached-${i}`,
        name: "cacheable",
        now: time + 120_002,
        tenantKey: `fake-${i}`,
      }),
    ),
  );
  assert.equal(caches.filter((r) => r.kind === "cached").length, 30);
  assert.equal(caches.filter((r) => r.kind === "rate_limited").length, 10);
  const final = await call<{
    jobs: unknown[];
    events: { scope: string; bucket: string }[];
  }>("/quota-state");
  assert.equal(
    final.events.filter(
      (x) => x.scope === "account:trusted-a" && x.bucket === "cached",
    ).length,
    30,
  );
  assert.equal(final.jobs.length, 7);
  const anonymous = await Promise.all(
    Array.from({ length: 21 }, (_, i) =>
      call<{ allowed: boolean }>("/quota-take", {
        bucket: "new",
        now: time + 180_000,
        anonymousInstall: i,
      }),
    ),
  );
  assert.equal(anonymous.filter((x) => x.allowed).length, 20);
  assert.equal(anonymous.filter((x) => !x.allowed).length, 1);
  const skew = time + 86400_000;
  await call("/arm", {});
  const earlier = call<{
    kind: string;
    bucket?: string;
    retryAfterMs?: number;
  }>("/quota-check", { id: "skew-earlier", name: "skew-earlier", now: skew });
  let held = 0;
  for (let i = 0; i < 100; i++) {
    held = (await call<{ waiting: number }>("/waiting")).waiting;
    if (held === 1) break;
    await delay(50);
  }
  assert.equal(held, 1, "earlier request reached HTTP barrier");
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await call<{ kind: string }>("/quota-check-unheld", {
          id: `skew-later-${i}`,
          name: `skew-later-${i}`,
          now: skew + 1,
        })
      ).kind,
      "admitted",
    );
  await call("/release", {});
  assert.deepEqual(await earlier, {
    kind: "rate_limited",
    bucket: "new",
    retryAfterMs: 60_001,
  });
  const skewState = await call<{
    jobs: unknown[];
    events: { scope: string; bucket: string }[];
  }>("/quota-state");
  assert.equal(skewState.jobs.length, 12);
  for (const [bucket, limit] of [
    ["cached", 30],
    ["status", 60],
    ["ai", 2],
  ] as const) {
    for (let i = 0; i < limit; i++)
      assert.equal(
        (
          await call<{ allowed: boolean }>("/quota-take", {
            bucket,
            now: skew + 120_001,
          })
        ).allowed,
        true,
      );
    assert.deepEqual(
      await call("/quota-take", { bucket, now: skew + 120_000 }),
      { allowed: false, retryAfterMs: 60_001 },
    );
  }
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await call<{ allowed: boolean }>("/quota-take", {
          bucket: "new",
          now: skew + 240_001,
          anonymousInstall: i,
        })
      ).allowed,
      true,
    );
  assert.deepEqual(
    await call("/quota-take", {
      bucket: "new",
      now: skew + 240_000,
      anonymousInstall: 20,
    }),
    { allowed: false, retryAfterMs: 60_001 },
  );
  const fractional = time + 2 * 86400_000;
  assert.equal(
    (
      await call<{ kind: string }>("/quota-check", {
        id: "fractional-job",
        name: "fractional",
        now: fractional,
      })
    ).kind,
    "admitted",
  );
  assert.deepEqual(
    await call("/quota-complete", {
      id: "fractional-job",
      name: "fractional",
      at: fractional,
      now: fractional + 1,
      secondsExpiry: true,
    }),
    { completed: true },
  );
  const expiry = new Date(fractional + 7 * 86400_000).toISOString();
  assert.equal(
    (await call<{ expiry: string }>("/quota-expiry?id=fractional-job")).expiry,
    expiry,
  );
  await call("/quota-prune", {
    now: new Date(fractional + 7 * 86400_000 + 500).toISOString(),
  });
  assert.equal(
    (await call<{ expiry: string | null }>("/quota-expiry?id=fractional-job"))
      .expiry,
    null,
  );
  assert.equal(
    (await call<{ jobs: { id: string }[] }>("/quota-state")).jobs.some(
      (job) => job.id === "fractional-job",
    ),
    false,
  );
  console.log(
    "Wrangler-local D1 quota passed: equal-time races, delayed-earlier new/cached/status/AI and edge limits, restart, fractional expiry prune, bucket isolation",
  );
} finally {
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
