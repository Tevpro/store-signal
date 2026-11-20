import type { SqlPort, Statement } from '../../storage-sqlite/src/index.ts';

/** D1 batch executes transactionally; never split related writes into awaited .run calls. */
export function d1SqlPort(db: D1Database): SqlPort {
  return {
    async query(sql, params = []) {
      const { results } = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
      return results;
    },
    async batch(statements: readonly Statement[]) {
      if (statements.length) await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
    },
  };
}
