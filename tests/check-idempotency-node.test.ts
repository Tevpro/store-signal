import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { migrateNodeStorage, nodeSqlPort } from '../packages/runtime-node/src/storage.ts';
import { reserveCheck } from '../packages/storage-sqlite/src/check-idempotency.ts';
import { nodeCheckListener } from '../packages/runtime-node/src/check-http.ts';

const names=['fixture_stores','persistence','admission','quotas','check_access','check_idempotency'];
const secret='synthetic-node-secret-not-production';
const now=Date.parse('2026-11-18T12:00:00Z');
test('Node HTTP durable keyed replay is principal/request bound, concurrent and restart-safe',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'idempotency-node-'));
  const file=join(dir,'db.sqlite');
  let db=new DatabaseSync(file);
  migrateNodeStorage(db,names.map((name,i)=>({version:i+1,sql:readFileSync(`migrations/${String(i+1).padStart(4,'0')}_${name}.sql`,'utf8')})));
  const servers:ReturnType<typeof createServer>[]=[];
  async function start(who:'alice'|'bob') {
    const server=createServer(nodeCheckListener(db,{scope:{principal:`account:${who}`,edge:'edge:shared'},enabled:true,statusTokenKey:secret,now:()=>now}));
    servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');
    const addr=server.address();if(!addr || typeof addr==='string') throw new Error('missing port');
    return `http://127.0.0.1:${addr.port}`;
  }
  async function stop(){await Promise.all(servers.splice(0).map(server=>{server.closeAllConnections();return new Promise<void>(resolve=>server.close(()=>resolve()));}));}
  const post=(url:string,key:string,origin:string)=>fetch(`${url}/v1/checks`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({origin})});
  try {
    let alice=await start('alice');let bob=await start('bob');
    const key='synthetic-unique-key-01';
    const first=await post(alice,key,'https://example.com/path?secret=do-not-store');
    assert.equal(first.status,202);
    const payload=await first.text();
    const reply=JSON.parse(payload) as {checkId:string};
    const concurrent=await Promise.all(Array.from({length:8},()=>post(alice,key,'https://example.com/other-path')));
    for(const response of concurrent){assert.equal(response.status,202);assert.equal(await response.text(),payload);}
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE scope='account:alice' AND bucket='new'").get()?.n,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()?.n,1);
    const conflict=await post(alice,key,'https://other.example.com');
    assert.equal(conflict.status,409);assert.ok(!(await conflict.text()).includes(reply.checkId));
    const foreign=await post(bob,key,'https://example.com');
    assert.ok(!(await foreign.text()).includes(reply.checkId));
    assert.equal((await fetch(`${bob}/v1/checks/${reply.checkId}`)).status,404);
    await stop();db.close();db=new DatabaseSync(file);
    alice=await start('alice');bob=await start('bob');
    const again=await post(alice,key,'https://example.com');
    assert.equal(again.status,202);assert.equal(await again.text(),payload);
    assert.equal((await fetch(`${bob}/v1/checks/${reply.checkId}`)).status,404);
    const rows=JSON.stringify(db.prepare('SELECT * FROM check_idempotency').all());
    for(const sentinel of ['synthetic-unique-key-01','account:alice','secret=do-not-store']) assert.ok(!rows.includes(sentinel),`persisted ${sentinel}`);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    // Simulate an owner dying after admission but before publishing its replay.
    db.prepare('UPDATE check_idempotency SET job_id=NULL,reply_kind=NULL,lease_until_ms=0').run();
    const recovered=await post(alice,key,'https://example.com');
    assert.equal(recovered.status,202);assert.equal(await recovered.text(),payload);
    assert.equal(db.prepare('SELECT count(*) AS n FROM investigation_jobs').get()?.n,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM quota_events WHERE scope='account:alice' AND bucket='new'").get()?.n,1);
    db.prepare('DELETE FROM check_access_grants WHERE job_id=?').run(reply.checkId.split('.')[0]!);
    const revoked=await post(alice,key,'https://example.com');
    assert.equal(revoked.status,404,'replay must not reinstate revoked status grants');
  } finally {await stop();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('forward migration adds a replay ledger and job deletion cascades its reservation',async()=>{
  const db=new DatabaseSync(':memory:');
  const migrations=names.map((name,i)=>({version:i+1,sql:readFileSync(`migrations/${String(i+1).padStart(4,'0')}_${name}.sql`,'utf8')}));
  try {
    migrateNodeStorage(db,migrations.slice(0,5));
    assert.deepEqual(migrateNodeStorage(db,migrations),[6]);
    const server=createServer(nodeCheckListener(db,{scope:{principal:'account:alice'},enabled:true,statusTokenKey:secret,now:()=>now}));
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const addr=server.address();if(!addr || typeof addr==='string') throw new Error('missing port');
    try {
      assert.equal((await fetch(`http://127.0.0.1:${addr.port}/v1/checks`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'cascade-key'},body:JSON.stringify({origin:'https://example.com'})})).status,202);
      assert.equal(db.prepare('SELECT count(*) AS n FROM check_idempotency').get()?.n,1);
      db.prepare('DELETE FROM investigation_jobs').run();
      assert.equal(db.prepare('SELECT count(*) AS n FROM check_idempotency').get()?.n,0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  } finally {db.close();}
});

test('stale reservation owner cannot publish after a fenced takeover',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateNodeStorage(db,names.map((name,i)=>({version:i+1,sql:readFileSync(`migrations/${String(i+1).padStart(4,'0')}_${name}.sql`,'utf8')})));
    const port=nodeSqlPort(db);
    const first=await reserveCheck(port,secret,'account:alice','lease-test','https://example.com',now);
    assert.equal(first.kind,'owner');
    db.prepare('UPDATE check_idempotency SET lease_until_ms=0').run();
    const second=await reserveCheck(port,secret,'account:alice','lease-test','https://example.com',now);
    assert.equal(second.kind,'owner');
    if(first.kind!=='owner'||second.kind!=='owner') throw new Error('reservation not acquired');
    await assert.rejects(first.finish('missing-job','checking'),/reservation lost/);
    await second.abandon();
  } finally {db.close();}
});
