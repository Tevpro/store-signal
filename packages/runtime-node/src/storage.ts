import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { SqlPort, Statement } from '../../storage-sqlite/src/index.ts';

/** Forward-only schema recovery: one migration and its ledger entry commit together. */
export function migrateNodeStorage(db: DatabaseSync, migrations: readonly { version: number; sql: string }[]): number[] {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _storage_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const versions = migrations.map(({ version }) => version);
  if (versions.some((version, i) => !Number.isInteger(version) || version !== i + 1)) throw new Error('Migrations must be contiguous from version 1');
  const applied = new Set(db.prepare('SELECT version FROM _storage_migrations').all().map((row) => row.version));
  if ([...applied].some((version) => !versions.includes(Number(version)))) throw new Error('Unknown applied schema version');
  const completed: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Migration introduced foreign key violations');
      db.prepare('INSERT INTO _storage_migrations(version,applied_at) VALUES (?,?)').run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
      completed.push(migration.version);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return completed;
}


/** Native SQLite adapter: a batch is a real transaction, not independent writes. */
export function nodeSqlPort(db: DatabaseSync): SqlPort {
  db.exec('PRAGMA foreign_keys = ON');
  const values = (params: readonly (string | number | null)[]): SQLInputValue[] => [...params];
  return {
    async query(sql, params = []) { return db.prepare(sql).all(...values(params)) as Record<string, unknown>[]; },
    async batch(statements: readonly Statement[]) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { sql, params } of statements) db.prepare(sql).run(...values(params));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
