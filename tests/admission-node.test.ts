import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createAdmission } from '../packages/storage-sqlite/src/admission.ts';
import { nodeSqlPort, migrateNodeStorage } from '../packages/runtime-node/src/storage.ts';

const identity = { schemaVersion: 1, storeId: 'domain:example.com', origin: 'https://example.com', registrableDomain: 'example.com', matchExplanation: 'Independent registrable domain' };
const sql = ['0001_fixture_stores.sql', '0002_persistence.sql', '0003_admission.sql'].map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
const t0 = Date.parse('2026-11-18T12:00:00Z');
const open = (path: string) => { const db = new DatabaseSync(path); migrateNodeStorage(db, sql.map((text, i) => ({version: i + 1, sql: text}))); return db; };

test('separate SQLite connections admit exactly one job per rolling minute and join across installations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admission-node-'));
  const path = join(dir, 'db.sqlite');
  const dbs = Array.from({length: 8}, () => open(path));
  try {
    const results = await Promise.all(dbs.map((db, i) => createAdmission(nodeSqlPort(db)).check(identity, `j${i}`, t0)));
    assert.equal(results.filter((r) => r.kind === 'admitted').length, 1);
    assert.equal(results.filter((r) => r.kind === 'joined').length, 7);
    const id = results.find((r) => r.kind === 'admitted');
    assert.ok(id && 'jobId' in id);
    assert.ok(results.every((r) => 'jobId' in r && r.jobId === id.jobId));
    assert.equal(dbs[0]!.prepare('SELECT count(*) AS n FROM investigation_jobs').get()!.n, 1);
    assert.equal((await createAdmission(nodeSqlPort(dbs[0]!)).check(identity, 'early', t0 + 59_999)).kind, 'joined');
    assert.equal((await createAdmission(nodeSqlPort(dbs[0]!)).check(identity, 'at-minute', t0 + 60_000)).kind, 'recovered');
  } finally { dbs.forEach((db) => db.close()); rmSync(dir, {recursive: true, force: true}); }
});

test('expired lease recovers with a fenced generation; exhausted attempts fail closed', async () => {
  const db = open(':memory:');
  try {
    const admission = createAdmission(nodeSqlPort(db));
    assert.equal((await admission.check(identity, 'a', t0)).kind, 'admitted');
    const recovery = await admission.check(identity, 'b', t0 + 60_000);
    assert.deepEqual(recovery, {kind: 'recovered', jobId: 'a', generation: 2});
    assert.equal(await admission.complete('a', 1, t0 + 60_001, { schemaVersion: 1, id: 'stale', storeId: identity.storeId, status: 'no_match', concern: 'insufficient', reasonCodes: ['NO_MATCH'], confidence: 'insufficient', evidenceIds: [], coverage: [{schemaVersion: 1, connector: 'synthetic', status: 'no_match', checkedAt: new Date(t0).toISOString()}], limitations: [], checkedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + 7 * 86400_000).toISOString(), aiMode: 'none', publicationStatus: 'draft' }), false);
    assert.equal(db.prepare('SELECT count(*) AS n FROM assessments').get()!.n, 0);
    await admission.check(identity, 'c', t0 + 120_000);
    const failed = await admission.check(identity, 'd', t0 + 180_000);
    assert.equal(failed.kind, 'failed');
    assert.equal(db.prepare("SELECT state FROM investigation_jobs WHERE id='a'").get()!.state, 'failed');
    assert.equal((await admission.check(identity, 'e', t0 + 180_001)).kind, 'admitted');
  } finally { db.close(); }
});

test('completed assessment is fresh for exactly seven days; ordinary caller cannot force refresh', async () => {
  const db = open(':memory:');
  try {
    const admission = createAdmission(nodeSqlPort(db));
    await admission.check(identity, 'a', t0);
    const result = { schemaVersion: 1, id: 'result-a', storeId: identity.storeId, status: 'no_match', concern: 'insufficient', reasonCodes: ['NO_MATCH'], confidence: 'insufficient', evidenceIds: [], coverage: [{schemaVersion: 1, connector: 'synthetic', status: 'no_match', checkedAt: new Date(t0).toISOString()}], limitations: [], checkedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + 7 * 86400_000).toISOString(), aiMode: 'none', publicationStatus: 'draft' };
    assert.equal(await admission.complete('a', 1, t0 + 1, result), true);
    assert.deepEqual(await admission.check(identity, 'b', t0 + 6 * 86400_000, false), {kind: 'cached', jobId: 'a'});
    assert.deepEqual(await admission.check(identity, 'c', t0 + 6 * 86400_000, true), {kind: 'admitted', jobId: 'c', generation: 1});
    assert.deepEqual(await admission.check(identity, 'ordinary', t0 + 6 * 86400_000 + 1), {kind: 'cached', jobId: 'a'});
    assert.equal((await admission.check(identity, 'd', t0 + 7 * 86400_000)).kind, 'recovered');
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()!.n, 2);
  } finally { db.close(); }
});

