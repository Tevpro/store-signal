import contractData from './fixtures/v1-records.json' with { type: 'json' };
import { createStorage, type SqlPort } from '../packages/storage-sqlite/src/index.ts';
import { d1SqlPort } from '../packages/runtime-cloudflare/src/storage.ts';

/** Synthetic-only Worker entrypoint; excluded from product bundle and default Wrangler config. */
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const storage = createStorage(d1SqlPort(env.DB));
    const identity = contractData.identity[0]!;
    const evidence = contractData.evidence[0]!;
    const assessment = contractData.assessment[0]!;
    const path = new URL(request.url).pathname;
    if (path === '/ready' && request.method === 'GET') return Response.json({ ready: true });
    if (path === '/persistence-race-smoke' && request.method === 'POST') {
      await storage.saveInvestigation(identity, { id: 'race-job', storeId: identity.storeId, state: 'complete', createdAt: '2026-01-01T00:00:00Z' }, [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:00Z' });
      const base = d1SqlPort(env.DB);
      let removed = false;
      const interleaved: SqlPort = {
        query: async (sql, params) => {
          const rows = await base.query(sql, params);
          if (!removed && sql.includes('SELECT id FROM evidence_refs')) {
            removed = true;
            await storage.prune('2026-01-09T00:00:00Z');
          }
          return rows;
        },
        batch: (statements) => base.batch(statements),
      };
      let rejected = false;
      try {
        await createStorage(interleaved).savePrivateAnalysis('race-account', { ...assessment, id: 'race-private', aiMode: 'byok', publicationStatus: 'draft', expiresAt: '2026-02-01T00:00:00Z' });
      } catch { rejected = true; }
      const [violations] = await env.DB.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check').all<{ n: number }>().then((r) => r.results);
      return Response.json({ rejected, orphan: await storage.getPrivateAnalysis('race-account', 'race-private'), violations: violations?.n });
    }
    if (path === '/persistence-retention-smoke' && request.method === 'POST') {
      await storage.saveInvestigation(identity, { id: 'retention-job', storeId: identity.storeId, state: 'complete', createdAt: '2026-01-01T00:00:00Z' }, [evidence], { ...assessment, expiresAt: '2026-01-08T00:00:00.500Z' });
      await storage.savePrivateAnalysis('retention-account', { ...assessment, id: 'retention-private', aiMode: 'byok', publicationStatus: 'draft', expiresAt: '2026-02-01T00:00:00Z' });
      await storage.prune('2026-01-08T00:00:00Z');
      const early = await storage.getInvestigation('retention-job');
      await storage.prune('2026-01-09T00:00:00Z');
      const [links] = await env.DB.prepare('SELECT count(*) AS n FROM private_analysis_evidence').all<{ n: number }>().then((r) => r.results);
      const [violations] = await env.DB.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check').all<{ n: number }>().then((r) => r.results);
      return Response.json({ survivedEarlyPrune: early !== null, investigation: await storage.getInvestigation('retention-job'), privateAnalysis: await storage.getPrivateAnalysis('retention-account', 'retention-private'), links: links?.n, violations: violations?.n });
    }
    if (path === '/persistence-private-smoke' && request.method === 'DELETE') return Response.json({
      foreignDelete: await storage.deletePrivateAnalysis('account-c', 'worker-private'),
      secondAccountDelete: await storage.deletePrivateAnalysis('account-b', 'worker-private'),
      ownerPrivate: await storage.getPrivateAnalysis('account-a', 'worker-private'),
    });
    if (path !== '/persistence-smoke') return new Response('Not found', { status: 404 });
    if (request.method === 'POST') {
      await storage.saveInvestigation(identity, { id: 'worker-job', storeId: identity.storeId, state: 'complete', createdAt: '2026-11-18T00:00:00Z' }, [evidence], assessment);
      await storage.saveCorrection({ id: 'worker-correction', storeId: identity.storeId, summary: 'Synthetic correction', createdAt: '2026-11-18T00:00:00Z' });
      await storage.savePrivateAnalysis('account-a', { ...assessment, id: 'worker-private', aiMode: 'byok', publicationStatus: 'draft' });
      await storage.savePrivateAnalysis('account-b', { ...assessment, id: 'worker-private', aiMode: 'byok', publicationStatus: 'draft' });
      return Response.json({ written: true });
    }
    if (request.method === 'GET') return Response.json({
      investigation: await storage.getInvestigation('worker-job'),
      corrections: await storage.getCorrections(identity.storeId),
      foreignPrivate: await storage.getPrivateAnalysis('account-c', 'worker-private'),
      secondAccountPrivate: await storage.getPrivateAnalysis('account-b', 'worker-private'),
      ownerPrivate: await storage.getPrivateAnalysis('account-a', 'worker-private'),
    });
    if (request.method === 'DELETE') {
      await storage.prune('2099-01-01T00:00:00Z');
      return Response.json({ investigation: await storage.getInvestigation('worker-job'), ownerPrivate: await storage.getPrivateAnalysis('account-a', 'worker-private') });
    }
    return new Response('Not found', { status: 404 });
  },
};
