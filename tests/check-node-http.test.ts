import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { migrateNodeStorage } from '../packages/runtime-node/src/storage.ts';
import { nodeCheckListener } from '../packages/runtime-node/src/check-http.ts';

test('real Node HTTP maps requests to SQLite without trusting shopper scope or cookies', async () => {
  const db = new DatabaseSync(':memory:');
  migrateNodeStorage(db,[1,2,3,4,5].map(version=>({version,sql:readFileSync(`migrations/${String(version).padStart(4,'0')}_${['fixture_stores','persistence','admission','quotas','check_access'][version-1]}.sql`,'utf8')})));
  const server = createServer(nodeCheckListener(db, {scope:{principal:'install:node-test',edge:'edge:node-test'},enabled:true,statusTokenKey:'synthetic-node-secret-not-production',now:()=>Date.parse('2026-11-18T12:00:00Z')}));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const mislabeled = await fetch(`${url}/v1/checks`,{method:'POST',headers:{'Content-Type':'application/jsonp'},body:JSON.stringify({origin:'https://mislabeled.example.com'})});
    assert.equal(mislabeled.status,400,'a JSON-looking but non-JSON media type must not admit a job');
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()?.n,0);
    const response = await fetch(`${url}/v1/checks`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'private=yes','X-Forwarded-For':'127.0.0.1','X-Principal':'account:forged'},body:JSON.stringify({origin:'https://store.example.com/path'})});
    assert.equal(response.status,202);
    const body = await response.json() as {status:string;checkId:string};
    assert.equal(body.status,'checking');
    const poll = await fetch(`${url}/v1/checks/${body.checkId}`);
    assert.equal((await poll.json() as {status:string}).status,'checking');
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE scope='account:forged'").get()?.n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()?.n,1);
    assert.ok(!JSON.stringify(db.prepare('SELECT payload FROM investigation_jobs').all()).includes('private=yes'));
    assert.ok(!JSON.stringify(db.prepare('SELECT payload FROM store_identities').all()).includes('private=yes'));
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});

test('real Node HTTP isolates two trusted principals across checking, completion and SQLite restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'check-node-principals-'));
  const file=join(dir,'checks.sqlite');
  const now=Date.parse('2026-11-18T12:00:00Z');
  let db=new DatabaseSync(file);
  migrateNodeStorage(db,[1,2,3,4,5].map(version=>({version,sql:readFileSync(`migrations/${String(version).padStart(4,'0')}_${['fixture_stores','persistence','admission','quotas','check_access'][version-1]}.sql`,'utf8')})));
  const servers: ReturnType<typeof createServer>[]=[];
  async function start(who:'alice'|'bob') {
    const server=createServer(nodeCheckListener(db,{scope:{principal:`account:${who}`,edge:'edge:shared'},enabled:true,statusTokenKey:'synthetic-node-secret-not-production',now:()=>now}));
    servers.push(server);
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const address=server.address();
    if(!address || typeof address==='string') throw new Error('missing address');
    return `http://127.0.0.1:${address.port}`;
  }
  async function stop() {
    await Promise.all(servers.splice(0).map(server=>{
      server.closeAllConnections();
      return new Promise<void>(resolve=>server.close(()=>resolve()));
    }));
  }
  try {
    let alice=await start('alice');
    let bob=await start('bob');
    const created=await fetch(`${alice}/v1/checks`,{method:'POST',headers:{'Content-Type':'application/json','X-Principal':'account:bob'},body:JSON.stringify({origin:'https://example.com'})});
    assert.equal(created.status,202);
    const {checkId}=await created.json() as {checkId:string};
    assert.equal(db.prepare('SELECT count(*) AS n FROM check_access_grants WHERE job_id=?').get(checkId.split('.')[0]!)?.n,1);
    const denied=await fetch(`${bob}/v1/checks/${checkId}`);
    assert.equal(denied.status,404);
    assert.ok(!(await denied.text()).includes(checkId));
    assert.equal((await fetch(`${alice}/v1/checks/${checkId}`)).status,200);
    await stop(); db.close(); db=new DatabaseSync(file);
    alice=await start('alice'); bob=await start('bob');
    assert.equal((await fetch(`${alice}/v1/checks/${checkId}`)).status,200);
    assert.equal((await fetch(`${bob}/v1/checks/${checkId}`)).status,404);
    const {createAdmission}=await import('../packages/storage-sqlite/src/admission.ts');
    const checkedAt=new Date(now).toISOString();
    const assessment={schemaVersion:1,id:'private-result',storeId:'domain:example.com',status:'limited',concern:'insufficient',reasonCodes:['NO_CONNECTOR'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'unavailable',checkedAt,limitation:'Not configured'}],limitations:['No evidence'],checkedAt,expiresAt:new Date(now+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
    const {nodeSqlPort}=await import('../packages/runtime-node/src/storage.ts');
    assert.equal(await createAdmission(nodeSqlPort(db)).complete(checkId.split('.')[0]!,1,now+1,assessment),true);
    const completed=await fetch(`${alice}/v1/checks/${checkId}`);
    assert.equal(completed.status,200);
    assert.equal((await completed.json() as {status:string}).status,'complete');
    assert.equal((await fetch(`${bob}/v1/checks/${checkId}`)).status,404);
    const mac=checkId.split('.')[1]!;
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM check_access_grants').all()).includes('account:alice'));
    db.prepare('DELETE FROM check_access_grants WHERE job_id=? AND token_mac=?').run(checkId.split('.')[0]!,mac);
    assert.equal((await fetch(`${alice}/v1/checks/${checkId}`)).status,404,'a signed token without a persisted grant cannot read');
    assert.equal(db.prepare('SELECT count(*) AS n FROM quota_events WHERE scope=?').get('account:forged')?.n,0);
  } finally {await stop();db.close();rmSync(dir,{recursive:true,force:true});}
});
