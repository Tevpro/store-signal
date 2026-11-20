// Reproducible headed real-Chromium toolbar probe. Native optional permissions
// are granted only through visible Chromium UI, never CDP, flags or APIs.
// Run from repo root after `npm ci --ignore-scripts` and extension build:
// CHROMIUM_PATH=/path/to/chrome node --import tsx apps/extension/tests/browser-integration.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { migrateNodeStorage } from "../../../packages/runtime-node/src/storage.ts";
import { nodeCheckListener } from "../../../packages/runtime-node/src/check-http.ts";
import { createAdmission } from "../../../packages/storage-sqlite/src/admission.ts";
import { nodeSqlPort } from "../../../packages/runtime-node/src/storage.ts";

const chromeBinary = process.env.CHROMIUM_PATH;
if (
  !chromeBinary ||
  !process.env.DISPLAY ||
  process.env.CHROMIUM_HEADED !== "1"
)
  throw new Error(
    "Set CHROMIUM_PATH, DISPLAY (private Xvfb), CHROMIUM_HEADED=1 for ordinary toolbar UI",
  );
const extension = resolve("apps/extension/dist");
const profile = mkdtempSync(join(tmpdir(), "storesignal-real-browser-"));
const d1 = mkdtempSync(join(tmpdir(), "storesignal-browser-d1-"));
const id = [...createHash("sha256").update(extension).digest().subarray(0, 16)]
  .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
  .join("");
