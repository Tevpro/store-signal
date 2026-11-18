import type { DatabaseSync } from 'node:sqlite';
import type { StoreFixture } from '../../contracts/src/index.ts';
import { parseV1, serializeV1, type V1Records } from '../../contracts/src/v1.ts';

export function runNodeSmoke(db: DatabaseSync, migration: string, fixtures: readonly StoreFixture[]): readonly StoreFixture[] {
  db.exec(migration);
  const insert = db.prepare('INSERT OR REPLACE INTO fixture_stores (id, origin) VALUES (?, ?)');
  for (const fixture of fixtures) insert.run(fixture.id, fixture.origin);
  const rows: unknown = db.prepare('SELECT id, origin FROM fixture_stores ORDER BY id').all();
  if (!Array.isArray(rows) || !rows.every((row: unknown) =>
    typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string'
    && 'origin' in row && typeof row.origin === 'string')) throw new Error('Unexpected fixture rows');
  return rows.map((row: { id: string; origin: string }) => ({ id: row.id, origin: row.origin }));
}

/** Fixture-only integration: exercise versioned JSON over native SQLite JSON1. */
export function runNodeContractSmoke(db: DatabaseSync, input: unknown): Record<keyof V1Records, unknown[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid contract fixture');
  const records = input as Record<string, unknown>;
  const output = {} as Record<keyof V1Records, unknown[]>;
  for (const kind of ['identity', 'evidence', 'coverage', 'assessment'] as const) {
    if (!Array.isArray(records[kind])) throw new Error(`Missing ${kind} fixtures`);
    output[kind] = (records[kind] as unknown[]).map((value: unknown) => {
      const payload = serializeV1(kind, value);
      const row = db.prepare('SELECT json(?) AS payload').get(payload) as { payload: string };
      return parseV1(kind, JSON.parse(row.payload) as unknown);
    });
  }
  return output;
}
