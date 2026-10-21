/**
 * Sustituye los módulos nativos de Expo por equivalentes de Node:
 * expo-sqlite → node:sqlite (mismo motor SQLite y mismas sentencias).
 * Cada nombre de archivo es una base distinta y persiste mientras dure el
 * módulo (vi.resetModules() la reinicia), igual que en el teléfono.
 */
import { beforeEach, vi } from 'vitest';
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
  closeSync() { /* la base en memoria sigue disponible para reabrirla */ }
}

const stores = vi.hoisted(() => ({ files: new Map<string, unknown>(), secure: new Map<string, string>() }));
beforeEach(() => { stores.files.clear(); stores.secure.clear(); });

vi.mock('expo-sqlite', () => {
  const files = stores.files as Map<string, DatabaseSync>;
  return {
    openDatabaseSync: (name: string) => {
      if (!files.has(name)) files.set(name, new DatabaseSync(':memory:'));
      return new SyncAdapter(files.get(name)!);
    },
    deleteDatabaseSync: (name: string) => { files.delete(name); },
  };
});

const secure = stores.secure;
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { secure.set(k, v); },
  deleteItemAsync: async (k: string) => { secure.delete(k); },
}));
