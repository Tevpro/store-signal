import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validate, checkRemote } from '../scripts/check-cloudflare-deploy.mjs';

const sha = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
  DEPLOY_SHA: sha, CONFIRM_DEPLOY: `deploy ${sha}`, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'not-real' };
const manifest = { workerName: 'store-signal-production', d1DatabaseName: 'store-signal-production',
  d1DatabaseId: '12345678-1234-4234-8234-123456789abc', entrypoint: 'apps/api/src/cloudflare.ts',
  compatibility_date: '2026-11-01', publicBaseUrl: 'https://api.tevpro.com',
  route: 'https://api.tevpro.com', zoneName: 'tevpro.com', requiredSecrets: ['SEARCH_API_KEY', 'GOOGLE_PLACES_API_KEY'] };
const source = 'export default { fetch() { return new Response("ready") } };';
const accepts = (m = manifest, e = env, s = source) => validate({ manifest: m, env: e, source: s });

test('default checkout cannot deploy: production manifest and app are absent', async () => {
  await assert.rejects(readFile('deploy/cloudflare-production.json', 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile('apps/api/src/cloudflare.ts', 'utf8'), { code: 'ENOENT' });
});
test('current checked-in Worker config is rejected by the production guard', async () => {
  const fixtureConfig = JSON.parse(await readFile('packages/runtime-cloudflare/wrangler.jsonc', 'utf8'));
  const fixtureWorker = await readFile('packages/runtime-cloudflare/src/index.ts', 'utf8');
  assert.throws(() => accepts({ ...manifest, workerName: fixtureConfig.name,
    d1DatabaseId: fixtureConfig.d1_databases[0].database_id }, env, fixtureWorker));
});
test('explicit production inputs pass structural guard only (not remote proof)', () => assert.equal(accepts(), manifest));
test('dispatch and exact reviewed head are mandatory', () => {
  for (const delta of [{GITHUB_EVENT_NAME:'push'}, {GITHUB_REF:'refs/heads/feature'}, {GITHUB_SHA:'b'.repeat(40)},
    {DEPLOY_SHA:'b'.repeat(40)}, {CONFIRM_DEPLOY:'yes'}, {CLOUDFLARE_API_TOKEN:''}, {CLOUDFLARE_ACCOUNT_ID:''}])
    assert.throws(() => accepts(manifest, {...env, ...delta}));
});
test('fixture target, missing app, missing secrets and placeholder IDs fail closed', () => {
  for (const delta of [{ workerName: 'store-signal-local-smoke' }, {d1DatabaseId:'00000000-0000-0000-0000-000000000000'},
    {d1DatabaseName:'store-signal-local-fixtures'}, {entrypoint:'packages/runtime-cloudflare/src/index.ts'},
    {requiredSecrets:[]}, {route:'https://test.example'}, {zoneName:'wrong.com'}, {publicBaseUrl:'http://api.tevpro.com'}])
    assert.throws(() => accepts({...manifest,...delta}));
  assert.throws(() => accepts(manifest, env, "import fixtureData from '../../../tests/fixtures/stores.json'"));
});
test('read-only Cloudflare checks require matching existing D1 and Worker secrets', async () => {
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer not-real');
    assert.equal(options.method, undefined);
    return { ok: true, json: async () => ({success:true, result:url.includes('/d1/')
      ? {uuid: manifest.d1DatabaseId, name:manifest.d1DatabaseName}
      : [{name:'SEARCH_API_KEY'}, {name:'GOOGLE_PLACES_API_KEY'}]}) };
  };
  await checkRemote(manifest, env, fetcher);
  await assert.rejects(checkRemote(manifest, env, async () => ({ok:false})), /read-only/);
  await assert.rejects(checkRemote(manifest, env, async () => ({ok:true, json:async () => ({success:true, result:[]})})), /D1 UUID/);
});
test('ordinary PR CI executes deployment guard suite before any merge', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /pull_request:/);
  assert.match(ci, /Cloudflare deployment guard tests \(no deployment\)[\s\S]*run: node --test tests\/cloudflare-deploy\.test\.mjs/);
});
test('ordinary PR CI runs actual Wrangler-local admission and quota smokes', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /pull_request:/);
  for (const name of ['admission', 'quota'])
    assert.match(ci, new RegExp(`^        run: npm run smoke:${name}:worker$`, 'm'));
});
test('workflow is manual-only, least privilege, pinned and protected', async () => {
  const yaml = await readFile('.github/workflows/deploy-cloudflare.yml', 'utf8');
  assert.match(yaml, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /^  (push|pull_request|schedule):/m);
  assert.match(yaml, /^permissions:\n  contents: read/m);
  assert.match(yaml, /environment: production/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(yaml, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /npm ci --ignore-scripts/);
  assert.match(yaml, /node scripts\/check-cloudflare-deploy.mjs[\s\S]*--dry-run[\s\S]*wrangler deploy --config/);
  for (const [, action] of yaml.matchAll(/uses: ([^\s]+)/g)) assert.match(action, /^[^@]+@[0-9a-f]{40}$/);
});
