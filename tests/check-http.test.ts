import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { nodeSqlPort, migrateNodeStorage } from '../packages/runtime-node/src/storage.ts';
import { createCheckHandler, type CheckContext } from '../packages/storage-sqlite/src/check-http.ts';
import checkFixtures from './fixtures/check-responses.json' with {type:'json'};
import { handleWorkerCheck } from '../packages/runtime-cloudflare/src/check-http.ts';

const now = Date.parse('2026-11-18T12:00:00Z');
const context: CheckContext = { scope: {principal: 'install:test', edge: 'edge:loopback'}, enabled: true, statusTokenKey:'synthetic-test-secret-not-production', now: () => now };
test('product Worker check adapter stays fail-closed without ingress and dispatcher', async () => {
  const response = await handleWorkerCheck(new Request('https://worker.example/v1/checks', {
    method: 'POST', headers: {'Content-Type':'application/json', 'X-Principal':'account:forged'},
    body: JSON.stringify({origin:'https://example.com'}),
  }), {DB: {} as D1Database});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), checkFixtures.unsupported);
});
function setup() {
  const db = new DatabaseSync(':memory:');
  migrateNodeStorage(db, [1,2,3,4,5,6].map(version => ({version, sql: readFileSync(`migrations/${String(version).padStart(4,'0')}_${['fixture_stores','persistence','admission','quotas','check_access','check_idempotency'][version-1]}.sql`, 'utf8')})));
  return {db, handler: createCheckHandler(nodeSqlPort(db))};
}
function post(origin: unknown, extras: Record<string, unknown> = {}, headers: Record<string,string> = {}) {
  return new Request('http://localhost/v1/checks', {method:'POST', headers:{'Content-Type':'application/json',...headers}, body: JSON.stringify({origin,...extras})});
}

test('POST admits a normalized store once and GET independently charges status quota', async () => {
  const {db, handler} = setup();
  try {
    const first = await handler(post('https://Shop-A.myshopify.com/products/1?token=secret', {}, {'Idempotency-Key':'first'}), context);
    assert.equal(first.status, 202);
    const body = await first.json() as Record<string,unknown>;
    assert.equal(body.status, 'checking');
    assert.equal(body.origin, 'https://shop-a.myshopify.com');
    assert.equal(body.storeId, 'tenant:shop-a.myshopify.com');
    assert.equal(typeof body.checkId, 'string');
    assert.deepEqual(body,{...checkFixtures.checking,checkId:body.checkId,storeId:'tenant:shop-a.myshopify.com',origin:'https://shop-a.myshopify.com'});
    assert.ok(!JSON.stringify(body).includes('token=secret'));
    assert.ok(!('ticket' in body));
    const repeated = await handler(post('https://shop-a.myshopify.com/other', {}, {'Idempotency-Key':'first'}), context);
    assert.equal((await repeated.json() as {checkId:string}).checkId, body.checkId);
    const status = await handler(new Request(`http://localhost/v1/checks/${body.checkId}`), context);
    assert.equal((await status.json() as {status:string}).status, 'checking');
    assert.equal(db.prepare("SELECT count(*) as n FROM quota_events WHERE bucket='new'").get()?.n, 2); // principal + edge once
    assert.equal(db.prepare("SELECT count(*) as n FROM quota_events WHERE bucket='status'").get()?.n, 2);
  } finally {db.close();}
});

test('fails closed without configured connector/dispatcher and rejects unsafe requests', async () => {
  const {db,handler} = setup();
  try {
    const unsupported=await handler(post('https://example.com'), {...context,enabled:false});
    assert.deepEqual(await unsupported.json(),checkFixtures.unsupported);
    for (const origin of ['http://127.0.0.1','http://169.254.169.254/latest','file:///etc/passwd','https://user:pass@example.com']) {
      assert.equal((await handler(post(origin),context)).status, 400, origin);
    }
    assert.equal((await handler(post('https://example.com', {principal:'account:forged'}),context)).status, 400);
    assert.equal((await handler(new Request('http://localhost/v1/checks/no-such-job'),context)).status,404);
    assert.equal(db.prepare('SELECT count(*) as n FROM investigation_jobs').get()?.n, 0);
  } finally {db.close();}
});

