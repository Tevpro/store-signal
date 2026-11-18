import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseFixtures } from '../packages/contracts/src/index.ts';

const fixtures = parseFixtures(JSON.parse(readFileSync(new URL('./fixtures/stores.json', import.meta.url), 'utf8')) as unknown);
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (typeof address !== 'object' || address === null) throw new Error('Missing TCP port');
const port = address.port;
await new Promise<void>((resolve) => server.close(() => resolve()));
const dir = mkdtempSync(join(tmpdir(), 'storesignal-wrangler-'));
const bin = process.env.STORE_SIGNAL_WRANGLER_BIN ?? './node_modules/.bin/wrangler';
let wrangler: ReturnType<typeof spawn> | undefined;
let output = '';
let spawnError: Error | undefined;
try {
  try {
    execFileSync(bin, ['d1', 'migrations', 'apply', 'store-signal-local-fixtures', '--local', '--config', 'packages/runtime-cloudflare/wrangler.jsonc', '--persist-to', dir], { stdio: 'pipe' });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    throw new Error(`D1 migration failed${stderr ? `: ${stderr.toString()}` : ''}`, { cause: error });
  }
  wrangler = spawn(bin, ['dev', '--local', '--config', 'packages/runtime-cloudflare/wrangler.jsonc', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  wrangler.on('error', (error) => { spawnError = error; });
  wrangler.stdout?.on('data', (part: Buffer) => { output += part.toString(); });
  wrangler.stderr?.on('data', (part: Buffer) => { output += part.toString(); });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnError) throw spawnError;
    if (wrangler.exitCode !== null || wrangler.signalCode !== null) throw new Error(`Wrangler exited ${wrangler.exitCode ?? wrangler.signalCode}: ${output}`);
    try { response = await fetch(`http://127.0.0.1:${port}/smoke`); break; }
    catch { await delay(250); }
  }
  if (!response) throw new Error(`Wrangler did not start: ${output}`);
  if (response.status !== 200) throw new Error(`Worker HTTP ${response.status}: ${await response.text()}\n${output}`);
  const body: unknown = await response.json();
  assert.deepEqual(body, fixtures);
  const contractResponse = await fetch(`http://127.0.0.1:${port}/contracts-smoke`);
  assert.equal(contractResponse.status, 200);
  const golden: unknown = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8'));
  assert.deepEqual(await contractResponse.json(), golden);
  console.log(`Wrangler-local Worker/D1 smoke passed: HTTP 200, ${fixtures.length} shared fixture rows; /v1 contracts roundtripped through D1 JSON SQL`);
} finally {
  if (wrangler && wrangler.exitCode === null && wrangler.signalCode === null && !spawnError) {
    wrangler.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolve) => wrangler!.once('exit', () => resolve())), delay(3000)]);
    if (wrangler.exitCode === null && wrangler.signalCode === null) {
      wrangler.kill('SIGKILL');
      await Promise.race([new Promise<void>((resolve) => wrangler!.once('exit', () => resolve())), delay(3000)]);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
