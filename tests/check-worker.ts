import { createCheckHandler } from '../packages/storage-sqlite/src/check-http.ts';
import { createAdmission } from '../packages/storage-sqlite/src/admission.ts';
import { d1SqlPort } from '../packages/runtime-cloudflare/src/storage.ts';
interface Env {DB: D1Database}
const now=Date.parse('2026-11-18T12:00:00Z');
/** Isolated synthetic-only test entrypoint. Fixture route maps to a trusted context
 * supplied by the harness, NOT authentication; never bundle into default Worker. */
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if (url.pathname === '/ready') return new Response('ready');
    const port=d1SqlPort(env.DB);
    if (url.pathname === '/fixture/idempotency-stats') {
      const [count]=await port.query('SELECT count(*) AS n FROM check_idempotency');
      const [newCount]=await port.query("SELECT count(*) AS n FROM quota_events WHERE scope='account:alice' AND bucket='new'");
      const rows=await port.query('SELECT * FROM check_idempotency');
      const foreignKeys=await port.query('PRAGMA foreign_key_check');
      return Response.json({rows:count?.n,aliceNew:newCount?.n,leaked:JSON.stringify(rows).includes('worker-replay-key')||JSON.stringify(rows).includes('account:alice')||JSON.stringify(rows).includes('secret=no'),foreignKeys:foreignKeys.length});
    }
    if (url.pathname === '/fixture/complete' && request.method === 'POST') {
      const {id}=await request.json() as {id:string};
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return new Response('invalid fixture id',{status:400});
      const checkedAt=new Date(now).toISOString();
      const assessment={schemaVersion:1,id:'fixture-result',storeId:'domain:example.com',status:'limited',concern:'insufficient',reasonCodes:['NO_CONNECTOR'],confidence:'insufficient',evidenceIds:[],coverage:[{schemaVersion:1,connector:'synthetic',status:'unavailable',checkedAt,limitation:'Not configured'}],limitations:['No evidence'],checkedAt,expiresAt:new Date(now+7*86400_000).toISOString(),aiMode:'none',publicationStatus:'draft'};
      return Response.json({completed:await createAdmission(port).complete(id,1,now+1,assessment)});
    }
    const match=/^\/fixture\/(alice|bob)(\/v1\/checks(?:\/.*)?)$/.exec(url.pathname);
    const principal=match ? `account:${match[1]}` : 'install:synthetic';
    if (match) url.pathname=match[2]!;
    return createCheckHandler(port)(match ? new Request(url,request) : request, {scope:{principal,edge:'edge:synthetic'},enabled:true,statusTokenKey:'synthetic-worker-secret-not-production',now:()=>now});
  },
};
