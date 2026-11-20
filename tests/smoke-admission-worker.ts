import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const bin = './node_modules/.bin/wrangler';
const config = 'tests/wrangler.admission.jsonc';
const dir = mkdtempSync(join(tmpdir(), 'admission-d1-'));
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing port');
const port = address.port;
await new Promise<void>((resolve) => server.close(() => resolve()));
let child: ChildProcess | undefined;
let output = '';
async function stop() {
  if (!child) return;
  const current = child;
  current.kill('SIGTERM');
  await Promise.race([new Promise<void>((resolve) => current.once('exit', resolve)), delay(3000)]);
  if (current.exitCode === null && current.signalCode === null) current.kill('SIGKILL');
  child = undefined;
}
async function start() {
  child = spawn(bin, ['dev','--local','--config',config,'--persist-to',dir,'--port',String(port),'--ip','127.0.0.1'], {stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
  for (let n = 0; n < 80; n++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Wrangler exited: ${output}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return; } catch { /* startup */ }
    await delay(250);
  }
  throw new Error(`Wrangler unavailable: ${output}`);
}
async function call<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, value === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(value)});
  if (!response.ok) throw new Error(`${path}: ${response.status}: ${await response.text()}\n${output}`);
  return response.json() as Promise<T>;
}
const time = Date.parse('2026-11-18T12:00:00Z');
const assessment = {schemaVersion:1,id:'result-a',storeId:'domain:example.com',status:'no_match',concern:'insufficient',reasonCodes:['NO_MATCH'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'no_match',checkedAt:new Date(time).toISOString()}],limitations:[],checkedAt:new Date(time).toISOString(),expiresAt:new Date(time + 7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
try {
  execFileSync(bin, ['d1','migrations','apply','store-signal-local-fixtures','--local','--config',config,'--persist-to',dir], {stdio:'pipe'});
  await start();
  await call('/arm', {});
  const pending = Promise.all(Array.from({length:12}, (_, i) => call<{kind:string;jobId:string;generation:number}>('/check', {id:`d1-${i}`,now:time})));
  let arrivals = 0;
  for (let n = 0; n < 80; n++) {
    arrivals = (await call<{waiting:number}>('/waiting')).waiting;
    if (arrivals === 12) break;
    await delay(50);
  }
  assert.equal(arrivals, 12, 'all HTTP requests must reach the pre-admission barrier');
  await call('/release', {});
  const concurrent = await pending;
  assert.equal(concurrent.filter((r) => r.kind === 'admitted').length, 1);
  assert.equal(concurrent.filter((r) => r.kind === 'joined').length, 11);
  const jobId = concurrent[0]!.jobId;
  assert.ok(concurrent.every((r) => r.jobId === jobId));
  const state = await call<{jobs:unknown[];assessments:unknown[];violations:unknown[]}>('/state');
  assert.equal(state.jobs.length, 1);
  assert.equal(state.assessments.length, 0);
  assert.equal(state.violations.length, 0);
  await stop();
  await start();
  assert.deepEqual(await call('/check', {id:'recovery',now:time+60_000}), {kind:'recovered',jobId,generation:2});
  assert.deepEqual(await call('/complete', {id:jobId,generation:1,now:time+60_001,assessment}), {completed:false});
  assert.deepEqual(await call('/complete', {id:jobId,generation:2,now:time+60_001,assessment}), {completed:true});
  assert.deepEqual(await call('/complete', {id:jobId,generation:1,now:time+60_002,assessment}), {completed:false});
  assert.deepEqual(await call('/check', {id:'cache',now:time+7*86400_000-1}), {kind:'cached',jobId});
  assert.deepEqual(await call('/check', {id:'forged-refresh',now:time+7*86400_000-1,refresh:true}), {kind:'cached',jobId});
  assert.equal((await call<{kind:string}>('/check', {id:'new',now:time+7*86400_000})).kind, 'admitted');
  const final = await call<{jobs:unknown[];assessments:unknown[];violations:unknown[]}>('/state');
  assert.equal(final.jobs.length, 2);
  assert.equal(final.assessments.length, 1);
  assert.equal(final.violations.length, 0);
  console.log('Wrangler-local D1 admission passed: 12 concurrent HTTP requests, DB invariant, restart recovery, fenced completion, seven-day cache boundary');
} finally { await stop(); rmSync(dir, {recursive:true, force:true}); }
