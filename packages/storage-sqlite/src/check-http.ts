import { normalizeStoreIdentity, parseV1, type Assessment } from '../../contracts/src/index.ts';
import { createAdmission } from './admission.ts';
import { reserveCheck } from './check-idempotency.ts';
import { createQuotas } from './quota.ts';
import type { SqlPort } from './index.ts';
import type { CheckContext } from './types/check-context.ts';
export type { CheckContext } from './types/check-context.ts';
const json = (body: object, status = 200, retry?: number): Response => Response.json(body, {
  status, headers: {'Cache-Control':'no-store', ...(retry ? {'Retry-After': String(retry)} : {})},
});
const limited = (ms: number) => {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return json({schemaVersion:1,status:'rate_limited',retryAfterSeconds:seconds},429,seconds);
};
const unavailable = () => json({schemaVersion:1,status:'unsupported',reason:'connectors_unavailable'},503);
const bad = () => json({schemaVersion:1,status:'unsupported',reason:'invalid_request'},400);
const notFound = () => json({schemaVersion:1,status:'unsupported',reason:'not_found'},404);
const conflict = () => json({schemaVersion:1,status:'unsupported',reason:'idempotency_conflict'},409);
async function signedCheckId(jobId:string,context:CheckContext):Promise<string> {
  const secret=context.statusTokenKey;
  if (!secret || secret.length < 32) throw new Error('Missing trusted status-token secret');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${context.scope.principal}\n${jobId}`)));
  return `${jobId}.${Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}
async function authorizedJobId(token:string,context:CheckContext):Promise<string|null> {
  const index=token.lastIndexOf('.');
  if (index < 1 || !/^[a-f0-9]{64}$/.test(token.slice(index+1))) return null;
  const jobId=token.slice(0,index);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) return null;
  const expected=await signedCheckId(jobId,context);
  if (expected.length!==token.length) return null;
  let difference=0;
  for (let i=0;i<token.length;i++) difference |= token.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0 ? jobId : null;
}
function assessmentView(record: Assessment) {
  // F04 currently stores only zero-evidence limited results; publication flag alone
  // is not a publication gate. Until evidence + reviewer gate exist, never expose
  // a positive or accusatory verdict via this status endpoint.
  return {concern:'insufficient',confidence:'insufficient',checkedAt:record.checkedAt,sources:[],limited:true};
}
/** Shared HTTP boundary; adapters pass a server-derived scope and a real dispatch readiness flag. */
export function createCheckHandler(port: SqlPort) {
  const admission = createAdmission(port);
  const quotas = createQuotas(port);
  return async (request: Request, context: CheckContext): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname !== '/v1/checks' && !/^\/v1\/checks\/[a-zA-Z0-9_-]{1,128}\.[a-f0-9]{64}$/.test(pathname)) return notFound();
    if (pathname === '/v1/checks' && request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return bad();
      const declared = Number(request.headers.get('content-length'));
      if (declared > 4096) return json({schemaVersion:1,status:'unsupported',reason:'body_too_large'},413);
      let input: unknown;
      try {
        if (!request.body) return bad();
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) { await reader.cancel(); return json({schemaVersion:1,status:'unsupported',reason:'body_too_large'},413); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.length;}
        input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
      } catch { return bad(); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
      const body = input as Record<string,unknown>;
      if (Object.keys(body).some(key => key !== 'origin') || typeof body.origin !== 'string') return bad();
      let identity;
      try { identity = normalizeStoreIdentity(body.origin); parseV1('identity',identity); }
      catch { return bad(); }
      const key = request.headers.get('Idempotency-Key');
      if (key !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) return bad();
      if (!context.enabled || !context.statusTokenKey || context.statusTokenKey.length<32) return unavailable();
      const replay = key === null ? null : await reserveCheck(port,context.statusTokenKey,context.scope.principal,key,identity.origin,context.now());
      if (replay?.kind === 'conflict') return conflict();
      if (replay?.kind === 'pending') return json({schemaVersion:1,status:'unsupported',reason:'retry_pending'},503,1);
      try {
        const result = replay?.kind === 'ready' ? replay : await admission.check(identity,crypto.randomUUID(),context.now(),false,context.scope);
        if (result.kind === 'rate_limited' || result.kind === 'cooldown') {if(replay?.kind==='owner') await replay.abandon();return limited(result.retryAfterMs);}
        if (result.kind === 'failed') {if(replay?.kind==='owner') await replay.abandon();return unavailable();}
        const checkId=await signedCheckId(result.jobId,context);
        // A job may be joined by another principal. Store only each server-derived
        // capability's MAC, not the raw principal, and grant before disclosing it.
        const grantMac=checkId.slice(checkId.lastIndexOf('.')+1);
        if(replay?.kind==='ready') {
          const [grant]=await port.query('SELECT 1 FROM check_access_grants WHERE job_id=? AND token_mac=?',[result.jobId,grantMac]);
          if(!grant) return notFound(); // replay cannot undo revocation
        } else await port.batch([{sql:'INSERT OR IGNORE INTO check_access_grants(job_id,token_mac) VALUES (?,?)',params:[result.jobId,grantMac]}]);
        const kind=result.kind==='ready' ? result.replyKind : result.kind==='cached' ? 'cached' : 'checking';
        let response:Response;
        if (kind === 'cached') {
          const [row] = await port.query('SELECT payload FROM assessments WHERE job_id=?',[result.jobId]);
          if (!row || typeof row.payload !== 'string') {if(replay?.kind==='owner') await replay.abandon();return unavailable();}
          const assessment = parseV1('assessment',JSON.parse(row.payload) as unknown);
          response=json({schemaVersion:1,status:'cached',checkId,storeId:identity.storeId,origin:identity.origin,assessment:assessmentView(assessment)});
        } else response=json({schemaVersion:1,status:'checking',checkId,storeId:identity.storeId,origin:identity.origin},202);
        if(replay?.kind==='owner') await replay.finish(result.jobId,kind);
        return response;
      } catch(error) {if(replay?.kind==='owner') await replay.abandon();throw error;}
    }
    if (pathname !== '/v1/checks' && request.method === 'GET') {
      if (!context.enabled || !context.statusTokenKey || context.statusTokenKey.length<32) return unavailable();
      const taken = await quotas.take('status',context.scope,context.now());
      if (!taken.allowed) return limited(taken.retryAfterMs);
      const token = pathname.slice('/v1/checks/'.length);
      const checkId = await authorizedJobId(token,context);
      if (!checkId) return notFound();
      const [grant]=await port.query('SELECT 1 FROM check_access_grants WHERE job_id=? AND token_mac=?',[checkId,token.slice(token.lastIndexOf('.')+1)]);
      if (!grant) return notFound();
      const [row] = await port.query('SELECT state FROM investigation_jobs WHERE id=?',[checkId]);
      if (!row) return notFound();
      if (row.state === 'checking') return json({schemaVersion:1,status:'checking',checkId:token});
      if (row.state === 'failed') return unavailable();
      const [found] = await port.query('SELECT payload FROM assessments WHERE job_id=?',[checkId]);
      if (!found || typeof found.payload !== 'string') return unavailable();
      const assessment = parseV1('assessment',JSON.parse(found.payload) as unknown);
      return json({schemaVersion:1,status:'complete',checkId:token,assessment:assessmentView(assessment)});
    }
    return json({schemaVersion:1,status:'unsupported',reason:'method_not_allowed'},405);
  };
}
