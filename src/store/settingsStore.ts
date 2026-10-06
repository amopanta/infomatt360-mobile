/**
 * Store de configuracion del usuario (Zustand + expo-sqlite).
 *
 * Persiste preferencias de campo en la misma DB SQLite local.
 * Usa valores por defecto de ENV como fallback.
 *
 * Configuraciones:
 *   - GPS: precision deseada, timeout de ubicacion
 *   - Sync: intervalo base, dias de retencion, tamano de lote
 *   - App: auto-guardar borradores, confirmar antes de enviar
 */

import { create } from 'zustand';
import { getDatabase } from '../db/database';
import { ENV } from '../config/env';

export interface AppSettings {
  // GPS
  gpsAccuracy: 'high' | 'balanced' | 'low';
  gpsTimeoutMs: number;

  // Sincronizacion
  syncIntervalBaseMs: number;
  syncedRetentionDays: number;
  bulkBatchSize: number;
  autoSyncOnCapture: boolean;

  // App
  autoSaveDrafts: boolean;
  confirmBeforeSubmit: boolean;
  showGpsOnCapture: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  gpsAccuracy: 'high',
  gpsTimeoutMs: 15_000,
  syncIntervalBaseMs: ENV.SYNC_INTERVAL_BASE,
  syncedRetentionDays: ENV.SYNCED_RETENTION_DAYS,
  bulkBatchSize: ENV.BULK_BATCH_SIZE,
  autoSyncOnCapture: true,
  autoSaveDrafts: true,
  confirmBeforeSubmit: true,
  showGpsOnCapture: true,
};

interface SettingsStore extends AppSettings {
  loaded: boolean;
  load: () => void;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

function ensureTable() {
  const db = getDatabase();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function readAll(): Partial<AppSettings> {
  ensureTable();
  const db = getDatabase();
  const rows = db.getAllSync('SELECT key, value FROM app_settings') as {
    key: string;
    value: string;
  }[];

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result as Partial<AppSettings>;
}

function persist(key: string, value: unknown) {
  ensureTable();
  const db = getDatabase();
  db.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [key, JSON.stringify(value)],
  );
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  load: () => {
    const saved = readAll();
    set({ ...DEFAULT_SETTINGS, ...saved, loaded: true });
  },

  update: (key, value) => {
    persist(key, value);
    set({ [key]: value } as Partial<SettingsStore>);
  },

  reset: () => {
    ensureTable();
    const db = getDatabase();
    db.runSync('DELETE FROM app_settings');
    set({ ...DEFAULT_SETTINGS });
  },
}));
