/**
 * Sustituye los módulos nativos de Expo por equivalentes de Node:
 * expo-sqlite → node:sqlite (mismo motor SQLite y mismas sentencias).
 */
import { vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

type Params = unknown[] | undefined;

class SyncAdapter {
  constructor(private readonly db: DatabaseSync) {}
  execSync(sql: string) { this.db.exec(sql); }
  runSync(sql: string, params?: Params) {
    const r = this.db.prepare(sql).run(...((params ?? []) as never[]));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  getAllSync<T>(sql: string, params?: Params): T[] { return this.db.prepare(sql).all(...((params ?? []) as never[])) as T[]; }
  getFirstSync<T>(sql: string, params?: Params): T | null { return (this.db.prepare(sql).get(...((params ?? []) as never[])) as T) ?? null; }
}

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: () => new SyncAdapter(new DatabaseSync(':memory:')),
}));
