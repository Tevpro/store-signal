import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createAdmission} from '../packages/storage-sqlite/src/admission.ts';
import {createQuotas} from '../packages/storage-sqlite/src/quota.ts';
import {migrateNodeStorage, nodeSqlPort} from '../packages/runtime-node/src/storage.ts';

const sql = ['0001_fixture_stores.sql','0002_persistence.sql','0003_admission.sql','0004_quotas.sql'].map((file) => readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
const open = (path: string) => {const db = new DatabaseSync(path); migrateNodeStorage(db,sql.map((text,i)=>({version:i+1,sql:text}))); return db;};
const t0 = Date.parse('2026-11-18T12:00:00Z');
const identity = (name: string) => ({schemaVersion:1,storeId:`domain:${name}.example`,origin:`https://${name}.example`,registrableDomain:`${name}.example`,matchExplanation:'Synthetic independent store'});
const scope = {principal:'account:trusted-a',edge:'edge:trusted-network'};
const assessment = (storeId: string, at: number) => ({schemaVersion:1,id:`result-${storeId}`,storeId,status:'no_match',concern:'insufficient',reasonCodes:['NO_MATCH'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'no_match',checkedAt:new Date(at).toISOString()}],limitations:[],checkedAt:new Date(at).toISOString(),expiresAt:new Date(at+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'});

test('concurrent distinct store IDs consume five new admissions only, never a sixth',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quota-node-')); const path=join(dir,'db.sqlite'); const dbs=Array.from({length:12},()=>open(path));
 try {
  const results=await Promise.all(dbs.map((db,i)=>createAdmission(nodeSqlPort(db)).check(identity(`new-${i}`),`job-${i}`,t0,false,scope)));
  assert.equal(results.filter(r=>r.kind==='admitted').length,5);
  assert.equal(results.filter(r=>r.kind==='rate_limited').length,7);
  assert.equal(dbs[0]!.prepare('SELECT count(*) n FROM investigation_jobs').get()!.n,5);
  assert.equal(dbs[0]!.prepare("SELECT count(*) n FROM quota_events WHERE bucket='new' AND scope='account:trusted-a'").get()!.n,5);
  assert.equal((await createAdmission(nodeSqlPort(dbs[0]!)).check(identity('new-next'),'later',t0+60_000,false,scope)).kind,'admitted');
 } finally {dbs.forEach(db=>db.close());rmSync(dir,{recursive:true,force:true});}
});

test('cached quota is independent, and joins plus lease retries do not consume new quota',async()=>{
 const db=open(':memory:');try {
  const admission=createAdmission(nodeSqlPort(db)); const store=identity('cached');
  assert.equal((await admission.check(store,'first',t0,false,scope)).kind,'admitted');
  for(let i=0;i<7;i++) assert.equal((await admission.check(store,`join-${i}`,t0+1,false,scope)).kind,'joined');
  assert.equal((await admission.check(store,'retry',t0+60_000,false,scope)).kind,'recovered');
  assert.equal(await admission.complete('first',2,t0+60_001,assessment(store.storeId,t0)),true);
  for(let i=0;i<30;i++) assert.equal((await admission.check(store,`cache-${i}`,t0+60_002,false,scope)).kind,'cached');
  const blocked=await admission.check(store,'cache-exhausted',t0+60_002,false,scope);
  assert.equal(blocked.kind,'rate_limited');
  assert.equal((await admission.check(identity('other'),'second',t0+60_002,false,scope)).kind,'admitted');
  assert.equal(db.prepare("SELECT count(*) n FROM quota_events WHERE bucket='new' AND scope='account:trusted-a'").get()!.n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM quota_events WHERE bucket='cached' AND scope='account:trusted-a'").get()!.n,30);
 }finally{db.close();}
});

test('concurrent cached hits on independent connections stop at thirty, regardless of job and tenant labels',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cache-quota-node-')),path=join(dir,'db.sqlite');const dbs=Array.from({length:40},()=>open(path));
 try{
  const store=identity('tenant-store');
  const initial=createAdmission(nodeSqlPort(dbs[0]!));
  assert.equal((await initial.check(store,'initial',t0,false,scope)).kind,'admitted');
  assert.equal(await initial.complete('initial',1,t0+1,assessment(store.storeId,t0)),true);
  const results=await Promise.all(dbs.map((db,i)=>createAdmission(nodeSqlPort(db)).check({...store,clientTenantLabel:`forged-${i}`},`cache-${i}`,t0+2,false,scope)));
  assert.equal(results.filter(r=>r.kind==='cached').length,30);
  assert.equal(results.filter(r=>r.kind==='rate_limited').length,10);
  assert.equal(dbs[0]!.prepare("SELECT count(*) n FROM quota_events WHERE scope='account:trusted-a' AND bucket='cached'").get()!.n,30);
  assert.equal(dbs[0]!.prepare('SELECT count(*) n FROM investigation_jobs').get()!.n,1);
 }finally{dbs.forEach(db=>db.close());rmSync(dir,{recursive:true,force:true});}
});

test('status and AI budgets stay separate; anonymous edge quota holds against rotating installs',async()=>{
 const db=open(':memory:');try {
  const quotas=createQuotas(nodeSqlPort(db));
  const statuses=await Promise.all(Array.from({length:80},()=>quotas.take('status',scope,t0)));
  assert.equal(statuses.filter(r=>r.allowed).length,60);
  const ai=await Promise.all(Array.from({length:8},()=>quotas.take('ai',scope,t0)));
  assert.equal(ai.filter(r=>r.allowed).length,2);
  const aiLimit=await quotas.take('ai',scope,t0);
  assert.deepEqual(aiLimit,{allowed:false,retryAfterMs:60_000});
  const anonymous=Array.from({length:21},(_,i)=>({principal:`install:rotated-${i}`,edge:'edge:same-network'}));
  const taken=await Promise.all(anonymous.map(s=>quotas.take('new',s,t0)));
  assert.equal(taken.filter(r=>r.allowed).length,20);
  assert.equal(taken.filter(r=>!r.allowed).length,1);
  assert.equal(db.prepare("SELECT count(*) n FROM quota_events WHERE scope='edge:same-network'").get()!.n,20);
 }finally{db.close();}
});
