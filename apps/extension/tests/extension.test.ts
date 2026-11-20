import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '../../../tests/fixtures/check-responses.json' with { type: 'json' };
import { normalizeStoreOrigin, parseEndpoint, endpointPermission } from '../src/boundaries.js';
import { checkStore, parseResult, pollCheck, renderResult } from '../src/check.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('click payload strips path/query/fragment and rejects unsafe endpoints and store hosts', () => {
  assert.equal(normalizeStoreOrigin('https://shop-a.platform.example/checkout?token=abc#secret'), 'https://shop-a.platform.example');
  assert.notEqual(normalizeStoreOrigin('https://shop-a.platform.example'), normalizeStoreOrigin('https://shop-b.platform.example'));
  assert.equal(endpointPermission(parseEndpoint('https://api.example.test/v1/')), 'https://api.example.test/*');
  assert.equal(parseEndpoint('http://localhost:8787/v1/').origin, 'http://localhost:8787');
  for (const url of ['chrome://settings', 'file:///tmp/a', 'http://localhost/a', 'https://127.0.0.1/a', 'https://user:secret@shop.example/', 'https://shop.example:8443/cart']) assert.throws(() => normalizeStoreOrigin(url));
  for (const url of ['http://api.example.test/v1/', 'https://user:pass@api.example.test/v1/', 'https://api.example.test/v1/?key=x', 'https://192.168.1.2/v1/', 'https://api.example.test/evil/', 'https://api.example.test/v1/#a', 'https://internal.localhost/v1/']) assert.throws(() => parseEndpoint(url));
});

test('shared /v1 fixtures parse and render without inventing safety verdicts', () => {
  for (const [key, body] of Object.entries(fixtures)) {
    const rendered = renderResult(parseResult(body));
    assert.ok(rendered.length > 0, key);
    if (key === 'checking') assert.match(rendered, /Checking/);
    if (key === 'cached' || key === 'complete') {
      assert.match(rendered, /Insufficient evidence/);
      assert.match(rendered, /Limited assessment/);
      assert.match(rendered, /2026-11-18T12:00:00.000Z/);
      assert.doesNotMatch(rendered, /Low concern|High concern/);
    }
  }
  for (const invalid of [{status:'checking',checkId:'x'}, { ...fixtures.cached, schemaVersion: 2 }, { ...fixtures.complete, assessment: { ...fixtures.complete.assessment, concern: 'safe' } }, { ...fixtures.complete, assessment: { ...fixtures.complete.assessment, sources: [{label:'<script>',url:'javascript:alert(1)',observedAt:'2026-11-18T12:00:00.000Z'}] } }]) assert.throws(() => parseResult(invalid));
  const escaped = parseResult({ ...fixtures.complete, assessment: { ...fixtures.complete.assessment, sources: [{label:'<script>',url:'https://example.com/?x=%22',observedAt:'2026-11-18T12:00:00.000Z'}] } });
  assert.match(renderResult(escaped), /&lt;script&gt;/);
  assert.doesNotMatch(renderResult(escaped), /<script>/);
});

test('assessment enums require real strings, not coercible JSON values', () => {
  for (const field of ['concern', 'confidence'] as const) {
    for (const invalid of [['high'], { value: 'high' }, null]) {
      assert.throws(() => parseResult({ ...fixtures.complete, assessment: { ...fixtures.complete.assessment, [field]: invalid } }), /Invalid assessment/);
    }
  }
  const valid = parseResult({ ...fixtures.complete, assessment: { ...fixtures.complete.assessment, concern: 'high', confidence: 'medium' } });
  assert.equal(valid.status, 'complete');
  assert.match(renderResult(valid), /High concern/);
  assert.match(renderResult(valid), /Confidence: medium/);
});

test('terminal polls correlate check IDs before returning cached or complete results', async () => {
  const initial = parseResult(fixtures.checking);
  assert.equal(initial.status, 'checking');
  for (const status of ['complete', 'cached'] as const) {
    const matching = { ...fixtures.complete, status, checkId: fixtures.checking.checkId };
    const result = await pollCheck(initial, 'http://localhost:8787/v1/', async () => json(matching), async () => {}, 1);
    assert.equal(result.status, status);
    await assert.rejects(
      () => pollCheck(initial, 'http://localhost:8787/v1/', async () => json({ ...matching, checkId: 'different' }), async () => {}, 1),
      /status identity/,
    );
  }
});

test('POST and bounded GET poll send only normalized identity with omitted credentials', async () => {
  const calls: string[] = [];
  const request = async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { origin: 'https://shop.example' });
      return json(fixtures.checking, 202);
    }
    return json(calls.length === 2 ? { ...fixtures.checking } : fixtures.complete);
  };
  const initial = await checkStore('https://shop.example/private?token=NEVER_SEND', 'http://localhost:8787/v1/', request);
  const final = await pollCheck(initial, 'http://localhost:8787/v1/', request, async () => {}, 3);
  assert.equal(final.status, 'complete');
  assert.deepEqual(calls, ['http://localhost:8787/v1/checks', `http://localhost:8787/v1/checks/${fixtures.checking.checkId}`, `http://localhost:8787/v1/checks/${fixtures.checking.checkId}`]);
  assert.ok(calls.every(call => !call.includes('NEVER_SEND')));
});

test('quota/error responses stay typed and malformed/non-json fail closed', async () => {
  for (const [body, code] of [[fixtures.rate_limited,429],[fixtures.unsupported,503]] as const) {
    const result = await checkStore('https://shop.example', 'http://localhost:8787/v1/', async () => json(body,code));
    assert.equal(result.status, body.status);
  }
  await assert.rejects(() => checkStore('https://shop.example', 'http://localhost:8787/v1/', async () => json({status:'cached',assessment:{concern:'low'}})), /Invalid/);
  await assert.rejects(() => checkStore('https://shop.example', 'http://localhost:8787/v1/', async () => new Response('oops')), /non-JSON/);
  await assert.rejects(() => pollCheck(parseResult(fixtures.checking), 'http://localhost:8787/v1/', async () => json(fixtures.checking), async () => {}, 2), /timed out/);
  const quota = await pollCheck(parseResult(fixtures.checking), 'http://localhost:8787/v1/', async () => json(fixtures.rate_limited,429), async () => {}, 2);
  assert.equal(quota.status,'rate_limited');
  await assert.rejects(() => pollCheck(parseResult(fixtures.checking), 'http://localhost:8787/v1/', async () => json({...fixtures.checking,checkId:'different'}), async () => {}, 2), /status identity/);
  assert.match(renderResult({status:'error',message:'<script>'}), /&lt;script&gt;/);
});