test('complete status never launders a draft or evidence-free publication into a safety verdict', async () => {
  const {db,handler}=setup();
  try {
    const first=await handler(post('https://example.com'),context);
    const {checkId}=await first.json() as {checkId:string};
    const checkedAt=new Date(now).toISOString();
    const assessment={schemaVersion:1,id:'synthetic-result',storeId:'domain:example.com',status:'limited',concern:'insufficient',reasonCodes:['SYNTHETIC'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'unavailable',checkedAt,limitation:'No live connector'}],limitations:['Not a public assessment'],checkedAt,expiresAt:new Date(now+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'published'};
    const {createAdmission}=await import('../packages/storage-sqlite/src/admission.ts');
    assert.equal(await createAdmission(nodeSqlPort(db)).complete(checkId.split('.')[0]!,1,now+1,assessment),true);
    const response=await handler(new Request(`http://localhost/v1/checks/${checkId}`),context);
    const result=await response.json() as {status:string;assessment:{concern:string;sources:unknown[]}};
    assert.deepEqual(result,{...checkFixtures.complete,checkId});
    assert.equal(result.status,'complete');
    assert.equal(result.assessment.concern,'insufficient');
    assert.deepEqual(result.assessment.sources,[]);
    const cached=await handler(post('https://example.com/another'),context);
    assert.deepEqual(await cached.json(),{...checkFixtures.cached,checkId});
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE bucket='cached'").get()?.n,2);
  } finally {db.close();}
});

test('a different trusted principal cannot poll another principal’s checking or complete result', async () => {
  const {db,handler}=setup();
  const alice={...context,scope:{principal:'account:alice'}};
  const bob={...context,scope:{principal:'account:bob'}};
  try {
    const response=await handler(post('https://example.com'),alice);
    const {checkId}=await response.json() as {checkId:string};
    assert.equal((await handler(new Request(`http://localhost/v1/checks/${checkId}`),bob)).status,404);
    assert.equal((await handler(new Request(`http://localhost/v1/checks/${checkId}`),alice)).status,200);
    const checkedAt=new Date(now).toISOString();
    const assessment={schemaVersion:1,id:'result-private',storeId:'domain:example.com',status:'limited',concern:'insufficient',reasonCodes:['NO_CONNECTOR'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'unavailable',checkedAt,limitation:'Not configured'}],limitations:['No evidence'],checkedAt,expiresAt:new Date(now+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
    const {createAdmission}=await import('../packages/storage-sqlite/src/admission.ts');
    assert.equal(await createAdmission(nodeSqlPort(db)).complete(checkId.split('.')[0]!,1,now+1,assessment),true);
    assert.equal((await handler(new Request(`http://localhost/v1/checks/${checkId}`),bob)).status,404);
    assert.equal((await (await handler(new Request(`http://localhost/v1/checks/${checkId}`),alice)).json() as {status:string}).status,'complete');
  } finally {db.close();}
});

test('status polling throttles separately from new-job admission', async () => {
  const {db,handler}=setup();
  try {
    const first=await handler(post('https://example.com'),context);
    const {checkId}=await first.json() as {checkId:string};
    for(let n=0;n<60;n++) assert.equal((await handler(new Request(`http://localhost/v1/checks/${checkId}`),context)).status,200);
    const throttled=await handler(new Request(`http://localhost/v1/checks/${checkId}`),context);
    assert.equal(throttled.status,429);
    assert.equal(throttled.headers.get('Retry-After'),'60');
    assert.deepEqual(await throttled.json(),checkFixtures.rate_limited);
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE bucket='new'").get()?.n,2);
  } finally {db.close();}
});

test('rejects streaming bodies above the wire cap without trusting Content-Length', async () => {
  const {db,handler} = setup();
  try {
    const oversized = new Request('http://localhost/v1/checks', {method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(' '.repeat(5000)));controller.close();}}),duplex:'half'} as RequestInit & {duplex:'half'});
    assert.equal((await handler(oversized,context)).status,413);
    assert.equal(db.prepare('SELECT count(*) as n FROM investigation_jobs').get()?.n,0);
  } finally {db.close();}
});

test('fresh keyed requests obey new quota while completed keyed replays do not charge it twice',async()=>{
  const {db,handler}=setup();
  try {
    for(let i=0;i<5;i++) {
      const response=await handler(post(`https://shop-${i}.myshopify.com`,{}, {'Idempotency-Key':`key-${i}`}),context);
      assert.equal(response.status,202);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE scope='install:test' AND bucket='new'").get()?.n,5);
    assert.equal((await handler(post('https://shop-0.myshopify.com',{}, {'Idempotency-Key':'key-0'}),context)).status,202);
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE scope='install:test' AND bucket='new'").get()?.n,5);
    const denied=await handler(post('https://shop-5.example.com',{}, {'Idempotency-Key':'key-5'}),context);
    assert.equal(denied.status,429);
    assert.equal(denied.headers.get('Retry-After'),'60');
    assert.equal(db.prepare('SELECT count(*) AS n FROM check_idempotency').get()?.n,5,'a denied key cannot pin its reservation');
  } finally {db.close();}
});
