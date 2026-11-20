import type {SqlPort, Statement} from './index.ts';
import type {QuotaBucket, QuotaResult, QuotaScope} from './types/quota-scope.ts';
export type {QuotaBucket, QuotaResult, QuotaScope} from './types/quota-scope.ts';
const limits: Record<QuotaBucket,{principal:number;edge:number}> = {
  new:{principal:5,edge:20}, cached:{principal:30,edge:120}, status:{principal:60,edge:240}, ai:{principal:2,edge:4},
};
const MINUTE = 60_000;
function validate(scope: QuotaScope, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock');
  for (const key of [scope.principal,scope.edge]) if (key !== undefined && (!/^(account|install|edge):[a-zA-Z0-9_-]{1,128}$/.test(key))) throw new Error('Invalid quota scope');
  if (!scope.principal.startsWith('account:') && (!scope.principal.startsWith('install:') || !scope.edge?.startsWith('edge:'))) throw new Error('Anonymous checks require trusted edge backstop');
  if (scope.edge && !scope.edge.startsWith('edge:')) throw new Error('Invalid edge');
}
export function createQuotas(port: SqlPort) {
  return {
    async take(bucket:QuotaBucket,scope:QuotaScope,now:number):Promise<QuotaResult> {
      validate(scope,now);
      if (!Object.hasOwn(limits,bucket)) throw new Error('Invalid quota bucket');
      const ticket=crypto.randomUUID();
      // A delayed request may resume after a later-timestamped reservation commits.
      // Count future events too; ignoring them lets an old request exceed the cap.
      const write=(key:string,limit:number,require?:string):Statement=>({
        sql:`INSERT INTO quota_events(id,scope,bucket,at_ms)
          SELECT ?,?,?,? WHERE (SELECT count(*) FROM quota_events WHERE scope=? AND bucket=? AND at_ms>?)<?
          ${require ? 'AND EXISTS (SELECT 1 FROM quota_events WHERE id=? AND scope=? AND bucket=?)' : ''}`,
        params:[ticket,key,bucket,now,key,bucket,now-MINUTE,limit,...(require?[ticket,require,bucket]:[])],
      });
      const writes:Statement[]=[write(scope.principal,limits[bucket].principal)];
      if(scope.edge) {
        writes.push(write(scope.edge,limits[bucket].edge,scope.principal));
        writes.push({sql:'DELETE FROM quota_events WHERE id=? AND scope=? AND bucket=? AND NOT EXISTS (SELECT 1 FROM quota_events WHERE id=? AND scope=? AND bucket=?)',params:[ticket,scope.principal,bucket,ticket,scope.edge,bucket]});
      }
      await port.batch(writes);
      const rows=await port.query('SELECT scope FROM quota_events WHERE id=? AND bucket=?',[ticket,bucket]);
      if(rows.length === (scope.edge ? 2 : 1)) return {allowed:true,ticket};
      const keys=[scope.principal,...(scope.edge?[scope.edge]:[])];
      let retryAfterMs=1;
      for(const key of keys) {
        const row=await port.query('SELECT min(at_ms) AS oldest,count(*) AS total FROM quota_events WHERE scope=? AND bucket=? AND at_ms>?',[key,bucket,now-MINUTE]);
        const max=key===scope.edge?limits[bucket].edge:limits[bucket].principal;
        if(Number(row[0]?.total)>=max) retryAfterMs=Math.max(retryAfterMs,Number(row[0]?.oldest)+MINUTE-now);
      }
      return {allowed:false,retryAfterMs};
    },
    async release(ticket:string):Promise<void> {
      if (!/^[a-f0-9-]{36}$/.test(ticket)) throw new Error('Invalid quota ticket');
      await port.batch([{sql:'DELETE FROM quota_events WHERE id=?',params:[ticket]}]);
    },
    /** No shopper-domain relationship is retained; retain only recent abuse-window entries. */
    async prune(now:number):Promise<void> {
      if (!Number.isSafeInteger(now)) throw new Error('Invalid clock');
      await port.batch([{sql:'DELETE FROM quota_events WHERE at_ms<=?',params:[now-MINUTE]}]);
    },
  };
}
