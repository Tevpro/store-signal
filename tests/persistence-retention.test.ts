import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { nodeSqlPort } from '../packages/runtime-node/src/storage.ts';
import { createStorage, type SqlPort } from '../packages/storage-sqlite/src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>[]>;
const identity = fixture.identity![0]!;
const evidence = fixture.evidence![0]!;
const assessment = fixture.assessment!.find((entry) => (entry.evidenceIds as string[]).includes(evidence.id as string))!;
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0001_fixture_stores.sql', '0002_persistence.sql']) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  return db;
}
const job = (id: string) => ({ id, storeId: identity.storeId, state: 'complete', createdAt: '2026-01-01T00:00:00Z' });
const privateAssessment = (id: string) => ({ ...assessment, id, aiMode: 'byok', publicationStatus: 'draft', expiresAt: '2026-02-01T00:00:00Z' });

test('retention atomically invalidates live private analyses whose cited evidence expires', async () => {
  const db = setup();
  try {
    const storage = createStorage(nodeSqlPort(db));
    await storage.saveInvestigation(identity, job('old'), [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:00Z' });
    await storage.savePrivateAnalysis('account-a', privateAssessment('still-live'));
    await storage.saveCorrection({ id: 'retained', storeId: identity.storeId as string, summary: 'Synthetic correction', createdAt: '2026-01-01T00:00:00Z' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM private_analysis_evidence').get()?.n, 1);
    await storage.prune('2026-01-09T00:00:00Z');
    assert.equal(await storage.getPrivateAnalysis('account-a', 'still-live'), null);
    assert.equal(await storage.getInvestigation('old'), null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM private_analysis_evidence').get()?.n, 0);
    assert.equal((await storage.getCorrections(identity.storeId as string)).length, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});

test('mixed UTC precision cannot expire early or late at a fractional boundary', async () => {
  const db = setup();
  try {
    const storage = createStorage(nodeSqlPort(db));
    await storage.saveInvestigation(identity, job('half-second'), [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:00.500Z' });
    await storage.prune('2026-01-08T00:00:00Z');
    assert.ok(await storage.getInvestigation('half-second'));
    await storage.prune('2026-01-08T00:00:00.499Z');
    assert.ok(await storage.getInvestigation('half-second'));
    await storage.prune('2026-01-08T00:00:00.500Z');
    assert.equal(await storage.getInvestigation('half-second'), null);
    await storage.saveInvestigation(identity, job('whole-second'), [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:01Z' });
    await storage.prune('2026-01-08T00:00:01.500Z');
    assert.equal(await storage.getInvestigation('whole-second'), null);
  } finally { db.close(); }
});

test('a save racing with prune rolls back rather than storing private orphan citations', async () => {
  const db = setup();
  try {
    const base = nodeSqlPort(db);
    await createStorage(base).saveInvestigation(identity, job('racing'), [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:00Z' });
    let removed = false;
    const racingPort: SqlPort = {
      query: async (sql, params) => {
        const rows = await base.query(sql, params);
        if (!removed && sql.includes('SELECT id FROM evidence_refs')) {
          removed = true;
          await createStorage(base).prune('2026-01-09T00:00:00Z');
        }
        return rows;
      },
      batch: (statements) => base.batch(statements),
    };
    await assert.rejects(createStorage(racingPort).savePrivateAnalysis('account-a', privateAssessment('raced')), /NOT NULL constraint|FOREIGN KEY constraint/i);
    assert.equal(await createStorage(base).getPrivateAnalysis('account-a', 'raced'), null);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
