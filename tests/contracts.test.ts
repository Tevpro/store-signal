import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseFixtures } from '../packages/contracts/src/index.ts';

const fixtureText = readFileSync(new URL('./fixtures/stores.json', import.meta.url), 'utf8');

test('shared synthetic fixtures are validated and retain distinct stores', () => {
  const stores = parseFixtures(JSON.parse(fixtureText) as unknown);
  assert.equal(stores.length, 2);
  assert.notEqual(stores[0]?.id, stores[1]?.id);
  assert.equal(stores[0]?.origin, 'https://shop-a.example.com');
});

test('invalid fixtures fail closed', () => {
  assert.throws(() => parseFixtures([{ id: 'x', origin: 'not an origin' }]));
  assert.throws(() => parseFixtures([{ id: 'x', origin: 'https://a.example' }, { id: 'x', origin: 'https://b.example' }]));
});
