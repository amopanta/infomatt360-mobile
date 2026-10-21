/**
 * Respuestas previas del participante, también de otros equipos (docs/141 §3).
 *
 * Se bajan en solo lectura con el paquete del proyecto, solo para los
 * participantes asignados al gestor (el servidor filtra permisos y
 * territorio). Los archivos se listan por nombre, sin descargarlos.
 */

import api from '../api/client';
import { getDatabase } from '../db/database';
import { flattenServerValues } from '../sync/backendValues';

const MAX_RECORDS = 300;

type HistoryItem = { record_id: string; template_id: string; template_name: string; status: string; created_at: string };
type ServerRecord = { id: string; values: { field_name: string; field_value_json: string }[] };

export interface CachedHistory { record_id: string; template_id: string; template_name: string; status: string; created_at: string; values_json: string }

const prepared = new WeakSet<object>();
function db() {
  const database = getDatabase();
  if (!prepared.has(database)) {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS participant_history_cache (
        record_id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, project_id TEXT NOT NULL,
        template_id TEXT NOT NULL, template_name TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, values_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_participant ON participant_history_cache(participant_id);
    `);
    prepared.add(database);
  }
  return database;
}

/** Baja el historial de los participantes indicados y reemplaza la copia del proyecto. */
export async function downloadParticipantHistory(projectId: string, participantIds: string[]): Promise<number> {
  const rows: (CachedHistory & { participant_id: string })[] = [];
  for (const participantId of participantIds) {
    if (rows.length >= MAX_RECORDS) break;
    const { data: history } = await api.get<HistoryItem[]>(`/participants/${participantId}/history`);
    for (const item of history) {
      if (rows.length >= MAX_RECORDS) break;
      const { data: record } = await api.get<ServerRecord>(`/runtime/record/${item.record_id}`).catch(() => ({ data: null as ServerRecord | null }));
      if (!record) continue;
      rows.push({ ...item, participant_id: participantId, values_json: JSON.stringify(flattenServerValues(record.values)) });
    }
  }
  const database = db();
  database.execSync('BEGIN');
  try {
    database.runSync(`DELETE FROM participant_history_cache WHERE project_id = ?`, [projectId]);
    for (const r of rows) {
      database.runSync(
        `INSERT OR REPLACE INTO participant_history_cache (record_id, participant_id, project_id, template_id, template_name, status, created_at, values_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.record_id, r.participant_id, projectId, r.template_id, r.template_name, r.status, String(r.created_at), r.values_json],
      );
    }
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
  return rows.length;
}

export function participantHistory(participantId: string): CachedHistory[] {
  return db().getAllSync<CachedHistory>(
    `SELECT record_id, template_id, template_name, status, created_at, values_json FROM participant_history_cache WHERE participant_id = ? ORDER BY created_at DESC`,
    [participantId],
  );
}

/** Texto legible de un valor guardado (solo lectura). */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('file_asset_id' in v) return `📎 ${String(v.name ?? 'archivo')}`;
    if ('lat' in v && 'lng' in v) return `${v.lat}, ${v.lng}`;
    if (v.type === 'Point' && Array.isArray(v.coordinates)) return `${v.coordinates[1]}, ${v.coordinates[0]}`;
    return JSON.stringify(v);
  }
  return String(value);
}
