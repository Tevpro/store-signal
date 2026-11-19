import type { DatabaseSync } from 'node:sqlite';
import type { StoreFixture } from '../../contracts/src/index.ts';

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
