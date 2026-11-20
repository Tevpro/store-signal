import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkStore, pollCheck, renderResult } from '../src/check.js';

// Real Wrangler-local Worker + D1 fixture routes. No provider or browser permission bypass.
const bin='./node_modules/.bin/wrangler';
const config='tests/wrangler.check.jsonc';
const dir=mkdtempSync(join(tmpdir(),'extension-d1-'));
const socket=createServer();
await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));
const addr=socket.address();
if (!addr || typeof addr==='string') throw new Error('Missing port');
const port=addr.port;
await new Promise<void>(resolve=>socket.close(()=>resolve()));
let child: ChildProcess | undefined;
let output='';
try {
  execFileSync(bin,['d1','migrations','apply','store-signal-local-fixtures','--local','--config',config,'--persist-to',dir]);
  child=spawn(bin,['dev','--local','--config',config,'--persist-to',dir,'--port',String(port),'--ip','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',(data:Buffer)=>{output+=data.toString();});
  child.stderr?.on('data',(data:Buffer)=>{output+=data.toString();});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<80;i++) {
    if(child.exitCode!==null || child.signalCode!==null) throw new Error(`Wrangler exited: ${output}`);
    try {if((await fetch(`${base}/ready`)).ok){ready=true;break;}} catch {/* startup */}
    await delay(250);
  }
  assert.ok(ready,`Wrangler unavailable: ${output}`);
  const endpoint=`${base}/v1/`;
  const request=(url:string,init:RequestInit)=>fetch(url.replace(`${base}/v1/`,`${base}/fixture/alice/v1/`),init);
  const initial=await checkStore('https://example.com/cart?secret=NEVER_SEND',endpoint,request);
  assert.equal(initial.status,'checking');
  if(initial.status!=='checking') throw new Error('Expected checking');
  const status=await fetch(`${base}/fixture/alice/v1/checks/${initial.checkId}`);
  assert.equal((await status.json() as {status:string}).status,'checking');
  const completed=await fetch(`${base}/fixture/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:initial.checkId.split('.')[0]})});
  assert.deepEqual(await completed.json(),{completed:true});
  const final=await pollCheck(initial,endpoint,request,async()=>{},1);
  assert.equal(final.status,'complete');
  assert.match(renderResult(final),/Insufficient evidence/);
  assert.equal((await checkStore('https://example.com/another?secret=NEVER_SEND',endpoint,request)).status,'cached');
  const denied=await fetch(`${base}/fixture/bob/v1/checks/${initial.checkId}`);
  assert.equal(denied.status,404);
  console.log('Extension against real Wrangler-local Worker/D1: checking → complete, cached, Alice/Bob 404 isolation; no provider verdict');
} finally {
  if(child){child.kill('SIGTERM');await Promise.race([new Promise<void>(resolve=>child!.once('exit',resolve)),delay(3000)]);if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');}
  rmSync(dir,{recursive:true,force:true});
}
