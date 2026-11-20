import fixtureData from '../../../tests/fixtures/stores.json' with { type: 'json' };
import contractData from '../../../tests/fixtures/v1-records.json' with { type: 'json' };
import { parseFixtures, parseV1, serializeV1 } from '../../contracts/src/index.ts';

interface Env { DB: D1Database }
const fixtures = parseFixtures(fixtureData as unknown);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Not found', { status: 404 });
    if (url.pathname === '/contracts-smoke') {
      const output: Record<string, unknown[]> = {};
      for (const kind of ['identity', 'evidence', 'coverage', 'assessment'] as const) {
        output[kind] = [];
        for (const value of contractData[kind]) {
          const payload = serializeV1(kind, value);
          const row = await env.DB.prepare('SELECT json(?) AS payload').bind(payload).first<{ payload: string }>();
          if (!row) throw new Error('D1 JSON roundtrip missing');
          output[kind]!.push(parseV1(kind, JSON.parse(row.payload) as unknown));
        }
      }
      return Response.json(output);
    }
    if (url.pathname !== '/smoke') return new Response('Not found', { status: 404 });
    const insert = env.DB.prepare('INSERT OR REPLACE INTO fixture_stores (id, origin) VALUES (?, ?)');
    for (const fixture of fixtures) await insert.bind(fixture.id, fixture.origin).run();
    const { results } = await env.DB.prepare('SELECT id, origin FROM fixture_stores ORDER BY id').all<{ id: string; origin: string }>();
    return Response.json(results);
  },
};
