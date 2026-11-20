import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import checkFixtures from "./fixtures/check-responses.json" with { type: "json" };
const bin = "./node_modules/.bin/wrangler";
const config = "tests/wrangler.check.jsonc";
const dir = mkdtempSync(join(tmpdir(), "check-d1-"));
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing port");
const port = address.port;
await new Promise<void>((resolve) => server.close(() => resolve()));
let child: ChildProcess | undefined;
let output = "";
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
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let n = 0; n < 80; n++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Wrangler exited: ${output}`);
    try {
      if ((await fetch(`${url}/ready`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await delay(250);
  }
  if (!ready) throw new Error(`Wrangler unavailable: ${output}`);
  const post = async (origin: string, extra: Record<string, unknown> = {}) =>
    fetch(`${url}/v1/checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "secret=yes",
        "X-Principal": "account:forged",
      },
      body: JSON.stringify({ origin, ...extra }),
    });
  const mislabeled = await fetch(`${url}/v1/checks`, {
    method: "POST",
    headers: { "Content-Type": "application/jsonp" },
    body: JSON.stringify({ origin: "https://mislabeled.example.com" }),
  });
  assert.equal(
    mislabeled.status,
    400,
    "Wrangler must reject non-JSON media types before admission",
  );
  const first = await post("https://one.myshopify.com/items/1");
  assert.equal(first.status, 202, await first.clone().text());
  const firstBody = (await first.json()) as {
    status: string;
    checkId: string;
    storeId: string;
  };
  assert.deepEqual(firstBody, {
    ...checkFixtures.checking,
    checkId: firstBody.checkId,
    storeId: "tenant:one.myshopify.com",
    origin: "https://one.myshopify.com",
  });
  // Synthetic fixture routes stand in for server-authenticated Alice/Bob ingress;
  // no shopper header or body value selects the trusted principal.
  const principalPost = async (who: "alice" | "bob", origin: string) =>
    fetch(`${url}/fixture/${who}/v1/checks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Principal": "account:forged",
      },
      body: JSON.stringify({ origin }),
    });
  const principalGet = async (who: "alice" | "bob", id: string) =>
    fetch(`${url}/fixture/${who}/v1/checks/${id}`, {
      headers: { "X-Principal": "account:forged" },
    });
  const keyed = (who: "alice" | "bob", key: string, origin: string) =>
    fetch(`${url}/fixture/${who}/v1/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ origin }),
    });
  const keyedFirst = await keyed(
    "alice",
    "worker-replay-key",
    "https://replay.example.com/path?secret=no",
  );
  assert.equal(keyedFirst.status, 202);
  const keyedText = await keyedFirst.text();
  const keyedId = (JSON.parse(keyedText) as { checkId: string }).checkId;
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      keyed("alice", "worker-replay-key", "https://replay.example.com/other"),
    ),
  );
  for (const response of concurrent) {
    assert.equal(response.status, 202);
    assert.equal(await response.text(), keyedText);
  }
  const mismatch = await keyed(
    "alice",
    "worker-replay-key",
    "https://different.example.com",
  );
  assert.equal(mismatch.status, 409);
  assert.ok(!(await mismatch.text()).includes(keyedId));
  const foreignKey = await keyed(
    "bob",
    "worker-replay-key",
    "https://replay.example.com",
  );
  assert.equal(foreignKey.status, 202);
  assert.notEqual(
    ((await foreignKey.json()) as { checkId: string }).checkId,
    keyedId,
  );
  assert.equal((await principalGet("bob", keyedId)).status, 404);
  const stats = (await (
    await fetch(`${url}/fixture/idempotency-stats`)
  ).json()) as {
    rows: number;
    aliceNew: number;
    leaked: boolean;
    foreignKeys: number;
  };
  assert.deepEqual(stats, {
    rows: 2,
    aliceNew: 1,
    leaked: false,
    foreignKeys: 0,
  });
  const alice = await principalPost("alice", "https://example.com");
  assert.equal(alice.status, 202, await alice.clone().text());
  const { checkId } = (await alice.json()) as { checkId: string };
  const denied = await principalGet("bob", checkId);
  assert.equal(denied.status, 404);
  assert.ok(!(await denied.text()).includes(checkId));
  assert.equal((await principalGet("alice", checkId)).status, 200);
  const repeated = await post("https://one.myshopify.com/items/2");
  const body = (await repeated.json()) as {
    status: string;
    checkId: string;
    storeId: string;
  };
  assert.equal(firstBody.checkId, body.checkId);
  assert.equal(body.status, "checking");
  assert.equal(body.storeId, "tenant:one.myshopify.com");
  assert.equal(
    (
      (await (await fetch(`${url}/v1/checks/${body.checkId}`)).json()) as {
        status: string;
      }
    ).status,
    "checking",
  );
  assert.equal((await post("http://127.0.0.1")).status, 400);
  assert.equal((await post("https://two.myshopify.com")).status, 202);
  assert.equal(
    (await post("https://example.com", { principal: "account:forged" })).status,
    400,
  );
  assert.equal((await fetch(`${url}/state`)).status, 404);
  // A real Wrangler process restart keeps the D1 job and scoped check ID usable.
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child!.once("exit", resolve));
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
  child.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });
  let restarted = false;
  for (let n = 0; n < 80; n++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Wrangler restart exited: ${output}`);
    try {
      if ((await fetch(`${url}/ready`)).ok) {
        restarted = true;
        break;
      }
    } catch {
      /* restarting */
    }
    await delay(250);
  }
  assert.ok(restarted, `Wrangler restart unavailable: ${output}`);
  const replayed = await keyed(
    "alice",
    "worker-replay-key",
    "https://replay.example.com",
  );
  assert.equal(replayed.status, 202);
  assert.equal(await replayed.text(), keyedText);
  assert.equal((await principalGet("alice", checkId)).status, 200);
  assert.equal((await principalGet("bob", checkId)).status, 404);
  const completed = await fetch(`${url}/fixture/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: checkId.split(".")[0] }),
  });
  assert.deepEqual(await completed.json(), { completed: true });
  const aliceComplete = await principalGet("alice", checkId);
  assert.equal(aliceComplete.status, 200);
  assert.deepEqual(await aliceComplete.json(), {
    ...checkFixtures.complete,
    checkId,
  });
  const bobComplete = await principalGet("bob", checkId);
  assert.equal(bobComplete.status, 404);
  assert.ok(!(await bobComplete.text()).includes(checkId));
  const joined = await principalPost("bob", "https://example.com");
  assert.equal(joined.status, 200);
  const bobBody = (await joined.json()) as { checkId: string; status: string };
  assert.equal(bobBody.status, "cached");
  assert.notEqual(bobBody.checkId, checkId);
  assert.equal((await principalGet("bob", bobBody.checkId)).status, 200);
  assert.equal((await principalGet("alice", bobBody.checkId)).status, 404);
  const cachedKey = await keyed(
    "bob",
    "worker-cached-key",
    "https://example.com/first-path",
  );
  assert.equal(cachedKey.status, 200);
  const cachedText = await cachedKey.text();
  const cachedReplay = await keyed(
    "bob",
    "worker-cached-key",
    "https://example.com/second-path",
  );
  assert.equal(cachedReplay.status, 200);
  assert.equal(await cachedReplay.text(), cachedText);
  console.log(
    "Wrangler-local D1 /v1 HTTP passed: atomic keyed replay under 8 concurrent POSTs, conflict/principal isolation, quota + FK invariants, restart, checking/complete/cache grants",
  );
} finally {
  if (child) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child!.once("exit", resolve)),
      delay(3000),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
}