const now = Date.parse("2026-11-18T12:00:00Z");
const assessment = {
  schemaVersion: 1,
  id: "browser-synthetic-limited",
  storeId: "domain:example.com",
  status: "limited",
  concern: "insufficient",
  reasonCodes: ["NO_CONNECTOR"],
  confidence: "insufficient",
  evidenceIds: [],
  coverage: [
    {
      schemaVersion: 1,
      connector: "synthetic",
      status: "unavailable",
      checkedAt: new Date(now).toISOString(),
      limitation: "No provider",
    },
  ],
  limitations: ["No evidence"],
  checkedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 7 * 86400_000).toISOString(),
  aiMode: "none",
  publicationStatus: "draft",
};
const requests = [];
let browser, server, proxy, db, worker, workerCompleteUrl;
const root = "http://127.0.0.1";
async function freePort() {
  const socket = createSocket();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function nodeApi() {
  db = new DatabaseSync(":memory:");
  migrateNodeStorage(
    db,
    [1, 2, 3, 4, 5, 6].map((version) => ({
      version,
      sql: readFileSync(
        resolve(
          "migrations",
          `${String(version).padStart(4, "0")}_${["fixture_stores", "persistence", "admission", "quotas", "check_access", "check_idempotency"][version - 1]}.sql`,
        ),
        "utf8",
      ),
    })),
  );
  server = createServer((req, res) => {
    const item = {
      runtime: "node",
      method: req.method,
      path: req.url,
      cookie: req.headers.cookie ?? null,
    };
    requests.push(item);
    const end = res.end.bind(res);
    res.end = (chunk, ...rest) => {
      try {
        item.responseStatus = JSON.parse(String(chunk)).status;
      } catch {
        /* non-JSON response */
      }
      return end(chunk, ...rest);
    };
    if (req.method === "POST")
      req.on("data", (b) => {
        item.body = (item.body ?? "") + b.toString();
      });
    nodeCheckListener(db, {
      scope: { principal: "install:browser", edge: "edge:browser" },
      enabled: true,
      statusTokenKey: "synthetic-browser-key-not-production",
      now: () => now,
    })(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `${root}:${server.address().port}/v1/`;
}
async function workerApi() {
  const bin = "./node_modules/.bin/wrangler";
  const config = "tests/wrangler.check.jsonc";
  execFileSync(bin, [
    "d1",
    "migrations",
    "apply",
    "store-signal-local-fixtures",
    "--local",
    "--config",
    config,
    "--persist-to",
    d1,
  ]);
  const port = await freePort();
  worker = spawn(
    bin,
    [
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      d1,
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  worker.stdout.on("data", (b) => (output += b.toString()));
  worker.stderr.on("data", (b) => (output += b.toString()));
  for (let n = 0; n < 80; n++) {
    if (worker.exitCode !== null || worker.signalCode !== null)
      throw new Error(`Wrangler exited: ${output}`);
    try {
      if ((await fetch(`${root}:${port}/ready`)).ok) {
        workerCompleteUrl = `${root}:${port}/fixture/complete`;
        proxy = createServer(async (req, res) => {
          const item = {
            runtime: "worker",
            method: req.method,
            path: req.url,
            cookie: req.headers.cookie ?? null,
          };
          requests.push(item);
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          if (body.length) item.body = body.toString();
          const upstream = await fetch(
            `${root}:${port}/fixture/alice${req.url}`,
            {
              method: req.method,
              headers: { "Content-Type": "application/json" },
              body: req.method === "POST" ? body : undefined,
            },
          );
          const responseBody = Buffer.from(await upstream.arrayBuffer());
          item.response = JSON.parse(responseBody.toString());
          res.writeHead(upstream.status, {
            "Content-Type":
              upstream.headers.get("Content-Type") ?? "application/json",
          });
          res.end(responseBody);
        });
        proxy.listen(0, "127.0.0.1");
        await once(proxy, "listening");
        return `${root}:${proxy.address().port}/v1/`;
      }
    } catch {
      /* startup */
    }
    await delay(250);
  }
  throw new Error(`Wrangler did not start: ${output}`);
}
// Playwright intentionally omits the browser-action popup from context.pages().
// Attach only AFTER the ordinary toolbar click has created a popup target.
async function openToolbarPopup(store) {
  await store.bringToFront();
  assert.match(store.url(), /^https:\/\/example\.com\/cart\?/);
  console.log(
    execFileSync("python3", ["apps/extension/tests/toolbar-ui.py"], {
      encoding: "utf8",
    }).trim(),
  );
  const cdp = await browser.newCDPSession(store);
  let target;
  for (let n = 0; n < 30; n++) {
    target = (await cdp.send("Target.getTargets")).targetInfos.find(
      (item) =>
        item.type === "page" &&
        item.url === `chrome-extension://${id}/popup.html`,
    );
    if (target) break;
    await delay(100);
  }
  assert.ok(target, "No actual popup target after toolbar UI click");
  assert.ok(
    !browser.pages().some((p) => p.url() === target.url),
    "Direct popup tab is NOT toolbar proof",
  );
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  let serial = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? reject(new Error(JSON.stringify(message.error)))
      : resolve(message.result);
  });
  async function evaluate(expression) {
    const requestId = ++serial;
    const result = new Promise((resolve, reject) =>
      pending.set(requestId, { resolve, reject }),
    );
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({
        id: requestId,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    });
    const reply = await Promise.race([
      result,
      delay(5000).then(() => {
        throw new Error("Popup target CDP reply timed out");
      }),
    ]);
    if (reply.exceptionDetails)
      throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  }
  await until(
    () => evaluate("Boolean(document.querySelector('#mode'))"),
    "popup DOM ready",
  );
  return { evaluate, close: () => cdp.detach(), target: target.targetId };
}
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Timeout waiting for ${label}`);
}
async function probe(label, endpoint, store, complete) {
  const runtime = label.toLowerCase().split("/")[0];
  const before = requests.length;
  assert.equal(
    requests.filter((r) => r.runtime === runtime).length,
    0,
    `${label}: passive requests before popup`,
  );
  let popup = await openToolbarPopup(store);
  // Set controls by user-facing DOM events within the ALREADY OPEN action popup.
  await popup.evaluate(
    "(() => { const mode=document.querySelector('#mode'); mode.value='self'; mode.dispatchEvent(new Event('change',{bubbles:true})); return true; })()",
  );
  await delay(300);
  await popup.evaluate(
    `(() => { const endpoint=document.querySelector('#endpoint'); endpoint.value=${JSON.stringify(endpoint)}; endpoint.dispatchEvent(new Event('input',{bubbles:true})); return endpoint.value; })()`,
  );
  assert.equal(
    await popup.evaluate("document.querySelector('#endpoint').value"),
    endpoint,
  );
  assert.equal(
    requests.length,
    before,
    `${label}: passive request before explicit Check click`,
  );
  console.log(
    "before visible click",
    await popup.evaluate("document.querySelector('#result').textContent"),
  );
  execFileSync("xdotool", ["mousemove", "982", "330", "click", "1"]);
  // A native permission prompt can destroy the popup target immediately.
  // Only the ordinary, OCR-verified browser permission UI may grant loopback access.
  console.log(
    execFileSync("python3", ["apps/extension/tests/permission-ui.py"], {
      encoding: "utf8",
      timeout: 70000,
    }).trim(),
  );
  // The permission dialog may destroy the popup process: reopen via ordinary toolbar if needed.
  try {
    await popup.evaluate("document.querySelector('#result').textContent");
  } catch {
    await popup.close();
    popup = await openToolbarPopup(store);
  }
  if (
    !requests
      .slice(before)
      .some((r) => r.runtime === runtime && r.method === "POST")
  ) {
    // Chromium closes the action popup while presenting the native prompt.
    // Re-open the toolbar action and click again now that the user granted access.
    await popup.evaluate(
      "(() => { const mode=document.querySelector('#mode'); mode.value='self'; mode.dispatchEvent(new Event('change',{bubbles:true})); return true; })()",
    );
    await delay(300);
    await popup.evaluate(
      `(() => { const endpoint=document.querySelector('#endpoint'); endpoint.value=${JSON.stringify(endpoint)}; endpoint.dispatchEvent(new Event('input',{bubbles:true})); return endpoint.value; })()`,
    );
    assert.equal(
      requests.length,
      before,
      `${label}: no request from reopen alone`,
    );
    execFileSync("xdotool", ["mousemove", "982", "330", "click", "1"]);
  }
  const post = await until(
    () =>
      requests
        .slice(before)
        .find((r) => r.runtime === runtime && r.method === "POST"),
    `${label} POST`,
  );
  assert.equal(post.body, '{"origin":"https://example.com"}');
  const checking = await popup.evaluate(
    "document.querySelector('#result').textContent",
  );
  assert.match(checking, /Checking/, `${label}: checking UI before fixture completion`);
  await complete();
  await until(
    async () =>
      /Insufficient evidence/.test(
        await popup.evaluate("document.querySelector('#result').textContent"),
      ),
    `${label} complete`,
  );
  assert.match(
    await popup.evaluate("document.querySelector('#result').textContent"),
    /Limited assessment/,
  );
  execFileSync("xdotool", ["mousemove", "982", "330", "click", "1"]);
  await until(
    async () =>
      /Last checked:/.test(
        await popup.evaluate("document.querySelector('#result').textContent"),
      ),
    `${label} cached`,
  );
  const sent = requests.slice(before).filter((r) => r.runtime === runtime);
  assert.ok(
    sent.some((r) => r.method === "GET") &&
      sent.filter((r) => r.method === "POST").length >= 2,
  );
  assert.ok(
    sent.every(
      (r) =>
        r.cookie === null &&
        !/never-send|fragment|\/cart/.test(JSON.stringify(r)),
    ),
  );
  assert.ok(
    sent
      .filter((r) => r.method === "POST")
      .every((r) => r.body === '{"origin":"https://example.com"}'),
  );
  const statuses = sent.map((r) => r.responseStatus ?? r.response?.status);
  assert.deepEqual(
    statuses,
    ["checking", "complete", "cached"],
    `${label} wire lifecycle`,
  );
  console.log(
    `${label}: genuine toolbar popup with selected public store; zero passive requests; visible optional-host Allow then explicit click; wire ${statuses.join(" → ")}; only origin in both POST bodies, no cookies/path/HTML`,
  );
  await popup.close();
}
try {
  const nodeEndpoint = await nodeApi();
  const workerEndpoint = await workerApi();
  browser = await chromium.launchPersistentContext(profile, {
    executablePath: chromeBinary,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-sandbox",
      "--window-size=1280,900",
    ],
  });
  const store = await browser.newPage();
  await store.goto("https://example.com/cart?secret=never-send#fragment", {
    waitUntil: "domcontentloaded",
  });
  await probe("Node/SQLite", nodeEndpoint, store, async () => {
    const post = requests.find(
      (r) => r.runtime === "node" && r.method === "POST",
    );
    assert.ok(post, "No Node POST");
    const job = db
      .prepare("SELECT id, generation FROM investigation_jobs")
      .get();
    assert.ok(job, "No Node job");
    assert.equal(
      await createAdmission(nodeSqlPort(db)).complete(
        job.id,
        job.generation,
        now + 1,
        assessment,
      ),
      true,
    );
  });
  console.log(
    "Worker ingress is test-only /fixture/alice/v1/; actual product /v1/ remains fail-closed.",
  );
  await probe("Worker/D1", workerEndpoint, store, async () => {
    const check = requests.find(
      (r) => r.runtime === "worker" && r.method === "POST",
    );
    assert.ok(check, "No Worker POST");
    // The test ingress owns completion; this route is never shipped in the product Worker.
    const completed = await fetch(workerCompleteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: check.response.checkId.split(".")[0] }),
    });
    assert.deepEqual(await completed.json(), { completed: true });
  });
} finally {
  await browser?.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
  if (worker) {
    worker.kill("SIGTERM");
    await Promise.race([once(worker, "exit"), delay(3000)]);
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill("SIGKILL");
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db?.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(d1, { recursive: true, force: true });
}
