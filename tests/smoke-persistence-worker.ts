import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const bin = process.env.STORE_SIGNAL_WRANGLER_BIN ?? './node_modules/.bin/wrangler';
const config = 'tests/wrangler.persistence.jsonc';
const dir = mkdtempSync(join(tmpdir(), 'storesignal-persistence-d1-'));
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No available port');
const port = address.port;
await new Promise<void>((resolve) => server.close(() => resolve()));
const url = `http://127.0.0.1:${port}/persistence-smoke`;
let child: ChildProcess | undefined;
let output = '';
async function stop() {
  if (!child) return;
  const current = child;
  if (current.exitCode === null && current.signalCode === null) {
    current.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolve) => current.once('exit', () => resolve())), delay(3000)]);
    if (current.exitCode === null && current.signalCode === null) current.kill('SIGKILL');
  }
  child = undefined;
}
async function start() {
  child = spawn(bin, ['dev', '--local', '--config', config, '--persist-to', dir, '--port', String(port), '--ip', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (part: Buffer) => { output += part.toString(); });
  child.stderr?.on('data', (part: Buffer) => { output += part.toString(); });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Wrangler exited: ${output}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/ready`); if (response.status === 200) return; }
    catch { /* waiting for readiness */ }
    await delay(250);
  }
  throw new Error(`Wrangler not ready: ${output}`);
}
async function request(method: string, path = '/persistence-smoke') {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  if (response.status !== 200) throw new Error(`${method} HTTP ${response.status}: ${await response.text()}\n${output}`);
  return response.json() as Promise<Record<string, unknown>>;
}
try {
  // Supported prior schema fixture -> Wrangler migration forward.
  // Pre-existing 0001 schema/data before Wrangler upgrades to 0002.
  execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--file', 'migrations/0001_fixture_stores.sql'], { stdio: 'pipe' });
  execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--command', "INSERT INTO fixture_stores (id,origin) VALUES ('prior','https://prior.example')"], { stdio: 'pipe' });
  execFileSync(bin, ['d1', 'migrations', 'apply', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir], { stdio: 'pipe' });
  execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--command', "CREATE TRIGGER injected_write_fault BEFORE INSERT ON assessments BEGIN SELECT RAISE(ABORT, 'injected assessment failure'); END"], { stdio: 'pipe' });
  await start();
  const failed = await fetch(url, { method: 'POST' });
  assert.equal(failed.status, 500);
  await stop();
  const rolledBack = execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--command', "SELECT (SELECT count(*) FROM investigation_jobs) AS jobs, (SELECT count(*) FROM evidence_refs) AS evidence"], { encoding: 'utf8' });
  assert.match(rolledBack, /"jobs": 0/);
  assert.match(rolledBack, /"evidence": 0/);
  execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--command', 'DROP TRIGGER injected_write_fault'], { stdio: 'pipe' });
  await start();
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>[]>;
  const identity = fixture.identity![0]!;
  const evidence = fixture.evidence![0]!;
  const assessment = fixture.assessment![0]!;
  assert.deepEqual(await request('POST'), { written: true });
  await stop();
  await start();
  assert.deepEqual(await request('GET'), {
    investigation: { identity, job: { id: 'worker-job', storeId: identity.storeId, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, evidence: [evidence], assessment },
    corrections: [{ id: 'worker-correction', storeId: identity.storeId, summary: 'Synthetic correction', createdAt: '2026-11-18T00:00:00Z' }],
    foreignPrivate: null,
    secondAccountPrivate: { ...assessment, id: 'worker-private', aiMode: 'byok', publicationStatus: 'draft' },
    ownerPrivate: { ...assessment, id: 'worker-private', aiMode: 'byok', publicationStatus: 'draft' },
  });
  assert.deepEqual(await request('DELETE', '/persistence-private-smoke'), {
    foreignDelete: false, secondAccountDelete: true,
    ownerPrivate: { ...assessment, id: 'worker-private', aiMode: 'byok', publicationStatus: 'draft' },
  });
  assert.deepEqual(await request('DELETE'), { investigation: null, ownerPrivate: null });
  await stop();
  const check = execFileSync(bin, ['d1', 'execute', 'store-signal-local-fixtures', '--local', '--config', config, '--persist-to', dir, '--command', "SELECT (SELECT count(*) FROM fixture_stores WHERE id='prior') AS prior, (SELECT count(*) FROM evidence_refs) AS evidence, (SELECT count(*) FROM pragma_foreign_key_check) AS violations"], { encoding: 'utf8' });
  assert.match(check, /"prior": 1/);
  assert.match(check, /"evidence": 0/);
  assert.match(check, /"violations": 0/);
  console.log('Wrangler-local Worker/D1 persistence passed: migrate, restart, dated records, isolation, retention and FK invariants');
} finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
