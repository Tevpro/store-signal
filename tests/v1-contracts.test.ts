import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeStoreIdentity, parseAssessmentWithEvidence, parseV1, serializeV1 } from '../packages/contracts/src/index.ts';

const tenantRules = [{ platformDomain: 'platform.example', tenantLabels: 1 }, { platformDomain: 'shops.example', tenantLabels: 2 }];

test('normalization strips browsing data, canonicalizes host and keeps scheme out of identity', () => {
  const a = normalizeStoreIdentity('HTTP://WWW.Example.COM.:80/path?secret=1#section');
  const b = normalizeStoreIdentity('https://www.example.com/other');
  assert.equal(a.origin, 'http://www.example.com');
  assert.equal(a.registrableDomain, 'example.com');
  assert.equal(a.storeId, b.storeId);
  assert.equal(b.origin, 'https://www.example.com');
  assert.equal(normalizeStoreIdentity('https://bücher.de:443/x').origin, 'https://xn--bcher-kva.de');
});

test('reviewed hosted rules isolate tenant labels including nested tenancy', () => {
  const a = normalizeStoreIdentity('https://shop-a.platform.example/items', tenantRules);
  const b = normalizeStoreIdentity('https://shop-b.platform.example', tenantRules);
  assert.notEqual(a.storeId, b.storeId);
  assert.equal(a.tenantKey, 'shop-a');
  assert.equal(normalizeStoreIdentity('https://shop-a.branch.shops.example', tenantRules).tenantKey, 'shop-a.branch');
  assert.notEqual(normalizeStoreIdentity('https://fakeplatform.example', tenantRules).storeId, a.storeId);
  assert.equal(normalizeStoreIdentity('https://brand.com', tenantRules).tenantKey, undefined);
  assert.notEqual(normalizeStoreIdentity('https://shop-a.myshopify.com').storeId, normalizeStoreIdentity('https://shop-b.myshopify.com').storeId);
  const nested = normalizeStoreIdentity('https://shop-a.branch.shops.example', tenantRules);
  assert.throws(() => parseV1('identity', nested));
  assert.deepEqual(parseV1('identity', nested, tenantRules), nested);
  assert.throws(() => parseV1('identity', { ...normalizeStoreIdentity('https://foo.example.com'), storeId: 'tenant:foo.example.com', tenantKey: 'foo' }));
});

test('unsafe, malformed and non-public input fails closed at string boundary', () => {
  for (const input of ['ftp://example.com', 'https://user:password@example.com', 'http://127.0.0.1', 'https://[::1]', 'http://10.1.2.3', 'http://169.254.169.254', 'https://localhost', 'https://site.internal', 'https://example.com:8080', 'https://example.com:80', 'http://example.com:443', 'https://example.com\\@evil.com', 'https://example.com%2f.evil.com', 'https://co.uk', 'not a URL']) {
    assert.throws(() => normalizeStoreIdentity(input), Error, input);
  }
});

test('versioned golden records roundtrip through JSON and reject incompatible changes', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as unknown;
  assert.equal(typeof data, 'object');
  for (const kind of ['identity', 'evidence', 'coverage', 'assessment'] as const) {
    const records = (data as Record<string, unknown>)[kind];
    assert.ok(Array.isArray(records));
    for (const record of records) {
      const parsed = parseV1(kind, record);
      assert.deepEqual(parseV1(kind, JSON.parse(serializeV1(kind, parsed)) as unknown), parsed);
      assert.deepEqual(parseV1(kind, { ...parsed, futureOptional: { value: true } }), { ...parsed, futureOptional: { value: true } });
      assert.throws(() => parseV1(kind, { ...parsed, schemaVersion: 2 }));
      const { schemaVersion: _removed, ...missing } = parsed;
      assert.throws(() => parseV1(kind, missing));
    }
  }
});

test('coverage has distinct outcomes and contradictory metadata is rejected', () => {
  const base = { schemaVersion: 1, connector: 'search', checkedAt: '2026-01-01T00:00:00Z' };
  for (const status of ['checked', 'no_match', 'unavailable', 'failed']) {
    const metadata = status === 'failed' ? { errorCode: 'UPSTREAM_TIMEOUT' } : status === 'unavailable' ? { limitation: 'Not configured' } : {};
    assert.equal(parseV1('coverage', { ...base, ...metadata, status }).status, status);
  }
  assert.throws(() => parseV1('coverage', { ...base, status: 'no_match', errorCode: 'TIMEOUT' }));
  assert.throws(() => parseV1('coverage', { ...base, status: 'failed' }));
  assert.throws(() => parseV1('coverage', { ...base, status: 'checked', checkedAt: 'yesterday' }));
});

test('assessment state cannot imply a clean bill of health when no match or failure', () => {
  const base = (JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as { assessment: Record<string, unknown>[] }).assessment[0]!;
  assert.throws(() => parseV1('assessment', { ...base, status: 'no_match', concern: 'low' }));
  assert.throws(() => parseV1('assessment', { ...base, status: 'failed', concern: 'caution' }));
  assert.throws(() => parseV1('assessment', { ...base, status: 'complete', aiMode: 'none' }));
  assert.throws(() => parseV1('assessment', { ...base, status: 'complete', aiMode: 'byok', publicationStatus: 'published' }));
  assert.throws(() => parseV1('assessment', { ...base, evidenceIds: ['missing'], status: 'no_match' }));
  assert.throws(() => parseV1('assessment', { ...base, reasonCodes: [] }));
});

test('evidence rejects ambiguous subjects masquerading as exact match and unbounded text', () => {
  const base = (JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as { evidence: Record<string, unknown>[] }).evidence[0]!;
  assert.throws(() => parseV1('evidence', { ...base, subjectMatch: { status: 'ambiguous', rationale: '' } }));
  assert.throws(() => parseV1('evidence', { ...base, sourceUrl: 'http://127.0.0.1/' }));
  assert.throws(() => parseV1('evidence', { ...base, excerpt: 'x'.repeat(2000) }));
  assert.throws(() => parseV1('evidence', { ...base, lineage: ['same', 'same'] }));
});

test('assessment evidence references must belong to the same store and be known', () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as { assessment: Record<string, unknown>[]; evidence: Record<string, unknown>[] };
  const limited = golden.assessment[0]!;
  assert.equal(parseAssessmentWithEvidence(limited, golden.evidence).evidenceIds[0], 'ev-1');
  assert.throws(() => parseAssessmentWithEvidence({ ...limited, evidenceIds: ['missing'] }, golden.evidence));
  assert.throws(() => parseAssessmentWithEvidence(limited, [{ ...golden.evidence[0], storeId: 'domain:other.com' }]));
});

test('partial connector failures stay limited, not complete or total failure', () => {
  const base = (JSON.parse(readFileSync(new URL('./fixtures/v1-records.json', import.meta.url), 'utf8')) as { assessment: Record<string, unknown>[] }).assessment[0]!;
  const coverage = [
    { schemaVersion: 1, connector: 'healthy', status: 'checked', checkedAt: '2026-01-01T00:00:00Z' },
    { schemaVersion: 1, connector: 'outage', status: 'failed', errorCode: 'TIMEOUT', checkedAt: '2026-01-01T00:00:00Z' },
  ];
  assert.equal(parseV1('assessment', { ...base, coverage, status: 'limited' }).status, 'limited');
  assert.throws(() => parseV1('assessment', { ...base, coverage, status: 'failed' }));
  assert.throws(() => parseV1('assessment', { ...base, coverage, status: 'complete', aiMode: 'managed' }));
});