test('forward migration fails closed an unleased F03 checking job then admits a retry', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(sql[0]!); db.exec(sql[1]!);
    db.prepare('INSERT INTO store_identities(store_id,payload) VALUES (?,?)').run(identity.storeId, JSON.stringify(identity));
    db.prepare('INSERT INTO investigation_jobs(id,store_id,state,created_at,payload) VALUES (?,?,?,?,?)').run('legacy', identity.storeId, 'checking', new Date(t0).toISOString(), JSON.stringify({id:'legacy',storeId:identity.storeId,state:'checking',createdAt:new Date(t0).toISOString()}));
    db.exec(sql[2]!);
    assert.deepEqual(await createAdmission(nodeSqlPort(db)).check(identity, 'later', t0 + 60_000), {kind:'admitted',jobId:'later',generation:1});
    assert.equal(db.prepare("SELECT state FROM investigation_jobs WHERE id='legacy'").get()!.state, 'failed');
  } finally { db.close(); }
});

test('assessment write failure rolls back completion and leaves the lease retryable', async () => {
  const db = open(':memory:');
  try {
    const admission = createAdmission(nodeSqlPort(db));
    assert.equal((await admission.check(identity, 'a', t0)).kind, 'admitted');
    const assessment = { schemaVersion: 1, id: 'result-a', storeId: identity.storeId, status: 'no_match', concern: 'insufficient', reasonCodes: ['NO_MATCH'], confidence: 'insufficient', evidenceIds: [], coverage: [{schemaVersion: 1, connector: 'synthetic', status: 'no_match', checkedAt: new Date(t0).toISOString()}], limitations: [], checkedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + 7 * 86400_000).toISOString(), aiMode: 'none', publicationStatus: 'draft' };
    db.exec("CREATE TRIGGER fail_assessment BEFORE INSERT ON assessments BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    await assert.rejects(() => admission.complete('a', 1, t0 + 1, assessment), /injected failure/);
    assert.equal(db.prepare("SELECT state FROM investigation_jobs WHERE id='a'").get()!.state, 'checking');
    assert.equal(db.prepare('SELECT count(*) n FROM assessments').get()!.n, 0);
    db.exec('DROP TRIGGER fail_assessment');
    assert.equal(await admission.complete('a', 1, t0 + 2, assessment), true);
  } finally { db.close(); }
});

test('lease renewal is fenced and cannot resurrect an expired or replaced attempt', async () => {
  const db = open(':memory:');
  try {
    const admission = createAdmission(nodeSqlPort(db));
    await admission.check(identity, 'a', t0);
    assert.equal(await admission.renew('a', 1, t0 + 30_000), true);
    assert.equal((await admission.check(identity, 'join', t0 + 60_000)).kind, 'joined');
    assert.equal(await admission.renew('a', 1, t0 + 90_000), false);
    assert.equal((await admission.check(identity, 'recover', t0 + 90_000)).kind, 'recovered');
    assert.equal(await admission.renew('a', 1, t0 + 90_001), false);
    assert.equal(await admission.renew('a', 2, t0 + 90_001), true);
  } finally {db.close();}
});

test('a completed result still enforces the rolling 60-second gate against early refresh', async () => {
  const db = open(':memory:');
  try {
    const admission = createAdmission(nodeSqlPort(db));
    await admission.check(identity, 'a', t0);
    const result = {schemaVersion:1,id:'result-a',storeId:identity.storeId,status:'no_match',concern:'insufficient',reasonCodes:['NO_MATCH'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'no_match',checkedAt:new Date(t0).toISOString()}],limitations:[],checkedAt:new Date(t0).toISOString(),expiresAt:new Date(t0+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
    assert.equal(await admission.complete('a', 1, t0 + 1, result), true);
    assert.deepEqual(await admission.check(identity, 'b', t0 + 59_999), {kind:'cached',jobId:'a'});
    assert.deepEqual(await admission.check(identity, 'c', t0 + 59_999, true), {kind:'cooldown',retryAfterMs:1});
    assert.equal((await admission.check(identity, 'd', t0 + 60_000, true)).kind, 'admitted');
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()!.n, 2);
  } finally {db.close();}
});
