import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { migrateNodeStorage, nodeSqlPort } from '../../../packages/runtime-node/src/storage.ts';
import { nodeCheckListener } from '../../../packages/runtime-node/src/check-http.ts';
import { createAdmission } from '../../../packages/storage-sqlite/src/admission.ts';
import { checkStore, pollCheck, renderResult } from '../src/check.js';

// Real Node HTTP + SQLite, not the provisional extension mock. Completion is synthetic and never a safety verdict.
test('extension checks and polls Node HTTP/SQLite through the actual /v1 handler', async () => {
  const db = new DatabaseSync(':memory:');
  migrateNodeStorage(db,[1,2,3,4,5].map(version=>({version,sql:readFileSync(new URL(`../../../migrations/${String(version).padStart(4,'0')}_${['fixture_stores','persistence','admission','quotas','check_access'][version-1]}.sql`,import.meta.url),'utf8')})));
  const now=Date.parse('2026-11-18T12:00:00Z');
  const server=createServer(nodeCheckListener(db,{scope:{principal:'install:extension',edge:'edge:extension'},enabled:true,statusTokenKey:'synthetic-extension-status-secret-not-production',now:()=>now}));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  if (!address || typeof address==='string') throw new Error('Missing listener');
  const endpoint=`http://127.0.0.1:${address.port}/v1/`;
  try {
    const start=await checkStore('https://example.com/cart?secret=never-send',endpoint);
    assert.equal(start.status,'checking');
    if (start.status !== 'checking') throw new Error('Expected checking');
    const checkedAt=new Date(now).toISOString();
    const assessment={schemaVersion:1,id:'synthetic-limited',storeId:'domain:example.com',status:'limited',concern:'insufficient',reasonCodes:['NO_CONNECTOR'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'unavailable',checkedAt,limitation:'No provider'}],limitations:['No evidence'],checkedAt,expiresAt:new Date(now+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
    assert.equal(await createAdmission(nodeSqlPort(db)).complete(start.checkId.split('.')[0]!,1,now+1,assessment),true);
    const done=await pollCheck(start,endpoint,fetch,async()=>{},1);
    assert.equal(done.status,'complete');
    assert.match(renderResult(done),/Insufficient evidence/);
    const cached=await checkStore('https://example.com/another?secret=never-send',endpoint);
    assert.equal(cached.status,'cached');
    assert.match(renderResult(cached),/Limited assessment/);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM store_identities').all()).includes('never-send'));
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});
