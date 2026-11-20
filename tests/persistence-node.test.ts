import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nodeSqlPort, migrateNodeStorage } from '../packages/runtime-node/src/storage.ts';
import { createStorage } from '../packages/storage-sqlite/src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>[]>;
const identity = fixture.identity![0]!;
const evidence = fixture.evidence![0]!;
const assessment = fixture.assessment!.find((item) => (item.evidenceIds as string[]).includes(evidence.id as string))!;
const migrations = ['0001_fixture_stores.sql', '0002_persistence.sql'].map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

function database(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of migrations) db.exec(migration);
  return db;
}

test('native SQLite persists related records across restart, rolls back failures and isolates private analysis', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storesignal-storage-'));
  const path = join(dir, 'store.sqlite');
  try {
    let db = database(path);
    let storage = createStorage(nodeSqlPort(db));
    await storage.saveInvestigation(identity, { id: 'job-1', storeId: identity.storeId as string, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [{ ...evidence, fullReviewBody: 'DO_NOT_STORE_SYNTHETIC_BODY' }], assessment);
    assert.equal(db.prepare("SELECT instr(payload,'DO_NOT_STORE_SYNTHETIC_BODY') AS n FROM evidence_refs WHERE id='ev-1'").get()?.n, 0);
    await storage.saveCorrection({ id: 'correction-1', storeId: identity.storeId as string, summary: 'Synthetic correction', createdAt: '2026-11-18T00:00:00Z' });
    await storage.savePrivateAnalysis('account-a', { ...assessment, id: 'private-1', aiMode: 'byok', publicationStatus: 'draft', apiKey: 'DO_NOT_STORE_SYNTHETIC_KEY' });
    assert.equal(db.prepare("SELECT instr(payload,'DO_NOT_STORE_SYNTHETIC_KEY') AS n FROM private_analyses WHERE account_id='account-a'").get()?.n, 0);
    await storage.savePrivateAnalysis('account-b', { ...assessment, id: 'private-1', aiMode: 'byok', publicationStatus: 'draft' });
    await assert.rejects(storage.savePrivateAnalysis('account-a', { ...assessment, id: 'public-leak', aiMode: 'byok', publicationStatus: 'published' }), /Invalid \/v1 contract|remain draft/);
    await assert.rejects(storage.savePrivateAnalysis('account-a', { ...assessment, id: 'foreign-private', aiMode: 'byok', publicationStatus: 'draft', evidenceIds: ['missing'] }), /foreign evidence/i);
    await assert.rejects(storage.saveInvestigation(identity, { id: 'job-invalid', storeId: identity.storeId as string, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [evidence], { ...assessment, evidenceIds: ['foreign'] }), /foreign evidence/);
    await assert.rejects(storage.saveInvestigation(identity, { id: 'job-byok', storeId: identity.storeId as string, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [evidence], { ...assessment, id: 'byok', aiMode: 'byok' }), /private BYOK/i);
    assert.equal(await storage.getInvestigation('job-byok'), null);
    db.close();
    db = database(path);
    storage = createStorage(nodeSqlPort(db));
    assert.deepEqual(await storage.getInvestigation('job-1'), { identity, job: { id: 'job-1', storeId: identity.storeId, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, evidence: [evidence], assessment });
    assert.equal((await storage.getCorrections(identity.storeId as string)).length, 1);
    assert.equal(await storage.getPrivateAnalysis('account-c', 'private-1'), null);
    assert.equal(await storage.deletePrivateAnalysis('account-c', 'private-1'), false);
    assert.deepEqual(await storage.getPrivateAnalysis('account-b', 'private-1'), { ...assessment, id: 'private-1', aiMode: 'byok', publicationStatus: 'draft' });
    assert.equal(await storage.deletePrivateAnalysis('account-b', 'private-1'), true);
    assert.deepEqual(await storage.getPrivateAnalysis('account-a', 'private-1'), { ...assessment, id: 'private-1', aiMode: 'byok', publicationStatus: 'draft' });
    assert.deepEqual((await storage.getInvestigation('job-1'))?.assessment, assessment);
    assert.equal(await storage.deletePrivateAnalysis('account-a', 'private-1'), true);
    assert.equal(await storage.getPrivateAnalysis('account-a', 'private-1'), null);
    db.exec("CREATE TRIGGER injected_write_fault BEFORE INSERT ON assessments BEGIN SELECT RAISE(ABORT, 'injected assessment failure'); END");
    await assert.rejects(storage.saveInvestigation(identity, { id: 'job-fail', storeId: identity.storeId as string, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [evidence], { ...assessment, id: 'broken' }), /injected assessment failure/i);
    db.exec('DROP TRIGGER injected_write_fault');
    assert.equal(await storage.getInvestigation('job-fail'), null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM evidence_refs WHERE job_id = 'job-fail'").get()?.n, 0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Node forward migrator recovers interrupted migration without half-applied schema', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migrations[0]!);
    db.prepare('INSERT INTO fixture_stores(id,origin) VALUES (?,?)').run('legacy', 'https://legacy.example');
    assert.throws(() => migrateNodeStorage(db, [
      { version: 1, sql: migrations[0]! },
      { version: 2, sql: `${migrations[1]}\nINSERT INTO missing_table VALUES (1);` },
    ]));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='evidence_refs'").get()?.n, 0);
    assert.deepEqual(migrateNodeStorage(db, [{ version: 1, sql: migrations[0]! }, { version: 2, sql: migrations[1]! }]), [2]);
    assert.deepEqual(migrateNodeStorage(db, [{ version: 1, sql: migrations[0]! }, { version: 2, sql: migrations[1]! }]), []);
    assert.equal(db.prepare('SELECT count(*) AS n FROM fixture_stores').get()?.n, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});

test('native SQLite migrates prior fixture DB forward and prunes expired public/private records', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(migrations[0]!);
    db.prepare('INSERT INTO fixture_stores (id, origin) VALUES (?, ?)').run('old', 'https://old.example');
    db.exec(migrations[1]!);
    const storage = createStorage(nodeSqlPort(db));
    await storage.saveInvestigation(identity, { id: 'job-expired', storeId: identity.storeId as string, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [evidence], assessment);
    await storage.savePrivateAnalysis('account-a', { ...assessment, id: 'private-expired', aiMode: 'byok', publicationStatus: 'draft' });
    await storage.prune('2099-01-01T00:00:00Z');
    assert.equal(await storage.getInvestigation('job-expired'), null);
    assert.equal(await storage.getPrivateAnalysis('account-a', 'private-expired'), null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM fixture_stores').get()?.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM evidence_refs').get()?.n, 0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
