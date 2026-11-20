import contractData from './fixtures/v1-records.json' with { type: 'json' };
import { createStorage } from '../packages/storage-sqlite/src/index.ts';
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
